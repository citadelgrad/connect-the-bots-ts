import { describe, it, expect } from "vitest";
import {
  Msg,
  addUsage,
  responseText,
  responseToolCalls,
  responseReasoning,
  type Response,
  type Usage,
} from "../llm/types.js";

describe("LLM Types", () => {
  it("creates messages with factory functions", () => {
    const sys = Msg.system("system prompt");
    expect(sys.role).toBe("system");
    expect(sys.content).toBe("system prompt");

    const usr = Msg.user("hello");
    expect(usr.role).toBe("user");

    const ast = Msg.assistant("response");
    expect(ast.role).toBe("assistant");

    const tool = Msg.toolResult("call-1", "result", false);
    expect(tool.role).toBe("tool");
    expect(tool.tool_call_id).toBe("call-1");
  });

  it("adds usage correctly", () => {
    const a: Usage = { input_tokens: 100, output_tokens: 50, total_tokens: 150, reasoning_tokens: 10 };
    const b: Usage = { input_tokens: 200, output_tokens: 100, total_tokens: 300, reasoning_tokens: 20 };
    const sum = addUsage(a, b);
    expect(sum.input_tokens).toBe(300);
    expect(sum.output_tokens).toBe(150);
    expect(sum.total_tokens).toBe(450);
    expect(sum.reasoning_tokens).toBe(30);
  });

  it("extracts text from response", () => {
    const response: Response = {
      id: "test",
      model: "test",
      provider: "test",
      message: {
        role: "assistant",
        content: [
          { kind: "text", text: "Hello " },
          { kind: "text", text: "world" },
        ],
      },
      finish_reason: { reason: "stop" },
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
    expect(responseText(response)).toBe("Hello world");
  });

  it("extracts tool calls from response", () => {
    const response: Response = {
      id: "test",
      model: "test",
      provider: "test",
      message: {
        role: "assistant",
        content: [
          {
            kind: "tool_call",
            tool_call: {
              id: "call-1",
              name: "read_file",
              arguments: { file_path: "test.txt" },
            },
          },
        ],
      },
      finish_reason: { reason: "tool_calls" },
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };

    const calls = responseToolCalls(response);
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].arguments.file_path).toBe("test.txt");
  });

  it("extracts reasoning from response", () => {
    const response: Response = {
      id: "test",
      model: "test",
      provider: "test",
      message: {
        role: "assistant",
        content: [
          { kind: "thinking", thinking: { text: "Let me think..." } },
          { kind: "text", text: "Answer" },
        ],
      },
      finish_reason: { reason: "stop" },
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };

    expect(responseReasoning(response)).toBe("Let me think...");
    expect(responseText(response)).toBe("Answer");
  });
});
