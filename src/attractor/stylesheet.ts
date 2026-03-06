import type { Graph, StylesheetRule, GraphNode } from "./types.js";

export function parseStylesheet(raw: string): StylesheetRule[] {
  const rules: StylesheetRule[] = [];
  // Match: selector { property: value; ... }
  const ruleRegex = /([*#.][a-zA-Z0-9_.-]*|\*)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(raw)) !== null) {
    const selector = match[1].trim();
    const body = match[2];

    let specificity = 0;
    if (selector.startsWith("#")) specificity = 2;
    else if (selector.startsWith(".")) specificity = 1;
    // * -> 0

    const properties: Record<string, string> = {};
    const propRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^;]+);?/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propRegex.exec(body)) !== null) {
      properties[propMatch[1].trim()] = propMatch[2].trim();
    }

    if (Object.keys(properties).length > 0) {
      rules.push({ selector, specificity, properties });
    }
  }

  return rules;
}

export function applyStylesheet(graph: Graph): void {
  const raw = graph.attributes.model_stylesheet;
  if (!raw || typeof raw !== "string") return;

  const rules = parseStylesheet(raw);

  for (const [nodeId, node] of graph.nodes) {
    // Snapshot explicit attributes before stylesheet application
    const explicitAttrs = new Set(Object.keys(node.attributes).filter(
      k => node.attributes[k] !== undefined
    ));

    // Collect applicable rules sorted by specificity (lowest first, so later = higher priority)
    const applicable = rules
      .filter((rule) => selectorMatches(rule.selector, nodeId, node))
      .sort((a, b) => a.specificity - b.specificity);

    // Apply properties: higher specificity overwrites lower, but explicit node attributes take priority
    for (const rule of applicable) {
      for (const [prop, value] of Object.entries(rule.properties)) {
        if (!explicitAttrs.has(prop)) {
          (node.attributes as Record<string, unknown>)[prop] = value;
        }
      }
    }
  }
}

function selectorMatches(
  selector: string,
  nodeId: string,
  node: GraphNode
): boolean {
  if (selector === "*") return true;
  if (selector.startsWith("#")) return selector.slice(1) === nodeId;
  if (selector.startsWith(".")) {
    const className = selector.slice(1);
    const classes = (node.attributes.class ?? "")
      .toString()
      .split(",")
      .map((s) => s.trim());
    return classes.includes(className);
  }
  return false;
}
