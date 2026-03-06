import type { Graph, ValidationResult, FidelityMode } from "./types.js";
import { SHAPE_TO_HANDLER } from "./types.js";

const VALID_FIDELITY_MODES: FidelityMode[] = [
  "full",
  "compact",
  "summary:high",
  "summary:medium",
  "summary:low",
  "truncate",
];

export function validateGraph(graph: Graph): ValidationResult[] {
  const results: ValidationResult[] = [];

  // Find start and exit nodes
  const startNodes: string[] = [];
  const exitNodes: string[] = [];
  for (const [id, node] of graph.nodes) {
    const shape = (node.attributes.shape as string) ?? "box";
    if (shape === "Mdiamond") startNodes.push(id);
    if (shape === "Msquare") exitNodes.push(id);
  }

  // Error: exactly one start node
  if (startNodes.length === 0) {
    results.push({
      severity: "error",
      message: "Graph must have exactly one start node (shape=Mdiamond). Found 0.",
    });
  } else if (startNodes.length > 1) {
    results.push({
      severity: "error",
      message: `Graph must have exactly one start node. Found ${startNodes.length}: ${startNodes.join(", ")}`,
    });
  }

  // Error: exactly one exit node
  if (exitNodes.length === 0) {
    results.push({
      severity: "error",
      message: "Graph must have exactly one exit node (shape=Msquare). Found 0.",
    });
  } else if (exitNodes.length > 1) {
    results.push({
      severity: "error",
      message: `Graph must have exactly one exit node. Found ${exitNodes.length}: ${exitNodes.join(", ")}`,
    });
  }

  // Error: all edge targets exist
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.source)) {
      results.push({
        severity: "error",
        message: `Edge source "${edge.source}" does not exist as a node`,
      });
    }
    if (!graph.nodes.has(edge.target)) {
      results.push({
        severity: "error",
        message: `Edge target "${edge.target}" does not exist as a node`,
      });
    }
  }

  // Error: start has no incoming edges
  for (const startId of startNodes) {
    const incoming = graph.edges.filter((e) => e.target === startId);
    if (incoming.length > 0) {
      results.push({
        severity: "error",
        message: `Start node "${startId}" must not have incoming edges`,
        node_id: startId,
      });
    }
  }

  // Error: exit has no outgoing edges
  for (const exitId of exitNodes) {
    const outgoing = graph.edges.filter((e) => e.source === exitId);
    if (outgoing.length > 0) {
      results.push({
        severity: "error",
        message: `Exit node "${exitId}" must not have outgoing edges`,
        node_id: exitId,
      });
    }
  }

  // Error: all nodes reachable from start
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const queue = [startNodes[0]];
    reachable.add(startNodes[0]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of graph.edges) {
        if (edge.source === current && !reachable.has(edge.target)) {
          reachable.add(edge.target);
          queue.push(edge.target);
        }
      }
    }

    for (const [id] of graph.nodes) {
      if (!reachable.has(id)) {
        results.push({
          severity: "error",
          message: `Node "${id}" is not reachable from start node`,
          node_id: id,
        });
      }
    }
  }

  // Validate condition expressions parse correctly
  for (const edge of graph.edges) {
    if (edge.attributes.condition) {
      try {
        parseCondition(edge.attributes.condition as string);
      } catch (err: unknown) {
        results.push({
          severity: "error",
          message: `Invalid condition on edge ${edge.source} -> ${edge.target}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Warnings: unknown type values
  for (const [id, node] of graph.nodes) {
    if (node.attributes.type) {
      const knownTypes = Object.values(SHAPE_TO_HANDLER);
      if (!knownTypes.includes(node.attributes.type as any)) {
        results.push({
          severity: "warning",
          message: `Unknown handler type "${node.attributes.type}" on node "${id}"`,
          node_id: id,
        });
      }
    }
  }

  // Warnings: invalid fidelity modes
  for (const [id, node] of graph.nodes) {
    if (
      node.attributes.fidelity &&
      !VALID_FIDELITY_MODES.includes(node.attributes.fidelity)
    ) {
      results.push({
        severity: "warning",
        message: `Invalid fidelity mode "${node.attributes.fidelity}" on node "${id}"`,
        node_id: id,
      });
    }
  }

  // Warnings: retry_target references
  for (const [id, node] of graph.nodes) {
    if (
      node.attributes.retry_target &&
      !graph.nodes.has(node.attributes.retry_target)
    ) {
      results.push({
        severity: "warning",
        message: `retry_target "${node.attributes.retry_target}" on node "${id}" does not exist`,
        node_id: id,
      });
    }
    if (
      node.attributes.fallback_retry_target &&
      !graph.nodes.has(node.attributes.fallback_retry_target)
    ) {
      results.push({
        severity: "warning",
        message: `fallback_retry_target "${node.attributes.fallback_retry_target}" on node "${id}" does not exist`,
        node_id: id,
      });
    }
  }

  // Warnings: goal_gate nodes without retry_target
  for (const [id, node] of graph.nodes) {
    if (node.attributes.goal_gate && !node.attributes.retry_target) {
      results.push({
        severity: "warning",
        message: `Node "${id}" has goal_gate=true but no retry_target`,
        node_id: id,
      });
    }
  }

  // Warnings: LLM nodes without prompt
  for (const [id, node] of graph.nodes) {
    const shape = (node.attributes.shape as string) ?? "box";
    const handler = SHAPE_TO_HANDLER[shape] ?? node.attributes.type;
    if (handler === "codergen" && !node.attributes.prompt) {
      results.push({
        severity: "warning",
        message: `LLM node "${id}" has no prompt attribute`,
        node_id: id,
      });
    }
  }

  return results;
}

// Lightweight condition parser for validation
function parseCondition(expr: string): void {
  const clauses = expr.split("&&").map((s) => s.trim());
  for (const clause of clauses) {
    const match = clause.match(
      /^(outcome|preferred_label|context\.[a-zA-Z0-9_.]+)\s*(=|!=)\s*(.+)$/
    );
    if (!match) {
      throw new Error(`Invalid clause: "${clause}"`);
    }
  }
}
