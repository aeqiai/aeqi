import { describe, expect, it } from "vitest";
import {
  initialStreamState,
  reduceStreamEvent,
  hasContent,
  type RawEvent,
  type StreamState,
  type ReduceResult,
} from "./streamReducer";

/** Drive a sequence of events through the reducer, returning the final StreamState.
 * Throws if a UserInjected split is encountered — use driveWithSplits for that. */
function drive(events: RawEvent[], start = 1000): StreamState {
  let state = initialStreamState(start);
  for (const e of events) {
    const result = reduceStreamEvent(state, e);
    if (result.kind === "split") throw new Error("Unexpected split — use driveWithSplits");
    state = result.state;
  }
  return state;
}

/** Drive events, handling splits. Returns an array of committed states (one per split)
 * and the final live state. */
function driveWithSplits(
  events: RawEvent[],
  start = 1000,
): { commits: Array<{ state: StreamState; injectedText: string }>; live: StreamState } {
  let state = initialStreamState(start);
  const commits: Array<{ state: StreamState; injectedText: string }> = [];
  for (const e of events) {
    const result = reduceStreamEvent(state, e);
    if (result.kind === "split") {
      commits.push({ state: result.commit, injectedText: result.injectedText });
      state = result.next;
    } else {
      state = result.state;
    }
  }
  return { commits, live: state };
}

describe("reduceStreamEvent", () => {
  it("starts empty and streaming", () => {
    const s = initialStreamState(42);
    expect(s.segments).toEqual([]);
    expect(s.fullText).toBe("");
    expect(s.thinkingStart).toBe(42);
    expect(s.status.kind).toBe("streaming");
    expect(s.stepOffset).toBe(0);
    expect(hasContent(s)).toBe(false);
  });

  it("merges contiguous TextDelta events into one text segment", () => {
    const s = drive([
      { type: "TextDelta", text: "hello " },
      { type: "TextDelta", delta: "world" },
    ]);
    expect(s.segments).toEqual([{ kind: "text", text: "hello world" }]);
    expect(s.fullText).toBe("hello world");
  });

  it("returns referentially equal state on unknown events", () => {
    const a = initialStreamState(0);
    const result = reduceStreamEvent(a, { type: "Status" });
    if (result.kind !== "next") throw new Error();
    expect(result.state).toBe(a);
  });

  it("upserts ToolComplete onto matching ToolStart by id", () => {
    const s = drive([
      { type: "ToolStart", name: "read", tool_use_id: "t1" },
      { type: "ToolComplete", name: "read", tool_use_id: "t1", output_preview: "ok" },
    ]);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toMatchObject({
      kind: "tool",
      event: { type: "complete", id: "t1", output_preview: "ok" },
    });
  });

  it("defaults event-fire scope to self when the backend omits it", () => {
    const s = drive([
      { type: "EventFired", event_id: "ev-1", event_name: "on_start", pattern: "session:start" },
    ]);
    expect(s.segments).toContainEqual({
      kind: "event_fire",
      fire: {
        eventId: "ev-1",
        eventName: "on_start",
        pattern: "session:start",
        ideaIds: [],
        scope: "self",
      },
    });
  });

  it("numbers StepStart segments monotonically", () => {
    const s = drive([
      { type: "StepStart" },
      { type: "TextDelta", text: "a" },
      { type: "StepStart" },
    ]);
    const steps = s.segments.filter((seg) => seg.kind === "step");
    expect(steps).toEqual([
      { kind: "step", step: 1 },
      { kind: "step", step: 2 },
    ]);
  });

  it("rebases thinkingStart from Subscribed.started_ms_ago", () => {
    const now = Date.now();
    const result = reduceStreamEvent(initialStreamState(now), {
      type: "Subscribed",
      started_ms_ago: 5000,
    });
    if (result.kind !== "next") throw new Error();
    expect(result.state.thinkingStart).toBeLessThanOrEqual(now - 5000 + 50);
    expect(result.state.thinkingStart).toBeGreaterThanOrEqual(now - 5000 - 50);
  });

  it("transitions to complete with meta when Complete.done is true", () => {
    const s = drive([
      { type: "TextDelta", text: "hi" },
      { type: "StepStart" },
      {
        type: "Complete",
        done: true,
        cost_usd: 0.01,
        prompt_tokens: 10,
        completion_tokens: 5,
      },
    ]);
    expect(s.status.kind).toBe("complete");
    if (s.status.kind !== "complete") throw new Error();
    expect(s.status.meta.costUsd).toBe(0.01);
    expect(s.status.meta.stepCount).toBe(1);
    expect(s.status.meta.tokenUsage).toEqual({ prompt: 10, completion: 5 });
  });

  it("ignores Complete without done=true", () => {
    const s = drive([{ type: "TextDelta", text: "hi" }, { type: "Complete" }]);
    expect(s.status.kind).toBe("streaming");
  });

  it("Error transitions to error status with message", () => {
    const result = reduceStreamEvent(initialStreamState(0), {
      type: "Error",
      message: "boom",
    });
    if (result.kind !== "next") throw new Error();
    expect(result.state.status).toEqual({ kind: "error", message: "boom" });
  });
});

describe("UserInjected split", () => {
  it("returns a split result with the pre-split state as commit and a fresh next state", () => {
    const { commits, live } = driveWithSplits([
      { type: "StepStart" },
      { type: "TextDelta", text: "Thinking..." },
      { type: "ToolStart", name: "read_file", tool_use_id: "t1" },
      { type: "UserInjected", text: "hey stop", after_step: 1, message_id: 42 },
    ]);

    // One commit was produced
    expect(commits).toHaveLength(1);
    const committed = commits[0].state;
    // Committed state retains segments accumulated before the split
    expect(committed.segments.some((s) => s.kind === "step")).toBe(true);
    expect(committed.segments.some((s) => s.kind === "text")).toBe(true);
    // Committed state is still "streaming" (status not flipped by the split itself)
    expect(committed.status.kind).toBe("streaming");
    // Injected text is carried on the result
    expect(commits[0].injectedText).toBe("hey stop");

    // Fresh continuation state is empty
    expect(live.segments).toEqual([]);
    expect(live.fullText).toBe("");
    expect(live.status.kind).toBe("streaming");
    // Step offset is set to after_step so continuation steps number correctly
    expect(live.stepOffset).toBe(1);
  });

  it("continuation StepStart numbers steps from after_step + 1, not from 1", () => {
    const { live } = driveWithSplits([
      { type: "StepStart" },
      { type: "StepStart" },
      { type: "UserInjected", text: "interrupt", after_step: 2 },
      { type: "StepStart" }, // continuation's first step — should be step 3
    ]);

    const steps = live.segments.filter((s) => s.kind === "step");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ kind: "step", step: 3 });
  });

  it("multiple splits carry step offsets forward cumulatively", () => {
    const { commits, live } = driveWithSplits([
      { type: "StepStart" }, // step 1
      { type: "UserInjected", text: "first injection", after_step: 1 },
      { type: "StepStart" }, // step 2 (offset=1, so 0+1+1=2)
      { type: "UserInjected", text: "second injection", after_step: 2 },
      { type: "StepStart" }, // step 3 (offset=2, so 0+1+2=3)
    ]);

    expect(commits).toHaveLength(2);

    const steps = live.segments.filter((s) => s.kind === "step");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ kind: "step", step: 3 });
  });

  it("carries optional message_id on the split result", () => {
    const events: RawEvent[] = [
      { type: "TextDelta", text: "working" },
      { type: "UserInjected", text: "input", after_step: 0, message_id: 99 },
    ];
    let state = initialStreamState(0);
    let splitResult: ReduceResult | null = null;
    for (const e of events) {
      const r = reduceStreamEvent(state, e);
      if (r.kind === "split") {
        splitResult = r;
        state = r.next;
      } else {
        state = r.state;
      }
    }
    expect(splitResult).not.toBeNull();
    if (!splitResult || splitResult.kind !== "split") throw new Error();
    expect(splitResult.messageId).toBe(99);
  });

  it("omitted message_id is undefined on the split result", () => {
    const state = initialStreamState(0);
    const r = reduceStreamEvent(state, {
      type: "UserInjected",
      text: "no id",
      after_step: 0,
    });
    if (r.kind !== "split") throw new Error("expected split");
    expect(r.messageId).toBeUndefined();
  });
});
