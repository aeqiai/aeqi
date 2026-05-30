import { describe, expect, it } from "vitest";
import { processRawSessionMessages } from "./useMessageProcessor";
import { splitTrailAndFinal, type MessageSegment } from "./types";

describe("processRawSessionMessages", () => {
  it("preserves leading role=system rows", () => {
    const messages = processRawSessionMessages([
      {
        id: 1,
        role: "system",
        content: "Session initialized from schedule.",
        created_at: "2026-05-30T10:00:00Z",
        event_type: "message",
      },
      {
        id: 2,
        role: "user",
        content: "Continue",
        created_at: "2026-05-30T10:00:01Z",
        event_type: "message",
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "system",
      from_kind: "system",
      content: "Session initialized from schedule.",
      messageId: 1,
    });
    expect(messages[1]).toMatchObject({ role: "user", content: "Continue" });
  });

  it("preserves rows with from_kind=system instead of treating them as user input", () => {
    const messages = processRawSessionMessages([
      {
        id: 1,
        role: "user",
        from_kind: "system",
        content: "Cron fired the launch-readiness run.",
        created_at: "2026-05-30T10:00:00Z",
        event_type: "message",
      },
      {
        id: 2,
        role: "assistant",
        content: "Done.",
        created_at: "2026-05-30T10:00:01Z",
        event_type: "message",
      },
      {
        id: 3,
        role: "assistant",
        created_at: "2026-05-30T10:00:02Z",
        event_type: "assistant_complete",
      },
    ]);

    expect(messages.map((message) => message.role)).toEqual(["system", "assistant"]);
    expect(messages[0]).toMatchObject({
      role: "system",
      from_kind: "system",
      content: "Cron fired the launch-readiness run.",
    });
  });
});

describe("splitTrailAndFinal", () => {
  it("extracts final text before trailing operational segments", () => {
    const segments: MessageSegment[] = [
      { kind: "step", step: 1 },
      {
        kind: "tool",
        event: { type: "complete", name: "quests", success: true, timestamp: 1 },
      },
      { kind: "text", text: "Final answer." },
      {
        kind: "tool_summarized",
        event: {
          tool_use_id: "tool-1",
          tool_name: "quests",
          original_bytes: 1000,
          summary: "Created one quest.",
        },
      },
      { kind: "status", text: "Updating session metadata..." },
      {
        kind: "event_fire",
        fire: {
          eventId: "event-1",
          eventName: "session:quest_result",
          pattern: "session:quest_result",
          scope: "self",
        },
      },
    ];

    const split = splitTrailAndFinal(segments);

    expect(split.final).toEqual([{ kind: "text", text: "Final answer." }]);
    expect(split.trail).toEqual([segments[0], segments[1], segments[3], segments[4], segments[5]]);
  });

  it("keeps interim text in the trail when a raw tool segment ends the turn", () => {
    const segments: MessageSegment[] = [
      { kind: "text", text: "Let me check that." },
      {
        kind: "tool",
        event: { type: "complete", name: "quests", success: true, timestamp: 1 },
      },
    ];

    const split = splitTrailAndFinal(segments);

    expect(split.final).toEqual([]);
    expect(split.trail).toEqual(segments);
  });
});
