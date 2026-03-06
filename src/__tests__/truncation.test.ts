import { describe, it, expect } from "vitest";
import { truncateToolOutput } from "../agent/truncation.js";
import { DEFAULT_SESSION_CONFIG } from "../agent/types.js";

describe("Truncation", () => {
  it("does not truncate short output", () => {
    const result = truncateToolOutput(
      "short output",
      "read_file",
      DEFAULT_SESSION_CONFIG
    );
    expect(result).toBe("short output");
  });

  it("truncates long output with head_tail mode", () => {
    const long = "x".repeat(100000);
    const result = truncateToolOutput(
      long,
      "read_file",
      DEFAULT_SESSION_CONFIG
    );
    expect(result.length).toBeLessThan(100000);
    expect(result).toContain("WARNING: output truncated");
    expect(result).toContain("chars removed");
  });

  it("truncates long output with tail mode", () => {
    const long = "x".repeat(50000);
    const result = truncateToolOutput(
      long,
      "grep",
      DEFAULT_SESSION_CONFIG
    );
    expect(result.length).toBeLessThan(50000);
    expect(result).toContain("Truncated");
  });

  it("applies line truncation after char truncation", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateToolOutput(
      lines,
      "shell",
      DEFAULT_SESSION_CONFIG
    );
    const resultLines = result.split("\n");
    expect(resultLines.length).toBeLessThanOrEqual(260); // 256 + some for markers
  });
});
