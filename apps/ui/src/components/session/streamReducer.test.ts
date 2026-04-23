import { describe, expect, it } from "vitest";
import { initialStreamState, reduceStreamEvent, hasContent, type RawEvent } from "./streamReducer";

function drive(events: RawEvent[], start = 1000) {
  let state = initialStreamState(start);
  for (const e of events) state = reduceStreamEvent(state, e);
  return state;
}

describe("reduceStreamEvent", () => {
  it("starts empty and streaming", () => {
    const s = initialStreamState(42);
    expect(s.segments).toEqual([]);
    expect(s.fullText).toBe("");
    expect(s.thinkingStart).toBe(42);
    expect(s.status.kind).toBe("streaming");
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
    const b = reduceStreamEvent(a, { type: "Status" });
    expect(b).toBe(a);
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
    const s = reduceStreamEvent(initialStreamState(now), {
      type: "Subscribed",
      started_ms_ago: 5000,
    });
    expect(s.thinkingStart).toBeLessThanOrEqual(now - 5000 + 50);
    expect(s.thinkingStart).toBeGreaterThanOrEqual(now - 5000 - 50);
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
    const s = reduceStreamEvent(initialStreamState(0), {
      type: "Error",
      message: "boom",
    });
    expect(s.status).toEqual({ kind: "error", message: "boom" });
  });
});
