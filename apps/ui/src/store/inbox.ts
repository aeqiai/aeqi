import { create } from "zustand";
import { api, type InboxItem } from "@/lib/api";

/**
 * Director-inbox store. Independent slice (not folded into useDaemonStore)
 * because the inbox has its own lifecycle:
 *   - User-scoped, never per-agent.
 *   - Hydrated lazily on `Inbox.tsx` mount, not at app startup.
 *   - Mutated optimistically: `dismissOptimistically` hides a row before
 *     the server confirms (collapse animation runs while the POST flies).
 *   - Reconciled by the WS poller's `inbox_update` event, which is the
 *     authoritative source post-mount.
 *
 * Optimistic dismissal stores the session_id in `pendingDismissal` rather
 * than removing the item from `items` immediately. That way an error path
 * can `restoreItem` without re-fetching, and a duplicate WS event for an
 * already-dismissed item is a no-op.
 */
export interface InboxState {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  /** session_ids hidden by an in-flight or just-completed answer. */
  pendingDismissal: Set<string>;

  fetchInbox: () => Promise<void>;
  answerItem: (sessionId: string, answer: string) => Promise<{ ok: boolean; error?: string }>;
  pushInboxUpdate: (payload: InboxUpdatePayload) => void;
  dismissOptimistically: (sessionId: string) => void;
  restoreItem: (sessionId: string) => void;
  clearInbox: () => void;
}

/**
 * Shape of the WebSocket `inbox_update` event payload. The MVP server
 * emits a full snapshot ({count, items}) on signature change rather than
 * fine-grained add/clear deltas. We treat the snapshot as authoritative —
 * replace `items` wholesale, drop any pendingDismissal entries that the
 * server has reconciled. Future v2 push can layer fine-grained
 * `{kind: "added" | "cleared"}` deltas on top without breaking this.
 */
export type InboxUpdatePayload =
  | { count: number; items: InboxItem[] }
  | { kind: "added"; item: InboxItem }
  | { kind: "cleared"; session_id: string };

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
  pendingDismissal: new Set<string>(),

  fetchInbox: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const resp = await api.getInbox();
      const items = Array.isArray(resp?.items) ? resp.items : [];
      // Reconcile pendingDismissal with server truth: any session_id no
      // longer present in items is genuinely cleared, drop the pending
      // entry. session_ids still present remain hidden until the WS
      // poller picks up the cleared signature.
      set((s) => {
        const next = new Set(s.pendingDismissal);
        const present = new Set(items.map((i) => i.session_id));
        for (const id of next) {
          if (!present.has(id)) next.delete(id);
        }
        return {
          items,
          loading: false,
          lastFetchedAt: Date.now(),
          pendingDismissal: next,
        };
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  answerItem: async (sessionId, answer) => {
    // Optimistic: hide the row immediately so the user sees the collapse
    // animation while the POST flies. On success, the WS poller will
    // emit the cleared signature and `pushInboxUpdate` removes the item
    // from `items` — at which point pendingDismissal is reconciled.
    get().dismissOptimistically(sessionId);
    try {
      const resp = await api.answerInbox(sessionId, answer);
      if (!resp.ok) {
        get().restoreItem(sessionId);
        return { ok: false, error: resp.error || "answer failed" };
      }
      return { ok: true };
    } catch (err) {
      get().restoreItem(sessionId);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  pushInboxUpdate: (payload) => {
    if ("kind" in payload) {
      // Fine-grained delta path — kept for forward-compat with v2 push.
      if (payload.kind === "added") {
        set((s) => {
          if (s.items.some((i) => i.session_id === payload.item.session_id)) {
            return s;
          }
          return { items: [payload.item, ...s.items] };
        });
      } else if (payload.kind === "cleared") {
        set((s) => {
          const next = new Set(s.pendingDismissal);
          next.delete(payload.session_id);
          return {
            items: s.items.filter((i) => i.session_id !== payload.session_id),
            pendingDismissal: next,
          };
        });
      }
      return;
    }
    // Snapshot path (MVP poller). Replace items wholesale and reconcile
    // pendingDismissal against the new server truth.
    set((s) => {
      const present = new Set(payload.items.map((i) => i.session_id));
      const next = new Set(s.pendingDismissal);
      for (const id of next) {
        if (!present.has(id)) next.delete(id);
      }
      return { items: payload.items, pendingDismissal: next };
    });
  },

  dismissOptimistically: (sessionId) => {
    set((s) => {
      const next = new Set(s.pendingDismissal);
      next.add(sessionId);
      return { pendingDismissal: next };
    });
  },

  restoreItem: (sessionId) => {
    set((s) => {
      const next = new Set(s.pendingDismissal);
      next.delete(sessionId);
      return { pendingDismissal: next };
    });
  },

  clearInbox: () => {
    set({
      items: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      pendingDismissal: new Set<string>(),
    });
  },
}));

// ── Selectors ─────────────────────────────────────────────────────────────
// Co-located with the store so consumers don't have to derive the same
// "visible items" filter inline (which would create new identities every
// render and re-trigger React renders unnecessarily).

export const selectVisibleItems = (s: InboxState): InboxItem[] =>
  s.items.filter((i) => !s.pendingDismissal.has(i.session_id));

export const selectInboxCount = (s: InboxState): number => s.items.length - s.pendingDismissal.size;
