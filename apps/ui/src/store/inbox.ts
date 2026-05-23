import { create } from "zustand";
import { api, type InboxItem } from "@/lib/api";
import { getScopedEntity } from "@/lib/appMode";

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
  dismissItem: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  pushInboxUpdate: (payload: InboxUpdatePayload) => void;
  dismissOptimistically: (sessionId: string) => void;
  restoreItem: (sessionId: string) => void;
  clearInbox: () => void;
}

// Module-level availability gate for the archive affordance. Earlier builds
// fired a speculative HEAD probe on page mount; Chromium reports the platform's
// aborted HEAD as a request failure, so the investor-facing inbox looked noisy
// in route audits even though the page rendered. Gate only on local auth/entity
// state and let the real archive POST surface action failures.
const PROBE_CACHE_KEY_PREFIX = "aeqi_inbox_probe_v2_";

// Derive the current deploy hash from the live `index-<hash>.js` script tag
// vite emits. Falls back to a stable string when the script tag isn't found
// (dev server, SSR, or a future bundler shape).
function getDeployHash(): string {
  try {
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[src*=index-]");
    for (const s of Array.from(scripts)) {
      const m = s.src.match(/index-([A-Za-z0-9_-]+)\.js/);
      if (m) return m[1];
    }
  } catch {
    // document unavailable — fall through.
  }
  return "dev";
}

let dismissEndpointAvailable: boolean | null = null;
export async function probeDismissEndpoint(): Promise<boolean> {
  if (dismissEndpointAvailable !== null) return dismissEndpointAvailable;

  const cacheKey = PROBE_CACHE_KEY_PREFIX + getDeployHash();
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached === "1") {
      dismissEndpointAvailable = true;
      return true;
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to live probe.
  }

  const token = localStorage.getItem("aeqi_token");
  // Skip the probe entirely pre-auth — the route is auth-required and a
  // pre-auth HEAD will 401, which leaks into the console as a network error.
  // The probe will run on the next call after login.
  if (!token) {
    return false;
  }

  // The platform proxy on /api/inbox/* requires an X-Trust header — without
  // it the catch-all extracts a missing entity id and returns 400 (NOT 401),
  // which leaks a console error on every inbox mount. Skip the probe until an
  // entity scope is set; the next inbox mount with a real X-Trust will run
  // the probe cleanly. This mirrors the daemon-store fetchAll ordering rule
  // (entity-scoped fetches gate on getScopedEntity()).
  const trustId = getScopedEntity();
  if (!trustId) {
    return false;
  }

  dismissEndpointAvailable = true;
  try {
    localStorage.setItem(cacheKey, "1");
  } catch {
    // localStorage write failure — non-fatal.
  }
  return true;
}

export function __resetInboxProbeForTests(): void {
  dismissEndpointAvailable = null;
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
      const raw = Array.isArray(resp?.items) ? resp.items : [];
      // Belt-and-braces presentational guard against agent-only cron
      // sessions leaking into the user inbox. The runtime SQL gate is
      // the canonical filter — this is a tertiary defense for if the
      // user_id-forwarding path ever short-circuits again. Drop entries
      // whose session_name starts with "schedule:" AND have no awaiting
      // marker (cron fires the agent acted on alone, no human reply
      // expected). Joined sessions that happen to be cron-attached
      // still surface because awaiting_at is non-null when the agent
      // has asked the user something.
      const items = raw.filter(
        (i) => !(i.session_name?.startsWith("schedule:") && i.awaiting_at === null),
      );
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
    // Answering a session is just sending a reply — the row stays in the
    // inbox like every other ongoing conversation. The "awaiting" pending-
    // dot indicator clears when the backend clears `awaiting_at`; the row
    // itself remains visible. Explicit archive is the only path that hides
    // a row (that's `dismissItem`).
    try {
      const resp = await api.answerInbox(sessionId, answer);
      if (!resp.ok) {
        return { ok: false, error: resp.error || "answer failed" };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  dismissItem: async (sessionId) => {
    get().dismissOptimistically(sessionId);
    try {
      const resp = await api.dismissInbox(sessionId);
      if (!resp.ok) {
        get().restoreItem(sessionId);
        return { ok: false, error: resp.error || "dismiss failed" };
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
        // `cleared` means the backend cleared `awaiting_at` on this session
        // (user answered, or the agent moved on). Drop the awaiting flag on
        // the row but KEEP it visible — answering a question shouldn't make
        // the conversation disappear from the user's inbox. Explicit
        // archive (`dismissItem`) is the only path that removes a row.
        set((s) => {
          const next = new Set(s.pendingDismissal);
          next.delete(payload.session_id);
          return {
            items: s.items.map((i) =>
              i.session_id === payload.session_id ? { ...i, awaiting_at: null } : i,
            ),
            pendingDismissal: next,
          };
        });
      }
      return;
    }
    set((s) => {
      // Apply the same belt-and-braces filter on WS-pushed snapshots so
      // a cron-flooded snapshot doesn't bypass the fetch-time guard.
      const items = payload.items.filter(
        (i) => !(i.session_name?.startsWith("schedule:") && i.awaiting_at === null),
      );
      const present = new Set(items.map((i) => i.session_id));
      const next = new Set(s.pendingDismissal);
      for (const id of next) {
        if (!present.has(id)) next.delete(id);
      }
      return { items, pendingDismissal: next };
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

/**
 * Count of sessions awaiting a human reply — the badge value the rail
 * surfaces to indicate "X things need you." After 2026-05-07 the inbox
 * stream returns every session in scope (history); this selector stays
 * narrow to awaiting items so the badge keeps its prior meaning.
 */
export const selectInboxCount = (s: InboxState): number =>
  s.items.filter((i) => !!i.awaiting_at && !s.pendingDismissal.has(i.session_id)).length;
