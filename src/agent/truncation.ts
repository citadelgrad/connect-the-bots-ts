import {
  DEFAULT_CHAR_LIMITS,
  DEFAULT_LINE_LIMITS,
  DEFAULT_TRUNCATION_MODES,
  type SessionConfig,
} from "./types.js";

export function truncateToolOutput(
  output: string,
  toolName: string,
  config: SessionConfig
): string {
  // Stage 1: Character-based truncation
  const maxChars =
    config.tool_output_limits[toolName] ??
    DEFAULT_CHAR_LIMITS[toolName] ??
    50000;
  const mode = DEFAULT_TRUNCATION_MODES[toolName] ?? "head_tail";
  let result = truncateChars(output, maxChars, mode);

  // Stage 2: Line-based truncation
  const maxLines =
    config.tool_line_limits[toolName] ?? DEFAULT_LINE_LIMITS[toolName];
  if (maxLines !== undefined) {
    result = truncateLines(result, maxLines);
  }

  return result;
}

function truncateChars(
  output: string,
  maxChars: number,
  mode: "head_tail" | "tail"
): string {
  if (output.length <= maxChars) return output;

  if (mode === "head_tail") {
    const half = Math.floor(maxChars / 2);
    const removed = output.length - maxChars;
    return (
      output.slice(0, half) +
      `\n\n[WARNING: output truncated. ${removed} chars removed. Full output in event stream.]\n\n` +
      output.slice(-half)
    );
  }

  // tail mode
  const removed = output.length - maxChars;
  return (
    `[WARNING: Truncated. First ${removed} chars removed.]\n\n` +
    output.slice(-maxChars)
  );
}

function truncateLines(output: string, maxLines: number): string {
  const lines = output.split("\n");
  if (lines.length <= maxLines) return output;

  const headCount = Math.floor(maxLines / 2);
  const tailCount = maxLines - headCount;
  const omitted = lines.length - headCount - tailCount;

  return (
    lines.slice(0, headCount).join("\n") +
    `\n[... ${omitted} lines omitted ...]\n` +
    lines.slice(-tailCount).join("\n")
  );
}
