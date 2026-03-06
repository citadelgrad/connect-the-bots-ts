import { describe, it, expect } from "vitest";
import { parseDOT } from "../attractor/parser.js";

describe("DOT Parser", () => {
  it("parses a simple digraph with nodes and edges", () => {
    const dot = `
      digraph MyPipeline {
        start [shape=Mdiamond, label="Start"]
        task1 [shape=box, prompt="Do something"]
        end [shape=Msquare, label="End"]

        start -> task1 -> end
      }
    `;

    const graph = parseDOT(dot);
    expect(graph.name).toBe("MyPipeline");
    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.length).toBe(2);

    const startNode = graph.nodes.get("start")!;
    expect(startNode.attributes.shape).toBe("Mdiamond");
    expect(startNode.attributes.label).toBe("Start");

    const task1 = graph.nodes.get("task1")!;
    expect(task1.attributes.shape).toBe("box");
    expect(task1.attributes.prompt).toBe("Do something");

    expect(graph.edges[0].source).toBe("start");
    expect(graph.edges[0].target).toBe("task1");
    expect(graph.edges[1].source).toBe("task1");
    expect(graph.edges[1].target).toBe("end");
  });

  it("parses graph-level attributes", () => {
    const dot = `
      digraph Test {
        graph [goal="Build something", default_fidelity="compact"]
        start [shape=Mdiamond]
        end [shape=Msquare]
        start -> end
      }
    `;

    const graph = parseDOT(dot);
    expect(graph.attributes.goal).toBe("Build something");
    expect(graph.attributes.default_fidelity).toBe("compact");
  });

  it("parses edge attributes including conditions", () => {
    const dot = `
      digraph Test {
        start [shape=Mdiamond]
        a [shape=diamond]
        b [shape=box]
        c [shape=box]
        end [shape=Msquare]

        start -> a
        a -> b [condition="outcome=success", weight=10]
        a -> c [condition="outcome=fail", label="Retry"]
        b -> end
        c -> end
      }
    `;

    const graph = parseDOT(dot);
    const edge1 = graph.edges.find((e) => e.source === "a" && e.target === "b")!;
    expect(edge1.attributes.condition).toBe("outcome=success");
    expect(edge1.attributes.weight).toBe(10);

    const edge2 = graph.edges.find((e) => e.source === "a" && e.target === "c")!;
    expect(edge2.attributes.condition).toBe("outcome=fail");
    expect(edge2.attributes.label).toBe("Retry");
  });

  it("parses node defaults", () => {
    const dot = `
      digraph Test {
        node [shape=box]
        start [shape=Mdiamond]
        task1
        end [shape=Msquare]
        start -> task1 -> end
      }
    `;

    const graph = parseDOT(dot);
    const task1 = graph.nodes.get("task1")!;
    expect(task1.attributes.shape).toBe("box");
  });

  it("parses boolean and numeric attributes", () => {
    const dot = `
      digraph Test {
        start [shape=Mdiamond]
        task [shape=box, goal_gate=true, max_retries=3]
        end [shape=Msquare]
        start -> task -> end
      }
    `;

    const graph = parseDOT(dot);
    const task = graph.nodes.get("task")!;
    expect(task.attributes.goal_gate).toBe(true);
    expect(task.attributes.max_retries).toBe(3);
  });

  it("handles subgraphs by flattening", () => {
    const dot = `
      digraph Test {
        start [shape=Mdiamond]
        end [shape=Msquare]
        subgraph cluster_0 {
          a [shape=box]
          b [shape=box]
          a -> b
        }
        start -> a
        b -> end
      }
    `;

    const graph = parseDOT(dot);
    expect(graph.nodes.has("a")).toBe(true);
    expect(graph.nodes.has("b")).toBe(true);
    expect(graph.edges.length).toBe(3);
  });

  it("handles comments", () => {
    const dot = `
      // This is a comment
      digraph Test {
        /* Multi-line
           comment */
        start [shape=Mdiamond]
        end [shape=Msquare]
        start -> end // inline comment
      }
    `;

    const graph = parseDOT(dot);
    expect(graph.nodes.size).toBe(2);
  });

  it("rejects undirected edges", () => {
    const dot = `
      digraph Test {
        a -- b
      }
    `;

    expect(() => parseDOT(dot)).toThrow("undirected edges");
  });

  it("rejects strict modifier", () => {
    const dot = `strict digraph Test { }`;
    expect(() => parseDOT(dot)).toThrow("strict");
  });

  it("parses stylesheet in graph attributes", () => {
    const dot = `
      digraph Test {
        graph [model_stylesheet="* { llm_model: claude-sonnet-4-6; } .code { llm_model: claude-opus-4-6; }"]
        start [shape=Mdiamond]
        end [shape=Msquare]
        start -> end
      }
    `;

    const graph = parseDOT(dot);
    expect(graph.attributes.model_stylesheet).toContain("claude-sonnet-4-6");
  });
});
