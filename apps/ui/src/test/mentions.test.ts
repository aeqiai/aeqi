/**
 * Unit tests for the @-mention parser (apps/ui/src/lib/mentions.ts).
 *
 * Covers every token shape, deduplication, edge cases, and the
 * splitBodyIntoSegments helper used by MentionText.
 */

import { describe, it, expect } from "vitest";
import { parseMentions, splitBodyIntoSegments } from "@/lib/mentions";

// ── parseMentions ─────────────────────────────────────────────────────────────

describe("parseMentions", () => {
  it("parses @agent:<id>", () => {
    const refs = parseMentions("hey @agent:hermes check this");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "agent", id: "hermes", rawText: "@agent:hermes" });
  });

  it("parses @user:<id>", () => {
    const refs = parseMentions("cc @user:alice-123");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "user", id: "alice-123" });
  });

  it("parses @position(<title>)", () => {
    const refs = parseMentions("escalate to @position(Head of Engineering)");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "position",
      id: "Head of Engineering",
      rawText: "@position(Head of Engineering)",
    });
  });

  it("parses bare @<name> as fuzzy", () => {
    const refs = parseMentions("hey @alice what do you think");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "fuzzy", id: "alice" });
  });

  it("parses bare @<name> with hyphen", () => {
    const refs = parseMentions("@deploy-bot please run");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "fuzzy", id: "deploy-bot" });
  });

  it("parses @agent UUID", () => {
    const refs = parseMentions("@agent:550e8400-e29b-41d4-a716-446655440000 check it");
    expect(refs[0]).toMatchObject({
      kind: "agent",
      id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("parses multiple distinct mentions", () => {
    const refs = parseMentions("@alice @agent:bob and @user:carol");
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.kind)).toEqual(["fuzzy", "agent", "user"]);
  });

  it("deduplicates case-insensitively", () => {
    const refs = parseMentions("@Alice @alice @ALICE");
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("Alice");
  });

  it("deduplicates agent prefix", () => {
    const refs = parseMentions("@agent:hermes and @agent:hermes again");
    expect(refs).toHaveLength(1);
  });

  it("ignores a lone @", () => {
    expect(parseMentions("send @ to the void")).toHaveLength(0);
  });

  it("does not match email addresses", () => {
    expect(parseMentions("reach me at user@example.com please")).toHaveLength(0);
  });

  it("strips trailing punctuation from bare name", () => {
    const refs = parseMentions("thanks @alice.");
    expect(refs[0].id).toBe("alice");
  });

  it("comma terminates a token", () => {
    const refs = parseMentions("@alice, @bob");
    expect(refs).toHaveLength(2);
    expect(refs[0].id).toBe("alice");
    expect(refs[1].id).toBe("bob");
  });

  it("@position() with empty title emits 'position' as fuzzy (bare-name fallback)", () => {
    // The position branch skips empty title; bare-name stops at `(` and emits "position".
    const refs = parseMentions("@position()");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "fuzzy", id: "position" });
  });

  it("returns empty array for empty body", () => {
    expect(parseMentions("")).toHaveLength(0);
  });

  it("returns empty array for plain prose", () => {
    expect(parseMentions("nothing special here")).toHaveLength(0);
  });
});

// ── splitBodyIntoSegments ─────────────────────────────────────────────────────

describe("splitBodyIntoSegments", () => {
  it("returns single text segment when no mentions", () => {
    const segs = splitBodyIntoSegments("plain text");
    expect(segs).toEqual([{ kind: "text", text: "plain text" }]);
  });

  it("splits text around a mention", () => {
    const segs = splitBodyIntoSegments("hey @agent:bob done");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ kind: "text", text: "hey " });
    expect(segs[1].kind).toBe("mention");
    expect(segs[2]).toEqual({ kind: "text", text: " done" });
  });

  it("handles mention at start of body", () => {
    const segs = splitBodyIntoSegments("@alice please help");
    expect(segs[0].kind).toBe("mention");
    expect(segs[1]).toEqual({ kind: "text", text: " please help" });
  });

  it("handles mention at end of body", () => {
    const segs = splitBodyIntoSegments("cc @alice");
    expect(segs[0]).toEqual({ kind: "text", text: "cc " });
    expect(segs[1].kind).toBe("mention");
  });

  it("handles body that is only a mention", () => {
    const segs = splitBodyIntoSegments("@agent:hermes");
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("mention");
  });

  it("produces correct span classes via mention kind", () => {
    const segs = splitBodyIntoSegments("@agent:a @user:b @position(C)");
    const kinds = segs
      .filter((s) => s.kind === "mention")
      .map((s) => (s as { kind: "mention"; token: { kind: string } }).token.kind);
    expect(kinds).toEqual(["agent", "user", "position"]);
  });
});
