import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../attractor/conditions.js";
import { PipelineContext } from "../attractor/types.js";

describe("Condition Evaluation", () => {
  const makeOutcome = (
    status: string,
    preferred_label?: string
  ) => ({
    status: status as any,
    context_updates: {},
    preferred_label,
  });

  it("returns true for empty condition", () => {
    const ctx = new PipelineContext();
    expect(evaluateCondition("", makeOutcome("success"), ctx)).toBe(true);
    expect(evaluateCondition(undefined, makeOutcome("success"), ctx)).toBe(true);
  });

  it("evaluates outcome=success", () => {
    const ctx = new PipelineContext();
    expect(
      evaluateCondition("outcome=success", makeOutcome("success"), ctx)
    ).toBe(true);
    expect(
      evaluateCondition("outcome=success", makeOutcome("fail"), ctx)
    ).toBe(false);
  });

  it("evaluates outcome!=fail", () => {
    const ctx = new PipelineContext();
    expect(
      evaluateCondition("outcome!=fail", makeOutcome("success"), ctx)
    ).toBe(true);
    expect(
      evaluateCondition("outcome!=fail", makeOutcome("fail"), ctx)
    ).toBe(false);
  });

  it("evaluates context variables", () => {
    const ctx = new PipelineContext();
    ctx.set("retries", "2");
    expect(
      evaluateCondition("context.retries=2", makeOutcome("success"), ctx)
    ).toBe(true);
    expect(
      evaluateCondition("context.retries=3", makeOutcome("success"), ctx)
    ).toBe(false);
  });

  it("evaluates AND-combined clauses", () => {
    const ctx = new PipelineContext();
    ctx.set("retries", "2");
    expect(
      evaluateCondition(
        "outcome=fail && context.retries=2",
        makeOutcome("fail"),
        ctx
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        "outcome=success && context.retries=2",
        makeOutcome("fail"),
        ctx
      )
    ).toBe(false);
  });

  it("evaluates preferred_label", () => {
    const ctx = new PipelineContext();
    expect(
      evaluateCondition(
        "preferred_label!=Skip",
        makeOutcome("success", "Continue"),
        ctx
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        "preferred_label!=Skip",
        makeOutcome("success", "Skip"),
        ctx
      )
    ).toBe(false);
  });
});
