import { describe, it, expect } from "vitest";
import { parseStylesheet, applyStylesheet } from "../attractor/stylesheet.js";
import { parseDOT } from "../attractor/parser.js";

describe("Stylesheet", () => {
  it("parses a stylesheet with multiple rules", () => {
    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-6; }
      .code { llm_model: claude-opus-4-6; reasoning_effort: high; }
      #critical { llm_model: gpt-4o; }
    `);

    expect(rules.length).toBe(3);

    const universal = rules.find((r) => r.selector === "*")!;
    expect(universal.specificity).toBe(0);
    expect(universal.properties.llm_model).toBe("claude-sonnet-4-6");

    const classRule = rules.find((r) => r.selector === ".code")!;
    expect(classRule.specificity).toBe(1);
    expect(classRule.properties.llm_model).toBe("claude-opus-4-6");

    const idRule = rules.find((r) => r.selector === "#critical")!;
    expect(idRule.specificity).toBe(2);
    expect(idRule.properties.llm_model).toBe("gpt-4o");
  });

  it("applies stylesheet to graph nodes", () => {
    const graph = parseDOT(`
      digraph StyleTest {
        graph [model_stylesheet="* { llm_model: base-model; } .fast { llm_model: fast-model; }"]
        start [shape=Mdiamond]
        task1 [shape=box, class="fast"]
        task2 [shape=box]
        end [shape=Msquare]
        start -> task1 -> task2 -> end
      }
    `);

    applyStylesheet(graph);

    // task1 has class "fast" -> should get fast-model
    expect(graph.nodes.get("task1")!.attributes.llm_model).toBe("fast-model");
    // task2 has no class -> should get base-model from universal
    expect(graph.nodes.get("task2")!.attributes.llm_model).toBe("base-model");
  });

  it("explicit node attributes override stylesheet", () => {
    const graph = parseDOT(`
      digraph StyleOverride {
        graph [model_stylesheet="* { llm_model: base; }"]
        start [shape=Mdiamond]
        task [shape=box, llm_model="explicit-model"]
        end [shape=Msquare]
        start -> task -> end
      }
    `);

    applyStylesheet(graph);

    // Explicit attribute should take priority
    expect(graph.nodes.get("task")!.attributes.llm_model).toBe("explicit-model");
  });
});
