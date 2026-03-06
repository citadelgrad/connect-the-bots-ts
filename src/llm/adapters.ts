import {
  type Request,
  type Response,
  type StreamEvent,
  type ProviderAdapter,
  type Usage,
  type FinishReason,
  type ContentPart,
  type ToolCall,
  type Message,
  ProviderError,
  AuthenticationError,
  RateLimitError,
  ServerError,
  InvalidRequestError,
  ContextLengthError,
  NetworkError,
  RequestTimeoutError,
} from "./types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractSystemAndMessages(messages: Message[]): {
  system: string | undefined;
  rest: Message[];
} {
  const systemParts: string[] = [];
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((p) => p.kind === "text")
              .map((p) => p.text)
              .join("\n");
      systemParts.push(text);
    } else {
      rest.push(m);
    }
  }
  return {
    system: systemParts.length > 0 ? systemParts.join("\n") : undefined,
    rest,
  };
}

function messageContentToText(content: ContentPart[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.kind === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function mapProviderError(
  status: number,
  body: string,
  provider: string
): never {
  const msg = `${provider} API error (${status}): ${body}`;
  if (status === 401) throw new AuthenticationError(msg);
  if (status === 429) throw new RateLimitError(msg);
  if (status === 400 || status === 422) throw new InvalidRequestError(msg);
  if (status === 413) throw new ContextLengthError(msg);
  if (status >= 500) throw new ServerError(msg, status);
  throw new ProviderError(msg, status);
}

async function fetchJSON(
  url: string,
  options: RequestInit
): Promise<{ status: number; body: unknown; raw: string }> {
  let resp: globalThis.Response;
  try {
    resp = await fetch(url, options);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("abort"))
    ) {
      throw new RequestTimeoutError("Request aborted");
    }
    throw new NetworkError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const raw = await resp.text();
  if (!resp.ok) {
    mapProviderError(resp.status, raw, "provider");
  }
  return { status: resp.status, body: JSON.parse(raw), raw };
}

// ─── OpenAI Adapter (Responses API) ─────────────────────────────────────────

export interface OpenAIAdapterConfig {
  api_key?: string;
  base_url?: string;
  organization?: string;
  project?: string;
}

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  private apiKey: string;
  private baseUrl: string;
  private organization?: string;
  private project?: string;

  constructor(config?: OpenAIAdapterConfig) {
    this.apiKey =
      config?.api_key ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl =
      config?.base_url ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com";
    this.organization =
      config?.organization ?? process.env.OPENAI_ORG_ID;
    this.project = config?.project ?? process.env.OPENAI_PROJECT_ID;
  }

  async complete(request: Request): Promise<Response> {
    const { system, rest } = extractSystemAndMessages(request.messages);
    const input = rest.map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: messageContentToText(m.content),
    }));

    const body: Record<string, unknown> = {
      model: request.model,
      input,
      ...(system ? { instructions: system } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.max_tokens !== undefined
        ? { max_output_tokens: request.max_tokens }
        : {}),
      ...(request.reasoning_effort &&
      request.reasoning_effort !== "none"
        ? { reasoning: { effort: request.reasoning_effort } }
        : {}),
    };

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organization) headers["OpenAI-Organization"] = this.organization;
    if (this.project) headers["OpenAI-Project"] = this.project;

    const { body: respBody } = await fetchJSON(
      `${this.baseUrl}/v1/responses`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }
    );

    return this.parseResponse(respBody as Record<string, unknown>);
  }

  private parseResponse(raw: Record<string, unknown>): Response {
    const output = raw.output as Array<Record<string, unknown>> ?? [];
    const contentParts: ContentPart[] = [];
    const toolCalls: ToolCall[] = [];

    for (const item of output) {
      if (item.type === "message") {
        const content = item.content as Array<Record<string, unknown>> ?? [];
        for (const c of content) {
          if (c.type === "output_text") {
            contentParts.push({ kind: "text", text: c.text as string });
          }
        }
      } else if (item.type === "function_call") {
        const tc: ToolCall = {
          id: item.call_id as string ?? item.id as string,
          name: item.name as string,
          arguments:
            typeof item.arguments === "string"
              ? JSON.parse(item.arguments as string)
              : (item.arguments as Record<string, unknown>),
        };
        toolCalls.push(tc);
        contentParts.push({
          kind: "tool_call",
          tool_call: {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          },
        });
      }
    }

    const usageRaw = (raw.usage ?? {}) as Record<string, unknown>;
    const usage: Usage = {
      input_tokens: (usageRaw.input_tokens as number) ?? 0,
      output_tokens: (usageRaw.output_tokens as number) ?? 0,
      total_tokens:
        ((usageRaw.input_tokens as number) ?? 0) +
        ((usageRaw.output_tokens as number) ?? 0),
      reasoning_tokens:
        (
          (usageRaw.output_tokens_details as Record<string, unknown>)
            ?.reasoning_tokens as number
        ) ?? undefined,
    };

    const finishReason: FinishReason = {
      reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      raw: raw.status as string,
    };

    return {
      id: raw.id as string,
      model: raw.model as string ?? "",
      provider: "openai",
      message: { role: "assistant", content: contentParts },
      finish_reason: finishReason,
      usage,
      raw,
    };
  }
}

// ─── Anthropic Adapter (Messages API) ───────────────────────────────────────

export interface AnthropicAdapterConfig {
  api_key?: string;
  base_url?: string;
}

export class AnthropicAdapter implements ProviderAdapter {
  name = "anthropic";
  private apiKey: string;
  private baseUrl: string;

  constructor(config?: AnthropicAdapterConfig) {
    this.apiKey =
      config?.api_key ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.baseUrl =
      config?.base_url ??
      process.env.ANTHROPIC_BASE_URL ??
      "https://api.anthropic.com";
  }

  async complete(request: Request): Promise<Response> {
    const { system, rest } = extractSystemAndMessages(request.messages);

    // Enforce user/assistant alternation by merging consecutive same-role
    const mergedMessages = this.enforceAlternation(rest);

    const body: Record<string, unknown> = {
      model: request.model,
      messages: mergedMessages.map((m) => this.convertMessage(m)),
      max_tokens: request.max_tokens ?? 4096,
      ...(system ? { system } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.stop_sequences?.length
        ? { stop_sequences: request.stop_sequences }
        : {}),
    };

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const tc = request.tool_choice;
    if (tc) {
      const mode = typeof tc === "string" ? tc : tc.mode;
      if (mode === "auto") body.tool_choice = { type: "auto" };
      else if (mode === "required") body.tool_choice = { type: "any" };
      else if (mode === "named" && typeof tc !== "string")
        body.tool_choice = { type: "tool", name: tc.tool_name };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };

    // Enable extended thinking if provider_options say so
    const provOpts = request.provider_options?.anthropic as
      | Record<string, unknown>
      | undefined;
    if (provOpts?.thinking) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
      body.thinking = provOpts.thinking;
    }

    const { body: respBody } = await fetchJSON(
      `${this.baseUrl}/v1/messages`,
      { method: "POST", headers, body: JSON.stringify(body) }
    );

    return this.parseResponse(respBody as Record<string, unknown>);
  }

  private enforceAlternation(messages: Message[]): Message[] {
    const result: Message[] = [];
    for (const m of messages) {
      const role = m.role === "tool" ? "user" : m.role;
      if (
        result.length > 0 &&
        (result[result.length - 1].role === role ||
          (result[result.length - 1].role === "user" && m.role === "tool"))
      ) {
        // Merge content
        const prev = result[result.length - 1];
        const prevText =
          typeof prev.content === "string"
            ? prev.content
            : prev.content
                .map((p) => p.text ?? "")
                .join("");
        const curText =
          typeof m.content === "string"
            ? m.content
            : m.content
                .map((p) => p.text ?? "")
                .join("");
        prev.content = prevText + "\n" + curText;
      } else {
        result.push({ ...m, role: role as Message["role"] });
      }
    }
    return result;
  }

  private convertMessage(
    m: Message
  ): Record<string, unknown> {
    const role = m.role === "tool" ? "user" : m.role;
    if (typeof m.content === "string") {
      return { role, content: m.content };
    }

    const content: Array<Record<string, unknown>> = [];
    for (const part of m.content) {
      if (part.kind === "text") {
        content.push({ type: "text", text: part.text ?? "" });
      } else if (part.kind === "tool_call" && part.tool_call) {
        content.push({
          type: "tool_use",
          id: part.tool_call.id,
          name: part.tool_call.name,
          input:
            typeof part.tool_call.arguments === "string"
              ? JSON.parse(part.tool_call.arguments)
              : part.tool_call.arguments,
        });
      } else if (part.kind === "tool_result" && part.tool_result) {
        content.push({
          type: "tool_result",
          tool_use_id: part.tool_result.tool_call_id,
          content:
            typeof part.tool_result.content === "string"
              ? part.tool_result.content
              : JSON.stringify(part.tool_result.content),
          is_error: part.tool_result.is_error,
        });
      } else if (part.kind === "thinking" && part.thinking) {
        content.push({
          type: "thinking",
          thinking: part.thinking.text,
          ...(part.thinking.signature
            ? { signature: part.thinking.signature }
            : {}),
        });
      } else if (part.kind === "image" && part.image) {
        content.push({
          type: "image",
          source: {
            type: part.image.data ? "base64" : "url",
            ...(part.image.data
              ? {
                  data: part.image.data,
                  media_type: part.image.media_type ?? "image/png",
                }
              : { url: part.image.url }),
          },
        });
      }
    }

    return {
      role,
      content: content.length === 1 && content[0].type === "text"
        ? (content[0].text as string)
        : content,
    };
  }

  private parseResponse(raw: Record<string, unknown>): Response {
    const rawContent = (raw.content ?? []) as Array<Record<string, unknown>>;
    const contentParts: ContentPart[] = [];

    for (const block of rawContent) {
      if (block.type === "text") {
        contentParts.push({ kind: "text", text: block.text as string });
      } else if (block.type === "tool_use") {
        contentParts.push({
          kind: "tool_call",
          tool_call: {
            id: block.id as string,
            name: block.name as string,
            arguments: block.input as Record<string, unknown>,
          },
        });
      } else if (block.type === "thinking") {
        contentParts.push({
          kind: "thinking",
          thinking: {
            text: (block.thinking as string) ?? "",
            signature: block.signature as string | undefined,
          },
        });
      }
    }

    const usageRaw = (raw.usage ?? {}) as Record<string, unknown>;
    const usage: Usage = {
      input_tokens: (usageRaw.input_tokens as number) ?? 0,
      output_tokens: (usageRaw.output_tokens as number) ?? 0,
      total_tokens:
        ((usageRaw.input_tokens as number) ?? 0) +
        ((usageRaw.output_tokens as number) ?? 0),
      cache_read_tokens:
        (usageRaw.cache_read_input_tokens as number) ?? undefined,
      cache_write_tokens:
        (usageRaw.cache_creation_input_tokens as number) ?? undefined,
    };

    const stopReason = raw.stop_reason as string;
    const finishReason: FinishReason = {
      reason:
        stopReason === "tool_use"
          ? "tool_calls"
          : stopReason === "end_turn" || stopReason === "stop_sequence"
            ? "stop"
            : stopReason === "max_tokens"
              ? "length"
              : "other",
      raw: stopReason,
    };

    return {
      id: raw.id as string,
      model: raw.model as string ?? "",
      provider: "anthropic",
      message: { role: "assistant", content: contentParts },
      finish_reason: finishReason,
      usage,
      raw,
    };
  }
}

// ─── Gemini Adapter ─────────────────────────────────────────────────────────

export interface GeminiAdapterConfig {
  api_key?: string;
  base_url?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  name = "gemini";
  private apiKey: string;
  private baseUrl: string;
  private callIdCounter = 0;

  constructor(config?: GeminiAdapterConfig) {
    this.apiKey =
      config?.api_key ?? process.env.GEMINI_API_KEY ?? "";
    this.baseUrl =
      config?.base_url ??
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com";
  }

  async complete(request: Request): Promise<Response> {
    const { system, rest } = extractSystemAndMessages(request.messages);

    const contents = rest.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: messageContentToText(m.content) }],
    }));

    const body: Record<string, unknown> = {
      contents,
      ...(system
        ? { systemInstruction: { parts: [{ text: system }] } }
        : {}),
    };

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined)
      generationConfig.temperature = request.temperature;
    if (request.max_tokens !== undefined)
      generationConfig.maxOutputTokens = request.max_tokens;
    if (request.stop_sequences?.length)
      generationConfig.stopSequences = request.stop_sequences;
    if (Object.keys(generationConfig).length > 0)
      body.generationConfig = generationConfig;

    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const url = `${this.baseUrl}/v1beta/models/${request.model}:generateContent?key=${this.apiKey}`;

    const { body: respBody } = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return this.parseResponse(
      respBody as Record<string, unknown>,
      request.model
    );
  }

  private parseResponse(
    raw: Record<string, unknown>,
    model: string
  ): Response {
    const candidates = (raw.candidates as Array<Record<string, unknown>>) ?? [];
    const candidate = candidates[0] ?? {};
    const rawContent = candidate.content as Record<string, unknown> | undefined;
    const parts =
      (rawContent?.parts as Array<Record<string, unknown>>) ?? [];

    const contentParts: ContentPart[] = [];
    for (const part of parts) {
      if (part.text !== undefined) {
        contentParts.push({ kind: "text", text: part.text as string });
      } else if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        const syntheticId = `gemini-call-${++this.callIdCounter}`;
        contentParts.push({
          kind: "tool_call",
          tool_call: {
            id: syntheticId,
            name: fc.name as string,
            arguments: (fc.args as Record<string, unknown>) ?? {},
          },
        });
      } else if (part.thought !== undefined) {
        contentParts.push({
          kind: "thinking",
          thinking: { text: part.thought as string },
        });
      }
    }

    const usageRaw =
      (raw.usageMetadata as Record<string, unknown>) ?? {};
    const usage: Usage = {
      input_tokens: (usageRaw.promptTokenCount as number) ?? 0,
      output_tokens: (usageRaw.candidatesTokenCount as number) ?? 0,
      total_tokens: (usageRaw.totalTokenCount as number) ?? 0,
      reasoning_tokens:
        (usageRaw.thoughtsTokenCount as number) ?? undefined,
    };

    const finishReasonRaw = candidate.finishReason as string | undefined;
    const hasToolCalls = contentParts.some((p) => p.kind === "tool_call");
    const finishReason: FinishReason = {
      reason: hasToolCalls
        ? "tool_calls"
        : finishReasonRaw === "STOP"
          ? "stop"
          : finishReasonRaw === "MAX_TOKENS"
            ? "length"
            : "other",
      raw: finishReasonRaw,
    };

    return {
      id: `gemini-${Date.now()}`,
      model,
      provider: "gemini",
      message: { role: "assistant", content: contentParts },
      finish_reason: finishReason,
      usage,
      raw,
    };
  }
}
