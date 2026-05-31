import { describe, expect, it } from "vitest";
import { inboxMessagesAdapter } from "@/components/inbox/inboxMessagesAdapter";
import { splitTrailAndFinal, trailHasMeaningfulContent } from "@/components/session/types";

describe("inboxMessagesAdapter", () => {
  it("folds stored execution fragments into one assistant turn", () => {
    const messages = inboxMessagesAdapter({
      messages: [
        {
          id: 1,
          role: "user",
          content: "Set up the first company quests.",
          created_at: "2026-05-23T10:00:00Z",
          from_kind: "user",
          from_id: "user-1",
          event_type: "message",
        },
        {
          id: 2,
          role: "system",
          content: "",
          created_at: "2026-05-23T10:00:01Z",
          event_type: "event_fired",
          metadata: {
            event_id: "evt-1",
            event_name: "session:execution_start",
            pattern: "session:execution_start",
          },
        },
        {
          id: 3,
          role: "assistant",
          content: "Step 19",
          created_at: "2026-05-23T10:00:02Z",
          event_type: "message",
        },
        {
          id: 4,
          role: "assistant",
          content: "ideas",
          created_at: "2026-05-23T10:00:03Z",
          event_type: "message",
        },
        {
          id: 5,
          role: "assistant",
          content: "Checking existing roles...",
          created_at: "2026-05-23T10:00:04Z",
          event_type: "message",
        },
        {
          id: 6,
          role: "assistant",
          content: "Step 20",
          created_at: "2026-05-23T10:00:05Z",
          event_type: "message",
        },
        {
          id: 7,
          role: "assistant",
          content: "quests",
          created_at: "2026-05-23T10:00:06Z",
          event_type: "message",
        },
        {
          id: 8,
          role: "assistant",
          content: "Done. I created the setup quest and linked the supporting ideas.",
          created_at: "2026-05-23T10:00:07Z",
          event_type: "message",
          from_kind: "agent",
          from_id: "agent-1",
        },
        {
          id: 9,
          role: "assistant",
          content: "",
          created_at: "2026-05-23T10:00:08Z",
          event_type: "assistant_complete",
          metadata: { step_count: 2 },
        },
      ],
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0].content).toBe("Set up the first company quests.");

    const assistant = messages[1];
    expect(assistant.content).toBe(
      "Done. I created the setup quest and linked the supporting ideas.",
    );
    expect(assistant.segments).toBeDefined();

    const split = splitTrailAndFinal(assistant.segments ?? []);
    expect(trailHasMeaningfulContent(split.trail)).toBe(true);
    expect(split.trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "event_fire" }),
        expect.objectContaining({ kind: "step" }),
        expect.objectContaining({ kind: "tool" }),
        expect.objectContaining({ kind: "status", text: "Checking existing roles..." }),
      ]),
    );
    expect(split.final).toEqual([
      {
        kind: "text",
        text: "Done. I created the setup quest and linked the supporting ideas.",
      },
    ]);
  });
});
