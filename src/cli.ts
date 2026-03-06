#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseDOT } from "./attractor/parser.js";
import { validateGraph } from "./attractor/validator.js";
import { applyStylesheet } from "./attractor/stylesheet.js";
import { PipelineRunner } from "./attractor/engine.js";
import { setInterviewer, setCodergenBackend } from "./attractor/handlers/index.js";
import {
  AutoApproveInterviewer,
  ConsoleInterviewer,
} from "./attractor/interviewer.js";
import { Client } from "./llm/client.js";
import type { CodergenBackend, GraphNode, PipelineContext, Outcome } from "./attractor/types.js";

// ─── Simple LLM-backed CodergenBackend ──────────────────────────────────────

class LLMCodergenBackend implements CodergenBackend {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  async run(
    node: GraphNode,
    prompt: string,
    context: PipelineContext
  ): Promise<Outcome> {
    const model =
      (node.attributes.llm_model as string) ?? "claude-sonnet-4-6";
    const provider = node.attributes.llm_provider as string | undefined;

    try {
      const response = await this.client.complete({
        model,
        provider,
        messages: [
          { role: "system", content: "You are a helpful coding assistant." },
          { role: "user", content: prompt },
        ],
        max_tokens: 4096,
      });

      const { responseText } = await import("./llm/types.js");
      const text = responseText(response);

      return {
        status: "success",
        context_updates: { [`codergen.${node.id}.response`]: text },
        notes: text,
      };
    } catch (err: unknown) {
      return {
        status: "fail",
        context_updates: {},
        failure_reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "run":
      await commandRun(args.slice(1));
      break;
    case "validate":
      await commandValidate(args.slice(1));
      break;
    case "parse":
      await commandParse(args.slice(1));
      break;
    default:
      // Treat as a file path
      if (command.endsWith(".dot") || command.endsWith(".gv")) {
        await commandRun([command, ...args.slice(1)]);
      } else {
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
      }
  }
}

function printUsage(): void {
  console.log(`
attractor - DOT-based pipeline orchestration for AI workflows

Usage:
  attractor run <file.dot> [options]    Run a pipeline
  attractor validate <file.dot>         Validate a DOT pipeline
  attractor parse <file.dot>            Parse and dump graph structure

Options:
  --logs-root <dir>     Directory for logs/checkpoints (default: .attractor/runs/<timestamp>)
  --auto-approve        Auto-approve human gates (non-interactive)
  --verbose             Show pipeline events
  -h, --help            Show this help
`);
}

async function commandRun(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error("Error: no DOT file specified");
    process.exit(1);
  }

  const verbose = args.includes("--verbose");
  const autoApprove = args.includes("--auto-approve");

  let logsRoot: string | undefined;
  const logsIdx = args.indexOf("--logs-root");
  if (logsIdx >= 0 && args[logsIdx + 1]) {
    logsRoot = args[logsIdx + 1];
  }

  // Read and parse
  const dotContent = await fs.readFile(
    path.resolve(filePath),
    "utf-8"
  );
  const graph = parseDOT(dotContent);
  applyStylesheet(graph);

  // Validate
  const results = validateGraph(graph);
  const errors = results.filter((r) => r.severity === "error");
  const warnings = results.filter((r) => r.severity === "warning");

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.warn(`WARNING: ${w.message}`);
    }
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`ERROR: ${e.message}`);
    }
    process.exit(1);
  }

  // Configure interviewer
  if (autoApprove) {
    setInterviewer(new AutoApproveInterviewer());
  } else {
    setInterviewer(new ConsoleInterviewer());
  }

  // Configure codergen backend if API keys available
  const client = Client.fromEnv();
  setCodergenBackend(new LLMCodergenBackend(client));

  // Run
  const runner = new PipelineRunner(graph, { logs_root: logsRoot });

  if (verbose) {
    runner.on_event((event) => {
      const data = JSON.stringify(event.data);
      console.log(
        `[${event.timestamp.toISOString()}] ${event.type}: ${data}`
      );
    });
  }

  console.log(`Running pipeline: ${graph.name}`);
  if (graph.attributes.goal) {
    console.log(`Goal: ${graph.attributes.goal}`);
  }
  console.log("");

  const outcome = await runner.run();

  console.log("");
  console.log(`Pipeline completed with status: ${outcome.status}`);
  if (outcome.failure_reason) {
    console.log(`Reason: ${outcome.failure_reason}`);
  }
  if (outcome.notes) {
    console.log(`Notes: ${outcome.notes}`);
  }

  process.exit(outcome.status === "success" ? 0 : 1);
}

async function commandValidate(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error("Error: no DOT file specified");
    process.exit(1);
  }

  const dotContent = await fs.readFile(
    path.resolve(filePath),
    "utf-8"
  );
  const graph = parseDOT(dotContent);
  applyStylesheet(graph);
  const results = validateGraph(graph);

  if (results.length === 0) {
    console.log("Validation passed: no issues found");
    return;
  }

  let hasErrors = false;
  for (const r of results) {
    const prefix = r.severity === "error" ? "ERROR" : "WARNING";
    const node = r.node_id ? ` (node: ${r.node_id})` : "";
    console.log(`${prefix}${node}: ${r.message}`);
    if (r.severity === "error") hasErrors = true;
  }

  process.exit(hasErrors ? 1 : 0);
}

async function commandParse(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error("Error: no DOT file specified");
    process.exit(1);
  }

  const dotContent = await fs.readFile(
    path.resolve(filePath),
    "utf-8"
  );
  const graph = parseDOT(dotContent);
  applyStylesheet(graph);

  console.log("Graph:", graph.name);
  console.log("Attributes:", JSON.stringify(graph.attributes, null, 2));
  console.log("\nNodes:");
  for (const [id, node] of graph.nodes) {
    console.log(`  ${id}: ${JSON.stringify(node.attributes)}`);
  }
  console.log("\nEdges:");
  for (const edge of graph.edges) {
    const attrs =
      Object.keys(edge.attributes).length > 0
        ? ` ${JSON.stringify(edge.attributes)}`
        : "";
    console.log(`  ${edge.source} -> ${edge.target}${attrs}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
