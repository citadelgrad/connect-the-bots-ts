import type { ToolCall, Usage, ToolDefinition } from "../llm/types.js";

// ─── Turn Types ─────────────────────────────────────────────────────────────

export interface UserTurn {
  type: "user";
  content: string;
  timestamp: Date;
}

export interface AssistantTurn {
  type: "assistant";
  content: string;
  tool_calls: ToolCall[];
  reasoning?: string;
  usage: Usage;
  response_id?: string;
  timestamp: Date;
}

export interface ToolResultsTurn {
  type: "tool_results";
  results: ToolResultEntry[];
  timestamp: Date;
}

export interface ToolResultEntry {
  tool_call_id: string;
  content: string;
  is_error: boolean;
}

export interface SystemTurn {
  type: "system";
  content: string;
  timestamp: Date;
}

export interface SteeringTurn {
  type: "steering";
  content: string;
  timestamp: Date;
}

export type Turn =
  | UserTurn
  | AssistantTurn
  | ToolResultsTurn
  | SystemTurn
  | SteeringTurn;

// ─── Session Config ─────────────────────────────────────────────────────────

export interface SessionConfig {
  max_turns: number;
  max_tool_rounds_per_input: number;
  default_command_timeout_ms: number;
  max_command_timeout_ms: number;
  reasoning_effort?: "low" | "medium" | "high";
  tool_output_limits: Record<string, number>;
  tool_line_limits: Record<string, number>;
  enable_loop_detection: boolean;
  loop_detection_window: number;
  max_subagent_depth: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  max_turns: 0,
  max_tool_rounds_per_input: 0,
  default_command_timeout_ms: 10000,
  max_command_timeout_ms: 600000,
  tool_output_limits: {},
  tool_line_limits: {},
  enable_loop_detection: true,
  loop_detection_window: 10,
  max_subagent_depth: 1,
};

// ─── Session State ──────────────────────────────────────────────────────────

export type SessionState = "idle" | "processing" | "awaiting_input" | "closed";

// ─── Events ─────────────────────────────────────────────────────────────────

export type EventKind =
  | "session_start"
  | "session_end"
  | "user_input"
  | "assistant_text_start"
  | "assistant_text_delta"
  | "assistant_text_end"
  | "tool_call_start"
  | "tool_call_output_delta"
  | "tool_call_end"
  | "steering_injected"
  | "turn_limit"
  | "loop_detection"
  | "error";

export interface SessionEvent {
  kind: EventKind;
  timestamp: Date;
  session_id: string;
  data: Record<string, unknown>;
}

export type EventHandler = (event: SessionEvent) => void;

// ─── Execution Environment ──────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  duration_ms: number;
}

export interface GrepOptions {
  case_insensitive?: boolean;
  max_results?: number;
  glob_filter?: string;
}

export interface ExecutionEnvironment {
  read_file(
    path: string,
    offset?: number,
    limit?: number
  ): Promise<string>;
  write_file(path: string, content: string): Promise<void>;
  file_exists(path: string): Promise<boolean>;
  list_directory(path: string, depth?: number): Promise<string[]>;
  exec_command(
    command: string,
    timeout_ms?: number,
    working_dir?: string,
    env_vars?: Record<string, string>
  ): Promise<ExecResult>;
  grep(pattern: string, path: string, options?: GrepOptions): Promise<string>;
  glob(pattern: string, path?: string): Promise<string[]>;
  working_directory(): string;
  platform(): string;
  os_version(): string;
}

// ─── Tool Registry ──────────────────────────────────────────────────────────

export type ToolExecutor = (
  args: Record<string, unknown>,
  env: ExecutionEnvironment
) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}

// ─── Provider Profile ───────────────────────────────────────────────────────

export interface ProviderProfile {
  id: string;
  model: string;
  tool_registry: ToolRegistry;
  supports_reasoning: boolean;
  supports_streaming: boolean;
  supports_parallel_tool_calls: boolean;
  context_window_size: number;
  build_system_prompt(
    environment: ExecutionEnvironment,
    project_docs?: string
  ): string;
  tools(): ToolDefinition[];
  provider_options?(): Record<string, unknown> | undefined;
}

// ─── SubAgent ───────────────────────────────────────────────────────────────

export interface SubAgentHandle {
  id: string;
  status: "running" | "completed" | "failed";
}

export interface SubAgentResult {
  output: string;
  success: boolean;
  turns_used: number;
}

// ─── Default Tool Output Limits ─────────────────────────────────────────────

export const DEFAULT_CHAR_LIMITS: Record<string, number> = {
  read_file: 50000,
  shell: 30000,
  grep: 20000,
  glob: 20000,
  edit_file: 10000,
  apply_patch: 10000,
  write_file: 1000,
};

export const DEFAULT_LINE_LIMITS: Record<string, number> = {
  shell: 256,
  grep: 200,
  glob: 500,
};

export const DEFAULT_TRUNCATION_MODES: Record<string, "head_tail" | "tail"> = {
  read_file: "head_tail",
  shell: "head_tail",
  grep: "tail",
  glob: "tail",
  edit_file: "tail",
  apply_patch: "tail",
  write_file: "tail",
};
