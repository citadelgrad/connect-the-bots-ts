import type {
  Handler,
  HandlerContext,
  Outcome,
  GraphNode,
  Graph,
  PipelineContext,
  CodergenBackend,
  Interviewer,
  QuestionOption,
} from "../types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ─── Handler Registry ───────────────────────────────────────────────────────

const handlerRegistry = new Map<string, Handler>();

export function registerHandler(type: string, handler: Handler): void {
  handlerRegistry.set(type, handler);
}

export function getHandler(type: string): Handler | undefined {
  return handlerRegistry.get(type);
}

// ─── Start Handler ──────────────────────────────────────────────────────────

const startHandler: Handler = async (): Promise<Outcome> => ({
  status: "success",
  context_updates: {},
});

// ─── Exit Handler ───────────────────────────────────────────────────────────

const exitHandler: Handler = async (): Promise<Outcome> => ({
  status: "success",
  context_updates: {},
});

// ─── Conditional Handler ────────────────────────────────────────────────────

const conditionalHandler: Handler = async (): Promise<Outcome> => ({
  status: "success",
  context_updates: {},
});

// ─── Codergen Handler ───────────────────────────────────────────────────────

let _codergenBackend: CodergenBackend | undefined;

export function setCodergenBackend(backend: CodergenBackend): void {
  _codergenBackend = backend;
}

const codergenHandler: Handler = async (
  ctx: HandlerContext
): Promise<Outcome> => {
  const { node, context, graph, logs_root } = ctx;
  const goal = (graph.attributes.goal as string) ?? "";
  let prompt = (node.attributes.prompt as string) ?? "";

  // Variable expansion: $goal
  prompt = prompt.replace(/\$goal/g, goal);

  // Write prompt to logs
  const nodeDir = path.join(logs_root, node.id);
  await fs.mkdir(nodeDir, { recursive: true });
  await fs.writeFile(path.join(nodeDir, "prompt.md"), prompt, "utf-8");

  if (!_codergenBackend) {
    const outcome: Outcome = {
      status: "fail",
      context_updates: {},
      failure_reason: "No CodergenBackend configured",
    };
    await writeStatus(nodeDir, outcome);
    return outcome;
  }

  const outcome = await _codergenBackend.run(node, prompt, context);

  await fs.writeFile(
    path.join(nodeDir, "response.md"),
    outcome.notes ?? "",
    "utf-8"
  );
  await writeStatus(nodeDir, outcome);

  return outcome;
};

// ─── Wait For Human Handler ─────────────────────────────────────────────────

let _interviewer: Interviewer | undefined;

export function setInterviewer(interviewer: Interviewer): void {
  _interviewer = interviewer;
}

export function getInterviewer(): Interviewer | undefined {
  return _interviewer;
}

const waitHumanHandler: Handler = async (
  ctx: HandlerContext
): Promise<Outcome> => {
  const { node, graph } = ctx;

  if (!_interviewer) {
    return {
      status: "fail",
      context_updates: {},
      failure_reason: "No Interviewer configured",
    };
  }

  // Derive choices from outgoing edges
  const outgoing = graph.edges.filter((e) => e.source === node.id);
  const options: QuestionOption[] = outgoing
    .filter((e) => e.attributes.label)
    .map((e) => {
      const label = e.attributes.label!;
      // Parse accelerator keys: [Y] Yes, Y) Yes, Y - Yes
      const accelMatch = label.match(
        /^\[([A-Za-z0-9])\]\s+(.+)$|^([A-Za-z0-9])\)\s+(.+)$|^([A-Za-z0-9])\s+-\s+(.+)$/
      );
      if (accelMatch) {
        const key = accelMatch[1] ?? accelMatch[3] ?? accelMatch[5];
        const text = accelMatch[2] ?? accelMatch[4] ?? accelMatch[6];
        return { key, label: text };
      }
      return { key: label.charAt(0).toUpperCase(), label };
    });

  const questionText =
    (node.attributes.label as string) ?? (node.attributes.prompt as string) ?? "Choose an option";

  const answer = await _interviewer.ask({
    text: questionText,
    type: options.length > 0 ? "multiple_choice" : "freeform",
    options: options.length > 0 ? options : undefined,
    stage: node.id,
  });

  // Find matching edge target
  let selectedTarget: string | undefined;
  if (answer.selected_option) {
    const normalizedAnswer = answer.selected_option.label.toLowerCase().trim();
    for (const edge of outgoing) {
      const edgeLabel = (edge.attributes.label ?? "").toLowerCase().trim();
      // Strip accelerator prefix
      const cleanLabel = edgeLabel
        .replace(/^\[[a-z0-9]\]\s+/i, "")
        .replace(/^[a-z0-9]\)\s+/i, "")
        .replace(/^[a-z0-9]\s+-\s+/i, "");
      if (cleanLabel === normalizedAnswer || edgeLabel === normalizedAnswer) {
        selectedTarget = edge.target;
        break;
      }
    }
  }

  if (!selectedTarget && answer.value && outgoing.length > 0) {
    // Try matching by value
    for (const edge of outgoing) {
      if (edge.target === answer.value) {
        selectedTarget = edge.target;
        break;
      }
    }
  }

  if (!selectedTarget && outgoing.length > 0) {
    selectedTarget = outgoing[0].target;
  }

  return {
    status: "success",
    suggested_next_ids: selectedTarget ? [selectedTarget] : undefined,
    context_updates: {
      [`human.gate.${node.id}.answer`]: answer.value,
    },
  };
};

// ─── Parallel Handler ───────────────────────────────────────────────────────

const parallelHandler: Handler = async (
  ctx: HandlerContext
): Promise<Outcome> => {
  // In the full implementation, this would fan out to child branches.
  // For now, we return success and let the engine handle fan-out via edges.
  return {
    status: "success",
    context_updates: {},
    notes: "Parallel handler - fan out to all outgoing edges",
  };
};

// ─── Fan-In Handler ─────────────────────────────────────────────────────────

const fanInHandler: Handler = async (
  ctx: HandlerContext
): Promise<Outcome> => {
  const results = ctx.context.get("parallel.results") as
    | Array<{ node_id: string; status: string; score?: number }>
    | undefined;

  if (!results || results.length === 0) {
    return {
      status: "success",
      context_updates: {},
      notes: "No parallel results to consolidate",
    };
  }

  // Heuristic ranking
  const statusOrder: Record<string, number> = {
    success: 0,
    partial_success: 1,
    retry: 2,
    fail: 3,
  };

  const sorted = [...results].sort((a, b) => {
    const sa = statusOrder[a.status] ?? 99;
    const sb = statusOrder[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  const best = sorted[0];

  return {
    status: sorted.every((r) => r.status === "fail") ? "fail" : "success",
    context_updates: {
      "parallel.fan_in.best_id": best.node_id,
      "parallel.fan_in.best_outcome": best.status,
    },
  };
};

// ─── Tool Handler ───────────────────────────────────────────────────────────

const toolHandler: Handler = async (
  ctx: HandlerContext
): Promise<Outcome> => {
  const { node } = ctx;
  const command = node.attributes.tool_command as string;

  if (!command) {
    return {
      status: "fail",
      context_updates: {},
      failure_reason: "No tool_command attribute on tool node",
    };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const timeoutStr = node.attributes.timeout as string | undefined;
  const timeoutMs = timeoutStr ? parseDuration(timeoutStr) : 30000;

  try {
    const { stdout } = await execFileAsync("/bin/bash", ["-c", command], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      status: "success",
      context_updates: { [`tool.${node.id}.output`]: stdout },
      notes: stdout,
    };
  } catch (err: unknown) {
    return {
      status: "fail",
      context_updates: {},
      failure_reason: err instanceof Error ? err.message : String(err),
    };
  }
};

// ─── Manager Loop Handler ───────────────────────────────────────────────────

const managerLoopHandler: Handler = async (
  ctx: HandlerContext
): Promise<Outcome> => {
  // Stub: the full implementation would supervise a child pipeline
  return {
    status: "success",
    context_updates: {},
    notes: "Manager loop stub - child pipeline supervision not yet implemented",
  };
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function writeStatus(dir: string, outcome: Outcome): Promise<void> {
  const status = {
    outcome: outcome.status,
    preferred_next_label: outcome.preferred_label,
    suggested_next_ids: outcome.suggested_next_ids,
    context_updates: outcome.context_updates,
    notes: outcome.notes,
  };
  await fs.writeFile(
    path.join(dir, "status.json"),
    JSON.stringify(status, null, 2),
    "utf-8"
  );
}

function parseDuration(str: string): number {
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
  if (!match) return 30000;
  const value = parseFloat(match[1]);
  switch (match[2]) {
    case "ms":
      return value;
    case "s":
    case undefined:
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return value * 1000;
  }
}

// ─── Register Built-In Handlers ─────────────────────────────────────────────

registerHandler("start", startHandler);
registerHandler("exit", exitHandler);
registerHandler("conditional", conditionalHandler);
registerHandler("codergen", codergenHandler);
registerHandler("wait.human", waitHumanHandler);
registerHandler("parallel", parallelHandler);
registerHandler("parallel.fan_in", fanInHandler);
registerHandler("tool", toolHandler);
registerHandler("stack.manager_loop", managerLoopHandler);
