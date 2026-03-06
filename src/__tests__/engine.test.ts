import { describe, it, expect } from "vitest";
import { runPipeline } from "../attractor/engine.js";
import { registerHandler, setInterviewer } from "../attractor/handlers/index.js";
import { QueueInterviewer } from "../attractor/interviewer.js";
import * as os from "node:os";
import * as path from "node:path";

describe("Pipeline Engine", () => {
  const tmpDir = () =>
    path.join(os.tmpdir(), `attractor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  it("runs a simple start -> exit pipeline", async () => {
    const dot = `
      digraph Simple {
        start [shape=Mdiamond]
        end [shape=Msquare]
        start -> end
      }
    `;

    const result = await runPipeline({ dot, logs_root: tmpDir() });
    expect(result.status).toBe("success");
  });

  it("runs a pipeline with a conditional node", async () => {
    const dot = `
      digraph Conditional {
        start [shape=Mdiamond]
        check [shape=diamond]
        end [shape=Msquare]

        start -> check -> end
      }
    `;

    const result = await runPipeline({ dot, logs_root: tmpDir() });
    expect(result.status).toBe("success");
  });

  it("follows conditional edges based on outcome", async () => {
    const events: string[] = [];

    // Register a custom handler that returns fail
    registerHandler("test_fail", async () => ({
      status: "fail",
      context_updates: { "task.failed": "true" },
    }));

    const dot = `
      digraph CondEdge {
        start [shape=Mdiamond]
        task [shape=box, type="test_fail"]
        recovery [shape=box, type="start"]
        end [shape=Msquare]

        start -> task
        task -> recovery [condition="outcome=fail"]
        task -> end [condition="outcome=success"]
        recovery -> end
      }
    `;

    const result = await runPipeline({
      dot,
      logs_root: tmpDir(),
      on_event: (e) => {
        if (e.type === "stage_started") {
          events.push(e.data.name as string);
        }
      },
    });

    expect(result.status).toBe("success");
    expect(events).toContain("recovery");
  });

  it("respects edge weights for selection", async () => {
    const events: string[] = [];

    const dot = `
      digraph Weighted {
        start [shape=Mdiamond]
        a [shape=box, type="start"]
        b [shape=box, type="start"]
        end [shape=Msquare]

        start -> a [weight=1]
        start -> b [weight=10]
        a -> end
        b -> end
      }
    `;

    const result = await runPipeline({
      dot,
      logs_root: tmpDir(),
      on_event: (e) => {
        if (e.type === "stage_started") {
          events.push(e.data.name as string);
        }
      },
    });

    expect(result.status).toBe("success");
    // Should follow higher weight edge to "b"
    expect(events).toContain("b");
    expect(events).not.toContain("a");
  });

  it("fails validation for invalid graph", async () => {
    const dot = `
      digraph Invalid {
        a [shape=box]
        b [shape=box]
        a -> b
      }
    `;

    const result = await runPipeline({ dot, logs_root: tmpDir() });
    expect(result.status).toBe("fail");
    expect(result.failure_reason).toContain("Validation failed");
  });

  it("collects events during execution", async () => {
    const events: string[] = [];

    const dot = `
      digraph Events {
        start [shape=Mdiamond]
        end [shape=Msquare]
        start -> end
      }
    `;

    await runPipeline({
      dot,
      logs_root: tmpDir(),
      on_event: (e) => events.push(e.type),
    });

    expect(events).toContain("pipeline_started");
    expect(events).toContain("stage_started");
    expect(events).toContain("stage_completed");
    expect(events).toContain("checkpoint_saved");
    expect(events).toContain("pipeline_completed");
  });

  it("handles human gate with queued answers", async () => {
    setInterviewer(
      new QueueInterviewer([
        { value: "proceed", selected_option: { key: "Y", label: "proceed" } },
      ])
    );

    const dot = `
      digraph HumanGate {
        start [shape=Mdiamond]
        gate [shape=hexagon, label="Continue?"]
        end [shape=Msquare]

        start -> gate
        gate -> end [label="[Y] proceed"]
      }
    `;

    const result = await runPipeline({ dot, logs_root: tmpDir() });
    expect(result.status).toBe("success");
  });
});
