import { randomUUID } from "node:crypto";
import { Client } from "../llm/client.js";
import type { Request as LLMRequest } from "../llm/types.js";
import {
  Msg,
  responseText,
  responseToolCalls,
  responseReasoning,
} from "../llm/types.js";
import type { Message } from "../llm/types.js";
import type {
  Turn,
  SessionConfig,
  SessionState,
  EventKind,
  EventHandler,
  SessionEvent,
  ProviderProfile,
  ExecutionEnvironment,
  ToolResultEntry,
} from "./types.js";
import { DEFAULT_SESSION_CONFIG } from "./types.js";
import { truncateToolOutput } from "./truncation.js";

export class Session {
  readonly id: string;
  readonly provider_profile: ProviderProfile;
  readonly execution_env: ExecutionEnvironment;
  readonly config: SessionConfig;
  readonly history: Turn[] = [];

  state: SessionState = "idle";
  abort_signaled = false;

  private llmClient: Client;
  private eventHandlers: EventHandler[] = [];
  private steeringQueue: string[] = [];
  private followupQueue: string[] = [];

  constructor(opts: {
    provider_profile: ProviderProfile;
    execution_env: ExecutionEnvironment;
    llm_client: Client;
    config?: Partial<SessionConfig>;
  }) {
    this.id = randomUUID();
    this.provider_profile = opts.provider_profile;
    this.execution_env = opts.execution_env;
    this.llmClient = opts.llm_client;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...opts.config };
  }

  on_event(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  emit(kind: EventKind, data: Record<string, unknown> = {}): void {
    const event: SessionEvent = {
      kind,
      timestamp: new Date(),
      session_id: this.id,
      data,
    };
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // don't let handler errors break the loop
      }
    }
  }

  steer(message: string): void {
    this.steeringQueue.push(message);
  }

  follow_up(message: string): void {
    this.followupQueue.push(message);
  }

  abort(): void {
    this.abort_signaled = true;
  }

  async process_input(userInput: string): Promise<void> {
    this.state = "processing";
    this.abort_signaled = false;
    this.history.push({
      type: "user",
      content: userInput,
      timestamp: new Date(),
    });
    this.emit("user_input", { content: userInput });
    this.drainSteering();

    let roundCount = 0;

    while (true) {
      // Check limits
      if (
        this.config.max_tool_rounds_per_input > 0 &&
        roundCount >= this.config.max_tool_rounds_per_input
      ) {
        this.emit("turn_limit", { round: roundCount });
        break;
      }

      if (
        this.config.max_turns > 0 &&
        this.countTurns() >= this.config.max_turns
      ) {
        this.emit("turn_limit", { total_turns: this.countTurns() });
        break;
      }

      if (this.abort_signaled) break;

      // Build LLM request
      const projectDocs = await this.discoverProjectDocs();
      const systemPrompt = this.provider_profile.build_system_prompt(
        this.execution_env,
        projectDocs
      );

      const messages = this.convertHistoryToMessages();
      const toolDefs = this.provider_profile.tools();

      const request: LLMRequest = {
        model: this.provider_profile.model,
        messages: [Msg.system(systemPrompt), ...messages],
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        tool_choice: toolDefs.length > 0 ? "auto" : undefined,
        reasoning_effort: this.config.reasoning_effort,
        provider: this.provider_profile.id,
        provider_options: this.provider_profile.provider_options?.(),
      };

      // Call LLM
      const response = await this.llmClient.complete(request);

      const text = responseText(response);
      const toolCalls = responseToolCalls(response);
      const reasoning = responseReasoning(response);

      // Record assistant turn
      this.history.push({
        type: "assistant",
        content: text,
        tool_calls: toolCalls,
        reasoning,
        usage: response.usage,
        response_id: response.id,
        timestamp: new Date(),
      });

      this.emit("assistant_text_end", { text, reasoning });

      // If no tool calls, exit loop
      if (toolCalls.length === 0) break;

      // Execute tool calls
      roundCount++;
      const results = await this.executeToolCalls(toolCalls);
      this.history.push({
        type: "tool_results",
        results,
        timestamp: new Date(),
      });

      // Drain steering
      this.drainSteering();

      // Loop detection
      if (this.config.enable_loop_detection) {
        if (this.detectLoop()) {
          const warning = `Loop detected: last ${this.config.loop_detection_window} calls follow repeating pattern. Try different approach.`;
          this.history.push({
            type: "steering",
            content: warning,
            timestamp: new Date(),
          });
          this.emit("loop_detection", { message: warning });
        }
      }
    }

    // Process follow-ups
    if (this.followupQueue.length > 0) {
      const nextInput = this.followupQueue.shift()!;
      await this.process_input(nextInput);
      return;
    }

    this.state = "idle";
    this.emit("session_end");
  }

  private async executeToolCalls(
    toolCalls: import("../llm/types.js").ToolCall[]
  ): Promise<ToolResultEntry[]> {
    const execute = async (
      tc: import("../llm/types.js").ToolCall
    ): Promise<ToolResultEntry> => {
      this.emit("tool_call_start", {
        tool_name: tc.name,
        call_id: tc.id,
      });

      const registered = this.provider_profile.tool_registry.get(tc.name);
      if (!registered) {
        const errorMsg = `Unknown tool: ${tc.name}`;
        this.emit("tool_call_end", { call_id: tc.id, error: errorMsg });
        return { tool_call_id: tc.id, content: errorMsg, is_error: true };
      }

      try {
        const rawOutput = await registered.executor(
          tc.arguments,
          this.execution_env
        );
        const truncatedOutput = truncateToolOutput(
          rawOutput,
          tc.name,
          this.config
        );

        // Emit full output
        this.emit("tool_call_end", {
          call_id: tc.id,
          output: rawOutput,
        });

        return {
          tool_call_id: tc.id,
          content: truncatedOutput,
          is_error: false,
        };
      } catch (err: unknown) {
        const errorMsg = `Tool error (${tc.name}): ${err instanceof Error ? err.message : String(err)}`;
        this.emit("tool_call_end", { call_id: tc.id, error: errorMsg });
        return { tool_call_id: tc.id, content: errorMsg, is_error: true };
      }
    };

    if (
      this.provider_profile.supports_parallel_tool_calls &&
      toolCalls.length > 1
    ) {
      return Promise.all(toolCalls.map(execute));
    }

    const results: ToolResultEntry[] = [];
    for (const tc of toolCalls) {
      results.push(await execute(tc));
    }
    return results;
  }

  private convertHistoryToMessages(): Message[] {
    const messages: Message[] = [];

    for (const turn of this.history) {
      switch (turn.type) {
        case "user":
          messages.push(Msg.user(turn.content));
          break;
        case "assistant":
          messages.push({
            role: "assistant",
            content: turn.content,
          });
          break;
        case "tool_results":
          for (const result of turn.results) {
            messages.push(
              Msg.toolResult(
                result.tool_call_id,
                result.content,
                result.is_error
              )
            );
          }
          break;
        case "system":
        case "steering":
          messages.push(Msg.user(turn.content));
          break;
      }
    }

    return messages;
  }

  private drainSteering(): void {
    while (this.steeringQueue.length > 0) {
      const msg = this.steeringQueue.shift()!;
      this.history.push({
        type: "steering",
        content: msg,
        timestamp: new Date(),
      });
      this.emit("steering_injected", { content: msg });
    }
  }

  private detectLoop(): boolean {
    const window = this.config.loop_detection_window;
    const toolTurns = this.history.filter((t) => t.type === "tool_results");
    if (toolTurns.length < window) return false;

    const recent = toolTurns.slice(-window);
    // Simple check: look for repeating tool call patterns
    const halfWindow = Math.floor(window / 2);
    const firstHalf = recent.slice(0, halfWindow);
    const secondHalf = recent.slice(halfWindow, halfWindow * 2);

    const serialize = (turns: typeof firstHalf) =>
      JSON.stringify(
        turns.map((t) =>
          t.type === "tool_results"
            ? t.results.map((r) => r.content.slice(0, 100))
            : ""
        )
      );

    return serialize(firstHalf) === serialize(secondHalf);
  }

  private countTurns(): number {
    return this.history.filter(
      (t) => t.type === "assistant" || t.type === "user"
    ).length;
  }

  private async discoverProjectDocs(): Promise<string> {
    const docs: string[] = [];
    const candidates = ["AGENTS.md", "CLAUDE.md"];

    for (const filename of candidates) {
      const exists = await this.execution_env.file_exists(filename);
      if (exists) {
        try {
          const content = await this.execution_env.read_file(filename);
          // Strip line numbers
          const raw = content
            .split("\n")
            .map((line) => {
              const m = line.match(/^\s*\d+\t(.*)$/);
              return m ? m[1] : line;
            })
            .join("\n");
          docs.push(`# ${filename}\n${raw}`);
        } catch {
          // skip unreadable files
        }
      }
    }

    return docs.join("\n\n");
  }
}
