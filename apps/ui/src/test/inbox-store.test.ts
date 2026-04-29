import { beforeEach, describe, expect, it } from "vitest";
import { selectInboxCount, selectVisibleItems, useInboxStore } from "@/store/inbox";
import type { InboxItem } from "@/lib/api";

function makeItem(sessionId: string, awaitingAt = "2026-04-25T10:00:00Z"): InboxItem {
  return {
    session_id: sessionId,
    agent_id: `agent-${sessionId}`,
    agent_name: `Agent ${sessionId}`,
    entity_id: `entity-${sessionId}`,
    session_name: `session ${sessionId}`,
    awaiting_subject: "subject",
    awaiting_at: awaitingAt,
    last_agent_message: "thinking aloud",
  };
}

describe("inbox store", () => {
  beforeEach(() => {
    useInboxStore.setState({
      items: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      pendingDismissal: new Set<string>(),
    });
  });

  describe("dismissOptimistically", () => {
    it("hides the item from selectVisibleItems but preserves it in items", () => {
      useInboxStore.setState({ items: [makeItem("a"), makeItem("b")] });
      useInboxStore.getState().dismissOptimistically("a");

      const visible = selectVisibleItems(useInboxStore.getState());
      expect(visible).toHaveLength(1);
      expect(visible[0].session_id).toBe("b");
      // The original items array is intact — restore is cheap.
      expect(useInboxStore.getState().items).toHaveLength(2);
      expect(selectInboxCount(useInboxStore.getState())).toBe(1);
    });

    it("restoreItem brings the row back into the visible set", () => {
      useInboxStore.setState({ items: [makeItem("a")] });
      useInboxStore.getState().dismissOptimistically("a");
      expect(selectVisibleItems(useInboxStore.getState())).toHaveLength(0);

      useInboxStore.getState().restoreItem("a");
      expect(selectVisibleItems(useInboxStore.getState())).toHaveLength(1);
    });
  });

  describe("pushInboxUpdate — snapshot path (MVP poller)", () => {
    it("replaces items wholesale and reconciles pendingDismissal", () => {
      // Start with pendingDismissal for an item that the server has now
      // genuinely cleared. The reconciliation should drop the entry.
      useInboxStore.setState({
        items: [makeItem("a"), makeItem("b")],
        pendingDismissal: new Set<string>(["a"]),
      });

      useInboxStore.getState().pushInboxUpdate({ count: 1, items: [makeItem("b")] });

      expect(useInboxStore.getState().items).toHaveLength(1);
      expect(useInboxStore.getState().items[0].session_id).toBe("b");
      // "a" is gone from server truth → drop the dismissal entry.
      expect(useInboxStore.getState().pendingDismissal.has("a")).toBe(false);
    });

    it("keeps pendingDismissal entries that the server still reports", () => {
      // The user just clicked Send on row "a". The optimistic dismiss
      // hides it; before the server's clear lands, the WS poller might
      // still report "a" as awaiting. The dismissal must survive.
      useInboxStore.setState({
        items: [makeItem("a")],
        pendingDismissal: new Set<string>(["a"]),
      });

      useInboxStore.getState().pushInboxUpdate({ count: 1, items: [makeItem("a")] });

      expect(useInboxStore.getState().pendingDismissal.has("a")).toBe(true);
      expect(selectVisibleItems(useInboxStore.getState())).toHaveLength(0);
    });
  });

  describe("pushInboxUpdate — fine-grained delta (forward-compat for v2 push)", () => {
    it("'added' prepends a new row", () => {
      useInboxStore.setState({ items: [makeItem("b")] });
      useInboxStore.getState().pushInboxUpdate({ kind: "added", item: makeItem("a") });
      expect(useInboxStore.getState().items.map((i) => i.session_id)).toEqual(["a", "b"]);
    });

    it("'added' deduplicates by session_id (idempotent)", () => {
      useInboxStore.setState({ items: [makeItem("a")] });
      useInboxStore.getState().pushInboxUpdate({ kind: "added", item: makeItem("a") });
      expect(useInboxStore.getState().items).toHaveLength(1);
    });

    it("'cleared' removes the row and drops any pendingDismissal entry", () => {
      useInboxStore.setState({
        items: [makeItem("a"), makeItem("b")],
        pendingDismissal: new Set<string>(["a"]),
      });
      useInboxStore.getState().pushInboxUpdate({ kind: "cleared", session_id: "a" });
      expect(useInboxStore.getState().items.map((i) => i.session_id)).toEqual(["b"]);
      expect(useInboxStore.getState().pendingDismissal.has("a")).toBe(false);
    });
  });

  describe("selectInboxCount", () => {
    it("excludes pendingDismissal entries from the count", () => {
      useInboxStore.setState({
        items: [makeItem("a"), makeItem("b"), makeItem("c")],
        pendingDismissal: new Set<string>(["b"]),
      });
      expect(selectInboxCount(useInboxStore.getState())).toBe(2);
    });
  });

  describe("clearInbox", () => {
    it("resets all state to initial values", () => {
      useInboxStore.setState({
        items: [makeItem("a"), makeItem("b")],
        loading: true,
        error: "boom",
        lastFetchedAt: 12345,
        pendingDismissal: new Set<string>(["a"]),
      });

      useInboxStore.getState().clearInbox();

      const s = useInboxStore.getState();
      expect(s.items).toHaveLength(0);
      expect(s.loading).toBe(false);
      expect(s.error).toBeNull();
      expect(s.lastFetchedAt).toBeNull();
      expect(s.pendingDismissal.size).toBe(0);
    });
  });
});
