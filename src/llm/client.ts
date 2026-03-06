import {
  type Request,
  type Response,
  type ProviderAdapter,
  type Middleware,
  type RetryPolicy,
  type ToolDefinition,
  type ToolCall,
  type Usage,
  type StreamEvent,
  type FinishReason,
  DEFAULT_RETRY_POLICY,
  ConfigurationError,
  SDKError,
  ProviderError,
  Msg,
  addUsage,
  responseText,
  responseToolCalls,
  responseReasoning,
} from "./types.js";
import { OpenAIAdapter, AnthropicAdapter, GeminiAdapter } from "./adapters.js";

// ─── Client ─────────────────────────────────────────────────────────────────

export interface ClientConfig {
  providers?: Record<string, ProviderAdapter>;
  default_provider?: string;
  middleware?: Middleware[];
  retry_policy?: RetryPolicy;
}

export class Client {
  private providers: Map<string, ProviderAdapter>;
  private defaultProvider: string;
  private middleware: Middleware[];
  private retryPolicy: RetryPolicy;

  constructor(config?: ClientConfig) {
    this.providers = new Map(
      Object.entries(config?.providers ?? {})
    );
    this.defaultProvider = config?.default_provider ?? "anthropic";
    this.middleware = config?.middleware ?? [];
    this.retryPolicy = config?.retry_policy ?? DEFAULT_RETRY_POLICY;
  }

  static fromEnv(): Client {
    const providers: Record<string, ProviderAdapter> = {};
    if (process.env.OPENAI_API_KEY) {
      providers.openai = new OpenAIAdapter();
    }
    if (process.env.ANTHROPIC_API_KEY) {
      providers.anthropic = new AnthropicAdapter();
    }
    if (process.env.GEMINI_API_KEY) {
      providers.gemini = new GeminiAdapter();
    }

    const defaultProvider = process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.GEMINI_API_KEY
          ? "gemini"
          : "anthropic";

    return new Client({ providers, default_provider: defaultProvider });
  }

  registerProvider(name: string, adapter: ProviderAdapter): void {
    this.providers.set(name, adapter);
  }

  async complete(request: Request): Promise<Response> {
    const provider = this.resolveProvider(request);
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new ConfigurationError(
        `No adapter registered for provider "${provider}". ` +
          `Available: ${[...this.providers.keys()].join(", ")}`
      );
    }

    const chain = this.buildChain(adapter);
    return chain({ ...request, provider });
  }

  async *stream(request: Request): AsyncGenerator<StreamEvent> {
    const provider = this.resolveProvider(request);
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new ConfigurationError(
        `No adapter registered for provider "${provider}"`
      );
    }
    if (!adapter.stream) {
      // Fallback: call complete and yield synthetic events
      const response = await this.complete(request);
      yield {
        type: "stream_start",
      };
      yield {
        type: "text_delta",
        delta: responseText(response),
      };
      yield {
        type: "finish",
        finish_reason: response.finish_reason,
        usage: response.usage,
        response,
      };
      return;
    }
    yield* adapter.stream({ ...request, provider });
  }

  private resolveProvider(request: Request): string {
    return request.provider ?? this.defaultProvider;
  }

  private buildChain(
    adapter: ProviderAdapter
  ): (request: Request) => Promise<Response> {
    let handler = (req: Request) => adapter.complete(req);
    // Apply middleware in reverse order so first registered runs first
    for (let i = this.middleware.length - 1; i >= 0; i--) {
      const mw = this.middleware[i];
      const next = handler;
      handler = (req) => mw(req, next);
    }
    return handler;
  }
}

// ─── High-Level API ─────────────────────────────────────────────────────────

export interface GenerateOptions {
  model: string;
  provider?: string;
  messages?: Message[];
  prompt?: string;
  tools?: ToolDefinition[];
  max_tool_rounds?: number;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: "none" | "low" | "medium" | "high";
  provider_options?: Record<string, unknown>;
  abort_signal?: AbortSignal;
  retry_policy?: RetryPolicy;
}

type Message = import("./types.js").Message;

export interface GenerateResult {
  text: string;
  reasoning?: string;
  tool_calls: ToolCall[];
  tool_results: Array<{ tool_call_id: string; content: string; is_error: boolean }>;
  finish_reason: FinishReason;
  usage: Usage;
  total_usage: Usage;
  steps: StepResult[];
  response: Response;
  output?: unknown;
}

export interface StepResult {
  response: Response;
  tool_calls: ToolCall[];
  tool_results: Array<{ tool_call_id: string; content: string; is_error: boolean }>;
}

export async function generate(
  client: Client,
  options: GenerateOptions
): Promise<GenerateResult> {
  const maxRounds = options.max_tool_rounds ?? 1;
  const messages: Message[] = [];

  if (options.prompt) {
    messages.push(Msg.user(options.prompt));
  }
  if (options.messages) {
    messages.push(...options.messages);
  }

  const steps: StepResult[] = [];
  let totalUsage: Usage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  let lastResponse: Response | undefined;
  let roundCount = 0;

  const retryPolicy = options.retry_policy ?? DEFAULT_RETRY_POLICY;

  while (true) {
    const request: Request = {
      model: options.model,
      messages: [...messages],
      provider: options.provider,
      tools: options.tools,
      tool_choice: options.tools?.length ? "auto" : undefined,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      reasoning_effort: options.reasoning_effort,
      provider_options: options.provider_options,
    };

    lastResponse = await retryWithPolicy(
      () => client.complete(request),
      retryPolicy
    );

    totalUsage = addUsage(totalUsage, lastResponse.usage);
    const toolCalls = responseToolCalls(lastResponse);

    // Record assistant message
    messages.push(lastResponse.message);

    if (toolCalls.length === 0 || roundCount >= maxRounds) {
      steps.push({
        response: lastResponse,
        tool_calls: toolCalls,
        tool_results: [],
      });
      break;
    }

    // Execute tools
    const toolResults: Array<{ tool_call_id: string; content: string; is_error: boolean }> = [];
    const toolsMap = new Map(
      (options.tools ?? []).map((t) => [t.name, t])
    );

    const execPromises = toolCalls.map(async (tc) => {
      const tool = toolsMap.get(tc.name);
      if (!tool?.execute) {
        return {
          tool_call_id: tc.id,
          content: `Tool "${tc.name}" has no execute handler`,
          is_error: true,
        };
      }
      try {
        const result = await tool.execute(tc.arguments);
        return { tool_call_id: tc.id, content: result, is_error: false };
      } catch (err: unknown) {
        return {
          tool_call_id: tc.id,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        };
      }
    });

    const results = await Promise.all(execPromises);
    toolResults.push(...results);

    steps.push({
      response: lastResponse,
      tool_calls: toolCalls,
      tool_results: toolResults,
    });

    // Add tool results to conversation
    for (const tr of toolResults) {
      messages.push(Msg.toolResult(tr.tool_call_id, tr.content, tr.is_error));
    }

    roundCount++;
  }

  return {
    text: responseText(lastResponse!),
    reasoning: responseReasoning(lastResponse!),
    tool_calls: responseToolCalls(lastResponse!),
    tool_results: steps.flatMap((s) => s.tool_results),
    finish_reason: lastResponse!.finish_reason,
    usage: lastResponse!.usage,
    total_usage: totalUsage,
    steps,
    response: lastResponse!,
  };
}

// ─── Retry Helper ───────────────────────────────────────────────────────────

async function retryWithPolicy<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= policy.max_retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const retryable =
        err instanceof ProviderError ? err.retryable : err instanceof SDKError;
      if (!retryable || attempt === policy.max_retries) {
        throw lastError;
      }

      let delay =
        policy.base_delay * Math.pow(policy.backoff_multiplier, attempt);
      delay = Math.min(delay, policy.max_delay);
      if (policy.jitter) {
        delay *= 0.5 + Math.random();
      }

      if (
        err instanceof ProviderError &&
        err.retry_after !== undefined
      ) {
        delay = Math.min(err.retry_after, policy.max_delay);
      }

      policy.on_retry?.(attempt, lastError, delay);
      await new Promise((r) => setTimeout(r, delay * 1000));
    }
  }
  throw lastError;
}

// ─── Model Catalog ──────────────────────────────────────────────────────────

import type { ModelInfo } from "./types.js";

const MODEL_CATALOG: ModelInfo[] = [
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    display_name: "Claude Opus 4.6",
    context_window: 200000,
    max_output: 32000,
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: true,
    aliases: ["claude-opus"],
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    display_name: "Claude Sonnet 4.6",
    context_window: 200000,
    max_output: 16000,
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: true,
    aliases: ["claude-sonnet"],
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    display_name: "Claude Haiku 4.5",
    context_window: 200000,
    max_output: 8192,
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: false,
    aliases: ["claude-haiku"],
  },
  {
    id: "gpt-4o",
    provider: "openai",
    display_name: "GPT-4o",
    context_window: 128000,
    max_output: 16384,
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: false,
    aliases: [],
  },
  {
    id: "o3",
    provider: "openai",
    display_name: "o3",
    context_window: 200000,
    max_output: 100000,
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: true,
    aliases: [],
  },
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    display_name: "Gemini 2.5 Pro",
    context_window: 1000000,
    max_output: 65536,
    supports_tools: true,
    supports_vision: true,
    supports_reasoning: true,
    aliases: ["gemini-pro"],
  },
];

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find(
    (m) => m.id === modelId || m.aliases?.includes(modelId)
  );
}

export function listModels(provider?: string): ModelInfo[] {
  if (provider) {
    return MODEL_CATALOG.filter((m) => m.provider === provider);
  }
  return [...MODEL_CATALOG];
}
