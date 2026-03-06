import { describe, it, expect } from "vitest";
import { parseDOT } from "../attractor/parser.js";
import { validateGraph } from "../attractor/validator.js";

describe("Graph Validator", () => {
  it("passes a valid graph", () => {
    const graph = parseDOT(`
      digraph Valid {
        start [shape=Mdiamond]
        task [shape=box, prompt="Do it"]
        end [shape=Msquare]
        start -> task -> end
      }
    `);

    const results = validateGraph(graph);
    const errors = results.filter((r) => r.severity === "error");
    expect(errors.length).toBe(0);
  });

  it("errors when no start node", () => {
    const graph = parseDOT(`
      digraph NoStart {
        task [shape=box]
        end [shape=Msquare]
        task -> end
      }
    `);

    const results = validateGraph(graph);
    const errors = results.filter((r) => r.severity === "error");
    expect(errors.some((e) => e.message.includes("start node"))).toBe(true);
  });

  it("errors when no exit node", () => {
    const graph = parseDOT(`
      digraph NoExit {
        start [shape=Mdiamond]
        task [shape=box]
        start -> task
      }
    `);

    const results = validateGraph(graph);
    const errors = results.filter((r) => r.severity === "error");
    expect(errors.some((e) => e.message.includes("exit node"))).toBe(true);
  });

  it("errors when nodes are unreachable", () => {
    const graph = parseDOT(`
      digraph Unreachable {
        start [shape=Mdiamond]
        task [shape=box]
        orphan [shape=box]
        end [shape=Msquare]
        start -> task -> end
      }
    `);

    // Need to add orphan manually since it has no edges
    const results = validateGraph(graph);
    const errors = results.filter((r) => r.severity === "error");
    expect(errors.some((e) => e.message.includes("not reachable"))).toBe(true);
  });

  it("warns about goal_gate without retry_target", () => {
    const graph = parseDOT(`
      digraph GoalGate {
        start [shape=Mdiamond]
        task [shape=box, goal_gate=true]
        end [shape=Msquare]
        start -> task -> end
      }
    `);

    const results = validateGraph(graph);
    const warnings = results.filter((r) => r.severity === "warning");
    expect(
      warnings.some((w) => w.message.includes("goal_gate") && w.message.includes("retry_target"))
    ).toBe(true);
  });

  it("warns about LLM nodes without prompt", () => {
    const graph = parseDOT(`
      digraph NoPrompt {
        start [shape=Mdiamond]
        task [shape=box]
        end [shape=Msquare]
        start -> task -> end
      }
    `);

    const results = validateGraph(graph);
    const warnings = results.filter((r) => r.severity === "warning");
    expect(warnings.some((w) => w.message.includes("no prompt"))).toBe(true);
  });

  it("errors on start node with incoming edges", () => {
    const graph = parseDOT(`
      digraph BadStart {
        start [shape=Mdiamond]
        task [shape=box]
        end [shape=Msquare]
        start -> task -> end
        task -> start
      }
    `);

    const results = validateGraph(graph);
    const errors = results.filter((r) => r.severity === "error");
    expect(
      errors.some((e) => e.message.includes("Start node") && e.message.includes("incoming"))
    ).toBe(true);
  });
});
