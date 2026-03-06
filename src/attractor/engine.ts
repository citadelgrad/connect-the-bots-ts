import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  Graph,
  GraphEdge,
  GraphNode,
  Outcome,
  Checkpoint,
  PipelineEvent,
  PipelineEventHandler,
  HandlerType,
} from "./types.js";
import { PipelineContext, SHAPE_TO_HANDLER, RETRY_PRESETS } from "./types.js";
import { parseDOT } from "./parser.js";
import { validateGraph } from "./validator.js";
import { applyStylesheet } from "./stylesheet.js";
import { evaluateCondition } from "./conditions.js";
import { getHandler } from "./handlers/index.js";

export interface PipelineRunnerConfig {
  logs_root?: string;
  resume_from?: Checkpoint;
}

export class PipelineRunner {
  private graph: Graph;
  private context: PipelineContext;
  private logsRoot: string;
  private eventHandlers: PipelineEventHandler[] = [];
  private completedNodes: string[] = [];
  private nodeRetries: Record<string, number> = {};
  private cancelled = false;

  constructor(graph: Graph, config?: PipelineRunnerConfig) {
    this.graph = graph;
    this.context = new PipelineContext();
    this.logsRoot = config?.logs_root ?? ".attractor/runs/" + Date.now();

    // Initialize context from graph attributes
    if (graph.attributes.goal) {
      this.context.set("graph.goal", graph.attributes.goal);
    }
    for (const [key, value] of Object.entries(graph.attributes)) {
      this.context.set(`graph.${key}`, value);
    }

    // Resume from checkpoint
    if (config?.resume_from) {
      this.restoreCheckpoint(config.resume_from);
    }
  }

  on_event(handler: PipelineEventHandler): void {
    this.eventHandlers.push(handler);
  }

  cancel(): void {
    this.cancelled = true;
  }

  getContext(): PipelineContext {
    return this.context;
  }

  getGraph(): Graph {
    return this.graph;
  }

  async run(): Promise<Outcome> {
    const startTime = Date.now();
    this.emit("pipeline_started", { name: this.graph.name });

    await fs.mkdir(this.logsRoot, { recursive: true });

    // Write manifest
    await fs.writeFile(
      path.join(this.logsRoot, "manifest.json"),
      JSON.stringify(
        {
          name: this.graph.name,
          goal: this.graph.attributes.goal,
          started_at: new Date().toISOString(),
          node_count: this.graph.nodes.size,
          edge_count: this.graph.edges.length,
        },
        null,
        2
      ),
      "utf-8"
    );

    // Find start node
    const startNode = this.findStartNode();
    if (!startNode) {
      const outcome: Outcome = {
        status: "fail",
        context_updates: {},
        failure_reason: "No start node found",
      };
      this.emit("pipeline_failed", {
        error: outcome.failure_reason,
        duration: Date.now() - startTime,
      });
      return outcome;
    }

    // Determine starting node (resume or start)
    let currentNodeId: string;
    if (this.completedNodes.length > 0) {
      // Resume: start from the successor of last completed node
      const lastCompleted = this.completedNodes[this.completedNodes.length - 1];
      const next = this.findNextNode(lastCompleted, {
        status: "success",
        context_updates: {},
      });
      if (!next) {
        return {
          status: "success",
          context_updates: {},
          notes: "Pipeline already completed on resume",
        };
      }
      currentNodeId = next;
    } else {
      currentNodeId = startNode.id;
    }

    // Execute traversal
    try {
      const result = await this.executeTraversal(currentNodeId);
      const duration = Date.now() - startTime;
      if (result.status === "success" || result.status === "partial_success") {
        this.emit("pipeline_completed", {
          duration,
          artifact_count: 0,
        });
      } else {
        this.emit("pipeline_failed", {
          error: result.failure_reason,
          duration,
        });
      }
      return result;
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("pipeline_failed", { error: msg, duration });
      return {
        status: "fail",
        context_updates: {},
        failure_reason: msg,
      };
    }
  }

  private async executeTraversal(startNodeId: string): Promise<Outcome> {
    let currentNodeId: string | undefined = startNodeId;
    let stageIndex = 0;

    while (currentNodeId && !this.cancelled) {
      const node = this.graph.nodes.get(currentNodeId);
      if (!node) {
        return {
          status: "fail",
          context_updates: {},
          failure_reason: `Node "${currentNodeId}" not found`,
        };
      }

      this.context.set("current_node", currentNodeId);
      this.emit("stage_started", { name: currentNodeId, index: stageIndex });

      // Resolve handler
      const handlerType = this.resolveHandlerType(node);
      const handler = getHandler(handlerType);

      if (!handler) {
        return {
          status: "fail",
          context_updates: {},
          failure_reason: `No handler registered for type "${handlerType}"`,
        };
      }

      // Execute with retry
      const outcome = await this.executeWithRetry(node, handler, stageIndex);

      // Apply context updates
      this.context.applyUpdates(outcome.context_updates);
      this.context.set("outcome", outcome.status);
      if (outcome.preferred_label) {
        this.context.set("preferred_label", outcome.preferred_label);
      }

      this.completedNodes.push(currentNodeId);
      this.emit("stage_completed", {
        name: currentNodeId,
        index: stageIndex,
      });

      // Save checkpoint
      await this.saveCheckpoint(currentNodeId);

      // Check if this is an exit node
      const shape = (node.attributes.shape as string) ?? "box";
      if (shape === "Msquare") {
        // Check goal gates
        const gateResult = this.checkGoalGates();
        if (gateResult) {
          // Redirect to retry target
          currentNodeId = gateResult;
          stageIndex++;
          continue;
        }
        return outcome;
      }

      // Find next node
      currentNodeId = this.findNextNode(currentNodeId, outcome);
      stageIndex++;

      if (!currentNodeId) {
        // Dead end - no outgoing edges and not exit
        return {
          status: "fail",
          context_updates: {},
          failure_reason: `No outgoing edge from node "${node.id}"`,
        };
      }
    }

    if (this.cancelled) {
      return {
        status: "fail",
        context_updates: {},
        failure_reason: "Pipeline cancelled",
      };
    }

    return { status: "success", context_updates: {} };
  }

  private async executeWithRetry(
    node: GraphNode,
    handler: (ctx: import("./types.js").HandlerContext) => Promise<Outcome>,
    stageIndex: number
  ): Promise<Outcome> {
    const maxRetries =
      node.attributes.max_retries ??
      (this.graph.attributes.default_max_retry as number) ??
      0;

    const retryKey = `internal.retry_count.${node.id}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.context.set(retryKey, attempt);

      try {
        const outcome = await handler({
          node,
          context: this.context,
          graph: this.graph,
          logs_root: this.logsRoot,
        });

        if (
          outcome.status === "success" ||
          outcome.status === "partial_success"
        ) {
          return outcome;
        }

        if (outcome.status === "retry" && attempt < maxRetries) {
          this.emit("stage_retrying", {
            name: node.id,
            index: stageIndex,
            attempt: attempt + 1,
            delay: 0,
          });

          // Apply backoff
          const preset = RETRY_PRESETS.standard;
          let delay =
            preset.initial_delay_ms *
            Math.pow(preset.backoff_factor, attempt);
          delay = Math.min(delay, preset.max_delay_ms);
          if (preset.jitter) delay *= 0.5 + Math.random();
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (
          outcome.status === "fail" &&
          attempt < maxRetries
        ) {
          this.emit("stage_retrying", {
            name: node.id,
            index: stageIndex,
            attempt: attempt + 1,
          });
          continue;
        }

        // Check allow_partial - at this point status is fail/skipped/retry (exhausted)
        if (node.attributes.allow_partial) {
          return { ...outcome, status: "partial_success" as const };
        }

        return outcome;
      } catch (err: unknown) {
        this.emit("stage_failed", {
          name: node.id,
          index: stageIndex,
          error: err instanceof Error ? err.message : String(err),
          will_retry: attempt < maxRetries,
        });

        if (attempt === maxRetries) {
          return {
            status: "fail",
            context_updates: {},
            failure_reason: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    return { status: "fail", context_updates: {}, failure_reason: "Retries exhausted" };
  }

  private findNextNode(
    currentId: string,
    outcome: Outcome
  ): string | undefined {
    const outgoing = this.graph.edges.filter((e) => e.source === currentId);
    if (outgoing.length === 0) return undefined;

    // Step 1: Condition matching
    const conditionMatched = outgoing.filter((e) =>
      e.attributes.condition
        ? evaluateCondition(e.attributes.condition, outcome, this.context)
        : false
    );

    if (conditionMatched.length > 0) {
      return this.bestByWeightThenLexical(conditionMatched);
    }

    // Step 2: Preferred label match
    if (outcome.preferred_label) {
      const normalized = outcome.preferred_label.toLowerCase().trim();
      for (const edge of outgoing) {
        if (edge.attributes.label) {
          const edgeLabel = this.normalizeLabel(edge.attributes.label);
          if (edgeLabel === normalized) return edge.target;
        }
      }
    }

    // Step 3: Suggested next IDs
    if (outcome.suggested_next_ids?.length) {
      for (const suggestedId of outcome.suggested_next_ids) {
        const edge = outgoing.find((e) => e.target === suggestedId);
        if (edge) return edge.target;
      }
    }

    // Step 4: Highest weight among unconditional edges
    const unconditional = outgoing.filter((e) => !e.attributes.condition);
    if (unconditional.length > 0) {
      return this.bestByWeightThenLexical(unconditional);
    }

    // Step 5: Fall through to all edges by weight/lexical
    return this.bestByWeightThenLexical(outgoing);
  }

  private bestByWeightThenLexical(edges: GraphEdge[]): string {
    return edges.sort((a, b) => {
      const wa = (a.attributes.weight as number) ?? 0;
      const wb = (b.attributes.weight as number) ?? 0;
      if (wb !== wa) return wb - wa; // Higher weight first
      return a.target.localeCompare(b.target); // Lexical tiebreak
    })[0].target;
  }

  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .trim()
      .replace(/^\[[a-z0-9]\]\s+/i, "")
      .replace(/^[a-z0-9]\)\s+/i, "")
      .replace(/^[a-z0-9]\s+-\s+/i, "");
  }

  private resolveHandlerType(node: GraphNode): string {
    // Explicit type attribute takes priority
    if (node.attributes.type) return node.attributes.type;
    // Then shape mapping
    const shape = (node.attributes.shape as string) ?? "box";
    return SHAPE_TO_HANDLER[shape] ?? "codergen";
  }

  private checkGoalGates(): string | undefined {
    for (const nodeId of this.completedNodes) {
      const node = this.graph.nodes.get(nodeId);
      if (!node?.attributes.goal_gate) continue;

      const outcome = this.context.get(`outcome`);
      // Check the node's outcome from context
      if (outcome !== "success" && outcome !== "partial_success") {
        // Find retry target
        const retryTarget =
          node.attributes.retry_target ??
          node.attributes.fallback_retry_target ??
          (this.graph.attributes.retry_target as string) ??
          (this.graph.attributes.fallback_retry_target as string);

        if (retryTarget && this.graph.nodes.has(retryTarget)) {
          return retryTarget;
        }
      }
    }
    return undefined;
  }

  private findStartNode(): GraphNode | undefined {
    for (const [, node] of this.graph.nodes) {
      if ((node.attributes.shape as string) === "Mdiamond") {
        return node;
      }
    }
    return undefined;
  }

  private async saveCheckpoint(currentNodeId: string): Promise<void> {
    const checkpoint: Checkpoint = {
      timestamp: new Date().toISOString(),
      current_node: currentNodeId,
      completed_nodes: [...this.completedNodes],
      node_retries: { ...this.nodeRetries },
      context_values: this.context.snapshot(),
      logs: [],
    };

    await fs.writeFile(
      path.join(this.logsRoot, "checkpoint.json"),
      JSON.stringify(checkpoint, null, 2),
      "utf-8"
    );

    this.emit("checkpoint_saved", { node_id: currentNodeId });
  }

  private restoreCheckpoint(checkpoint: Checkpoint): void {
    this.completedNodes = checkpoint.completed_nodes;
    this.nodeRetries = checkpoint.node_retries;
    this.context.applyUpdates(checkpoint.context_values);
  }

  private emit(
    type: PipelineEvent["type"],
    data: Record<string, unknown>
  ): void {
    const event: PipelineEvent = {
      type,
      timestamp: new Date(),
      data,
    };
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // don't let handler errors break pipeline
      }
    }
  }
}

// ─── Convenience Function ───────────────────────────────────────────────────

export interface RunPipelineOptions {
  dot: string;
  logs_root?: string;
  resume_from?: Checkpoint;
  on_event?: PipelineEventHandler;
}

export async function runPipeline(
  options: RunPipelineOptions
): Promise<Outcome> {
  // Parse
  const graph = parseDOT(options.dot);

  // Apply stylesheet
  applyStylesheet(graph);

  // Validate
  const validationResults = validateGraph(graph);
  const errors = validationResults.filter((r) => r.severity === "error");
  if (errors.length > 0) {
    return {
      status: "fail",
      context_updates: {},
      failure_reason: `Validation failed:\n${errors.map((e) => `  - ${e.message}`).join("\n")}`,
    };
  }

  // Run
  const runner = new PipelineRunner(graph, {
    logs_root: options.logs_root,
    resume_from: options.resume_from,
  });

  if (options.on_event) {
    runner.on_event(options.on_event);
  }

  return runner.run();
}
