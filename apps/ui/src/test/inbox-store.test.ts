import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetInboxProbeForTests,
  probeDismissEndpoint,
  selectInboxCount,
  selectVisibleItems,
  useInboxStore,
} from "@/store/inbox";
import type { InboxItem } from "@/lib/api";

function makeItem(
  sessionId: string,
  awaitingAt: string | null = "2026-04-25T10:00:00Z",
): InboxItem {
  return {
    session_id: sessionId,
    agent_id: `agent-${sessionId}`,
    agent_name: `Agent ${sessionId}`,
    trust_id: `entity-${sessionId}`,
    session_name: `session ${sessionId}`,
    awaiting_subject: "subject",
    awaiting_at: awaitingAt,
    last_agent_message: "thinking aloud",
    last_active: awaitingAt ?? "2026-04-25T10:00:00Z",
  };
}

describe("inbox store", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    __resetInboxProbeForTests();
    useInboxStore.setState({
      items: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      pendingDismissal: new Set<string>(),
    });
  });

  describe("probeDismissEndpoint", () => {
    it("does not fire a speculative network request on inbox mount", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      localStorage.setItem("aeqi_token", "token");
      localStorage.setItem("aeqi_entity", "trust-1");

      await expect(probeDismissEndpoint()).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stays unavailable until auth and entity scope exist", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(probeDismissEndpoint()).resolves.toBe(false);
      localStorage.setItem("aeqi_token", "token");
      await expect(probeDismissEndpoint()).resolves.toBe(false);

      expect(fetchMock).not.toHaveBeenCalled();
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

    it("'cleared' clears awaiting_at on the row but keeps it visible", () => {
      useInboxStore.setState({
        items: [{ ...makeItem("a"), awaiting_at: "2026-05-09T08:00:00Z" }, makeItem("b")],
        pendingDismissal: new Set<string>(["a"]),
      });
      useInboxStore.getState().pushInboxUpdate({ kind: "cleared", session_id: "a" });
      // Row stays — answering a question doesn't archive the conversation.
      expect(useInboxStore.getState().items.map((i) => i.session_id)).toEqual(["a", "b"]);
      // Awaiting flag is gone (the rail-dot indicator clears).
      expect(useInboxStore.getState().items.find((i) => i.session_id === "a")?.awaiting_at).toBe(
        null,
      );
      // pendingDismissal entry is dropped (cleanup of stale optimistic state).
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

    // After 2026-05-07 the inbox surfaces every session in scope, not
    // just decision-requests. The badge value must stay narrow to
    // awaiting items so the rail's "X things need you" indicator keeps
    // its prior meaning.
    it("counts only awaiting items (awaiting_at non-null)", () => {
      useInboxStore.setState({
        items: [
          makeItem("a"), // awaiting (default)
          makeItem("b", null), // history, no awaiting bit
          makeItem("c", null), // history, no awaiting bit
        ],
        pendingDismissal: new Set<string>(),
      });
      expect(selectInboxCount(useInboxStore.getState())).toBe(1);
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
