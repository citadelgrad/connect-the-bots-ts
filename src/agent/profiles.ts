import type { ToolDefinition } from "../llm/types.js";
import type {
  ProviderProfile,
  ExecutionEnvironment,
  ToolRegistry,
} from "./types.js";
import { ToolRegistry as ToolRegistryImpl } from "./types.js";
import { createCoreTools } from "./tools.js";

function buildEnvironmentBlock(env: ExecutionEnvironment): string {
  return [
    "<environment>",
    `Working directory: ${env.working_directory()}`,
    `Platform: ${env.platform()}`,
    `OS version: ${env.os_version()}`,
    `Today's date: ${new Date().toISOString().split("T")[0]}`,
    "</environment>",
  ].join("\n");
}

function buildBasePrompt(
  env: ExecutionEnvironment,
  projectDocs?: string
): string {
  const parts: string[] = [];
  parts.push(
    "You are an autonomous coding agent. Use the available tools to complete the task.",
    "Read files before editing. Prefer editing existing files over creating new ones.",
    "Run tests to verify your changes when possible.",
    ""
  );
  parts.push(buildEnvironmentBlock(env));
  if (projectDocs) {
    parts.push("", projectDocs);
  }
  return parts.join("\n");
}

export function createAnthropicProfile(
  model = "claude-sonnet-4-6"
): ProviderProfile {
  const registry = new ToolRegistryImpl();
  for (const tool of createCoreTools()) {
    registry.register(tool);
  }

  return {
    id: "anthropic",
    model,
    tool_registry: registry,
    supports_reasoning: true,
    supports_streaming: true,
    supports_parallel_tool_calls: true,
    context_window_size: 200000,
    build_system_prompt: buildBasePrompt,
    tools: () => registry.definitions(),
  };
}

export function createOpenAIProfile(model = "gpt-4o"): ProviderProfile {
  const registry = new ToolRegistryImpl();
  for (const tool of createCoreTools()) {
    registry.register(tool);
  }

  return {
    id: "openai",
    model,
    tool_registry: registry,
    supports_reasoning: model.startsWith("o"),
    supports_streaming: true,
    supports_parallel_tool_calls: true,
    context_window_size: 128000,
    build_system_prompt: buildBasePrompt,
    tools: () => registry.definitions(),
  };
}

export function createGeminiProfile(
  model = "gemini-2.5-pro"
): ProviderProfile {
  const registry = new ToolRegistryImpl();
  for (const tool of createCoreTools()) {
    registry.register(tool);
  }

  return {
    id: "gemini",
    model,
    tool_registry: registry,
    supports_reasoning: true,
    supports_streaming: true,
    supports_parallel_tool_calls: true,
    context_window_size: 1000000,
    build_system_prompt: buildBasePrompt,
    tools: () => registry.definitions(),
  };
}
