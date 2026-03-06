import { describe, it, expect } from "vitest";
import { PipelineContext } from "../attractor/types.js";

describe("PipelineContext", () => {
  it("gets and sets values", () => {
    const ctx = new PipelineContext();
    ctx.set("key", "value");
    expect(ctx.get("key")).toBe("value");
  });

  it("returns default for missing keys", () => {
    const ctx = new PipelineContext();
    expect(ctx.get("missing", "default")).toBe("default");
    expect(ctx.get("missing")).toBeUndefined();
  });

  it("creates independent clones", () => {
    const ctx = new PipelineContext();
    ctx.set("key", { nested: "value" });

    const cloned = ctx.clone();
    cloned.set("key", { nested: "modified" });

    expect((ctx.get("key") as any).nested).toBe("value");
    expect((cloned.get("key") as any).nested).toBe("modified");
  });

  it("takes snapshots", () => {
    const ctx = new PipelineContext();
    ctx.set("a", 1);
    ctx.set("b", "two");

    const snap = ctx.snapshot();
    expect(snap).toEqual({ a: 1, b: "two" });
  });

  it("applies bulk updates", () => {
    const ctx = new PipelineContext();
    ctx.set("a", 1);
    ctx.applyUpdates({ b: 2, c: 3 });

    expect(ctx.get("a")).toBe(1);
    expect(ctx.get("b")).toBe(2);
    expect(ctx.get("c")).toBe(3);
  });
});
