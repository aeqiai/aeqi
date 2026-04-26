import { create } from "zustand";
import { api, type InboxItem } from "@/lib/api";

// Optimistic dismissal hides via pendingDismissal instead of mutating
// `items` so an error path can `restoreItem` without re-fetching, and a
// duplicate WS clear for an already-dismissed item is a no-op.
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

// MVP server emits a full snapshot on signature change; v2 may layer
// fine-grained add/clear deltas on top without breaking the snapshot path.
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
      // Drop pendingDismissal entries the server has already cleared;
      // ones still present stay hidden until the WS clears them.
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
    // Optimistic dismiss so the row collapses while the POST flies.
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
      // Forward-compat with v2 fine-grained deltas.
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

// Selectors co-located so consumers share one stable reference and don't
// allocate a fresh filter result every render (would re-trigger React).
export const selectVisibleItems = (s: InboxState): InboxItem[] =>
  s.items.filter((i) => !s.pendingDismissal.has(i.session_id));

export const selectInboxCount = (s: InboxState): number => s.items.length - s.pendingDismissal.size;
