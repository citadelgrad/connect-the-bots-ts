// ─── Unified LLM Client Types ───────────────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool" | "developer";

export type ContentKind =
  | "text"
  | "image"
  | "audio"
  | "document"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "redacted_thinking";

export interface ImageData {
  url?: string;
  data?: string; // base64-encoded
  media_type?: string;
  detail?: "auto" | "low" | "high";
}

export interface ToolCallData {
  id: string;
  name: string;
  arguments: Record<string, unknown> | string;
  type?: string;
}

export interface ToolResultData {
  tool_call_id: string;
  content: string | Record<string, unknown>;
  is_error: boolean;
  image_data?: string;
  image_media_type?: string;
}

export interface ThinkingData {
  text: string;
  signature?: string;
  redacted?: boolean;
}

export interface ContentPart {
  kind: ContentKind;
  text?: string;
  image?: ImageData;
  tool_call?: ToolCallData;
  tool_result?: ToolResultData;
  thinking?: ThinkingData;
}

export interface Message {
  role: Role;
  content: ContentPart[] | string;
  name?: string;
  tool_call_id?: string;
}

export const Msg = {
  system(text: string): Message {
    return { role: "system", content: text };
  },
  user(text: string): Message {
    return { role: "user", content: text };
  },
  assistant(text: string): Message {
    return { role: "assistant", content: text };
  },
  toolResult(
    tool_call_id: string,
    content: string,
    is_error = false
  ): Message {
    return {
      role: "tool",
      content: [
        {
          kind: "tool_result",
          tool_result: { tool_call_id, content, is_error },
        },
      ],
      tool_call_id,
    };
  },
};

// ─── Tool Definitions ──────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema, root "object"
  execute?: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolChoice {
  mode: "auto" | "none" | "required" | "named";
  tool_name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  raw_arguments?: string;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error: boolean;
}

// ─── Request / Response ─────────────────────────────────────────────────────

export interface ResponseFormat {
  type: "text" | "json" | "json_schema";
  json_schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface Request {
  model: string;
  messages: Message[];
  provider?: string;
  tools?: ToolDefinition[];
  tool_choice?: ToolChoice | string;
  response_format?: ResponseFormat;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop_sequences?: string[];
  reasoning_effort?: "none" | "low" | "medium" | "high";
  metadata?: Record<string, string>;
  provider_options?: Record<string, unknown>;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  raw?: Record<string, unknown>;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
    cache_read_tokens:
      (a.cache_read_tokens ?? 0) + (b.cache_read_tokens ?? 0),
    cache_write_tokens:
      (a.cache_write_tokens ?? 0) + (b.cache_write_tokens ?? 0),
  };
}

export interface FinishReason {
  reason:
    | "stop"
    | "length"
    | "tool_calls"
    | "content_filter"
    | "error"
    | "other";
  raw?: string;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: Date;
}

export interface Warning {
  type: string;
  message: string;
}

export interface Response {
  id: string;
  model: string;
  provider: string;
  message: Message;
  finish_reason: FinishReason;
  usage: Usage;
  raw?: Record<string, unknown>;
  warnings?: Warning[];
  rate_limit?: RateLimitInfo;
}

// ─── Convenience accessors ──────────────────────────────────────────────────

export function responseText(r: Response): string {
  if (typeof r.message.content === "string") return r.message.content;
  return r.message.content
    .filter((p) => p.kind === "text")
    .map((p) => p.text ?? "")
    .join("");
}

export function responseToolCalls(r: Response): ToolCall[] {
  if (typeof r.message.content === "string") return [];
  return r.message.content
    .filter((p) => p.kind === "tool_call" && p.tool_call)
    .map((p) => {
      const tc = p.tool_call!;
      const args =
        typeof tc.arguments === "string"
          ? JSON.parse(tc.arguments)
          : tc.arguments;
      return { id: tc.id, name: tc.name, arguments: args };
    });
}

export function responseReasoning(r: Response): string | undefined {
  if (typeof r.message.content === "string") return undefined;
  const parts = r.message.content
    .filter((p) => p.kind === "thinking" && p.thinking)
    .map((p) => p.thinking!.text);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

// ─── Streaming ──────────────────────────────────────────────────────────────

export type StreamEventType =
  | "stream_start"
  | "text_start"
  | "text_delta"
  | "text_end"
  | "reasoning_start"
  | "reasoning_delta"
  | "reasoning_end"
  | "tool_call_start"
  | "tool_call_delta"
  | "tool_call_end"
  | "finish"
  | "error"
  | "provider_event";

export interface StreamEvent {
  type: StreamEventType;
  delta?: string;
  text_id?: string;
  reasoning_delta?: string;
  tool_call?: Partial<ToolCall>;
  finish_reason?: FinishReason;
  usage?: Usage;
  response?: Response;
  error?: SDKError;
  raw?: Record<string, unknown>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class SDKError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SDKError";
  }
}

export class ProviderError extends SDKError {
  constructor(
    message: string,
    public status_code?: number,
    public error_code?: string,
    public retryable = false,
    public retry_after?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string) {
    super(message, 401, "authentication_error", false);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string, retry_after?: number) {
    super(message, 429, "rate_limit_error", true, retry_after);
    this.name = "RateLimitError";
  }
}

export class ServerError extends ProviderError {
  constructor(message: string, status_code = 500) {
    super(message, status_code, "server_error", true);
    this.name = "ServerError";
  }
}

export class InvalidRequestError extends ProviderError {
  constructor(message: string) {
    super(message, 400, "invalid_request", false);
    this.name = "InvalidRequestError";
  }
}

export class ContextLengthError extends ProviderError {
  constructor(message: string) {
    super(message, 413, "context_length_exceeded", false);
    this.name = "ContextLengthError";
  }
}

export class NetworkError extends SDKError {
  retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class RequestTimeoutError extends SDKError {
  retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export class ConfigurationError extends SDKError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// ─── Retry Policy ───────────────────────────────────────────────────────────

export interface RetryPolicy {
  max_retries: number;
  base_delay: number;
  max_delay: number;
  backoff_multiplier: number;
  jitter: boolean;
  on_retry?: (attempt: number, error: Error, delay: number) => void;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_retries: 2,
  base_delay: 1.0,
  max_delay: 60.0,
  backoff_multiplier: 2.0,
  jitter: true,
};

// ─── Model Catalog ──────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  provider: string;
  display_name: string;
  context_window: number;
  max_output?: number;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_reasoning: boolean;
  input_cost_per_million?: number;
  output_cost_per_million?: number;
  aliases?: string[];
}

// ─── Provider Adapter ───────────────────────────────────────────────────────

export interface ProviderAdapter {
  name: string;
  complete(request: Request): Promise<Response>;
  stream?(request: Request): AsyncGenerator<StreamEvent>;
  close?(): Promise<void>;
  initialize?(): Promise<void>;
  supports_tool_choice?(mode: string): boolean;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export type Middleware = (
  request: Request,
  next: (request: Request) => Promise<Response>
) => Promise<Response>;
