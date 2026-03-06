import type { PipelineContext, Outcome } from "./types.js";

interface Clause {
  key: string;
  operator: "=" | "!=";
  value: string;
}

function parseClauses(expr: string): Clause[] {
  return expr
    .split("&&")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((clause) => {
      const match = clause.match(
        /^([a-zA-Z_.][a-zA-Z0-9_.]*)\s*(=|!=)\s*(.+)$/
      );
      if (!match) {
        throw new Error(`Invalid condition clause: "${clause}"`);
      }
      return {
        key: match[1],
        operator: match[2] as "=" | "!=",
        value: match[3].trim().replace(/^["']|["']$/g, ""),
      };
    });
}

function resolveKey(
  key: string,
  outcome: Outcome,
  context: PipelineContext
): string {
  if (key === "outcome") return outcome.status;
  if (key === "preferred_label") return outcome.preferred_label ?? "";
  if (key.startsWith("context.")) {
    const ctxKey = key.slice("context.".length);
    const val = context.get(ctxKey, "");
    return String(val);
  }
  return "";
}

export function evaluateCondition(
  condition: string | undefined,
  outcome: Outcome,
  context: PipelineContext
): boolean {
  if (!condition || condition.trim() === "") return true;

  const clauses = parseClauses(condition);
  return clauses.every((clause) => {
    const actual = resolveKey(clause.key, outcome, context);
    if (clause.operator === "=") return actual === clause.value;
    if (clause.operator === "!=") return actual !== clause.value;
    return false;
  });
}
