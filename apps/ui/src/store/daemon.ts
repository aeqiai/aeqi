import { create } from "zustand";
import * as activityApi from "@/api/activity";
import * as agentsApi from "@/api/agents";
import * as companiesApi from "@/api/companies";
import * as questsApi from "@/api/quests";
import * as runtimeApi from "@/api/runtime";
import { getScopedEntity } from "@/lib/appMode";
import type { Agent, ActivityEntry, Company, Quest } from "@/lib/types";

interface WorkerEvent {
  id?: string | number;
  timestamp?: string;
  event_type?: string;
  [key: string]: unknown;
}

interface DaemonState {
  status: Record<string, unknown> | null;
  dashboard: Record<string, unknown> | null;
  cost: Record<string, unknown> | null;
  entities: Company[];
  agents: Agent[];
  quests: Quest[];
  events: ActivityEntry[];
  workerEvents: WorkerEvent[];
  wsConnected: boolean;
  loading: boolean;
  initialLoaded: boolean;
  agentsLoaded: boolean;

  fetchStatus: () => Promise<void>;
  fetchDashboard: () => Promise<void>;
  fetchCost: () => Promise<void>;
  fetchEntities: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchQuests: () => Promise<void>;
  fetchEvents: () => Promise<void>;
  fetchAll: () => Promise<void>;
  pushWorkerEvent: (event: WorkerEvent) => void;
  setWsConnected: (connected: boolean) => void;
}

const RECENT_FETCH_ALL_MS = 2_000;
let fetchAllInFlight: Promise<void> | null = null;
let fetchAllInFlightKey = "";
let lastFetchAllKey = "";
let lastFetchAllSettledAt = 0;

// Hydrate cached companies and agents from localStorage so the
// LeftSidebar / agent tree paint the real shape on
// hard refresh instead of flashing the empty-list state for the
// 50-500 ms it takes fetchEntities() and fetchAgents() to round-trip.
// Same pattern as the auth-store user persistence; cache is overwritten
// by the persist subscriber below on every successful fetch.
function hydrate<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export const useDaemonStore = create<DaemonState>((set, get) => ({
  status: null,
  dashboard: null,
  cost: null,
  entities: hydrate<Company>("aeqi_daemon_entities"),
  agents: hydrate<Agent>("aeqi_daemon_agents"),
  quests: [],
  events: [],
  workerEvents: [],
  wsConnected: false,
  loading: false,
  initialLoaded: false,
  agentsLoaded: false,

  fetchStatus: async () => {
    try {
      const data = await runtimeApi.getStatus();
      set({ status: data });
    } catch {
      set({ status: null });
    }
  },

  fetchDashboard: async () => {
    set({ loading: true });
    try {
      const data = await runtimeApi.getDashboard();
      set({ dashboard: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchCost: async () => {
    try {
      set({ cost: await runtimeApi.getCost() });
    } catch {
      // Cost is non-critical, don't surface errors.
    }
  },

  fetchEntities: async () => {
    try {
      const data = await companiesApi.getCompaniesRaw();
      const nextEntities = companiesApi.normalizeCompanyRoots(data);
      // Empty + no `companies` key on the response = transient/auth
      // failure; keep what we had. Empty + key present = the user
      // genuinely has no companies; commit the empty list.
      if (
        nextEntities.length === 0 &&
        !Array.isArray(data.companies) &&
        !Array.isArray(data.entities) &&
        !Array.isArray(data.roots)
      )
        return;
      set({ entities: nextEntities, initialLoaded: true });
      // Company-first migration (2026-05-17): the route slug is the
      // on-chain company address, but the API often wants the canonical
      // entity id. `getScopedEntity` resolves the slug through this cached
      // entity list when possible. Clear any stale map from pre-migration
      // browser sessions so the first page after deploy doesn't 404 on a
      // now-invalid lookup.
      try {
        localStorage.removeItem("aeqi_company_to_entity");
      } catch {
        // localStorage can fail in private-mode — non-blocking.
      }
    } catch {
      // Keep existing companies on transient failure.
    }
  },

  fetchAgents: async () => {
    // `/api/companies` is user-scoped (no X-Company required) and always
    // lists every company the user owns. `/api/agents` is scoped to the
    // active X-Company and returns the full subtree. We fetch both so the
    // sidebar has roots to show on `/` (where no X-Company is set) and the
    // agent subtree is available for per-company pages.
    try {
      const nextAgents = await agentsApi.listAgentDirectory();

      if (nextAgents.length > 0) {
        set({ agents: nextAgents });
      }
    } finally {
      // Mark the directory load as settled so drilled-agent routes can
      // decide whether a missing agent is a real miss versus a hydration
      // gap on refresh.
      set({ agentsLoaded: true });
    }
  },

  fetchQuests: async () => {
    try {
      const data = await questsApi.listQuests({});
      set({ quests: data.quests || [] });
    } catch {
      // Keep existing quests on transient failure.
    }
  },

  fetchEvents: async () => {
    try {
      const data = await activityApi.listActivityStream({ last: 30 });
      set({ events: data.events || [] });
    } catch {
      // Keep existing events on transient failure.
    }
  },

  fetchAll: async () => {
    const scopedEntity = getScopedEntity() ?? "";
    const now = Date.now();
    if (fetchAllInFlight && fetchAllInFlightKey === scopedEntity) return fetchAllInFlight;
    if (scopedEntity === lastFetchAllKey && now - lastFetchAllSettledAt < RECENT_FETCH_ALL_MS) {
      return;
    }

    const s = get();
    const run = (async () => {
      // fetchEntities is user-scoped (no X-Company required) and produces the
      // companies the user owns. Run it first so that on first ever load we
      // don't fire the entity-scoped proxy fetches against an empty scope —
      // the proxy 400s with "X-Company required" and the dashboard ends up
      // with five red entries before fetchEntities has resolved.
      await s.fetchEntities();
      if (!getScopedEntity()) {
        // No active entity yet — the user just landed at `/` with zero
        // companies, or hasn't picked one. Skip the proxied fetches; they
        // require entity scope and there's nothing to render against them.
        set({ initialLoaded: true });
        return;
      }
      await Promise.all([
        s.fetchStatus(),
        s.fetchAgents(),
        s.fetchQuests(),
        s.fetchEvents(),
        s.fetchCost(),
      ]);
      set({ initialLoaded: true });
    })();

    fetchAllInFlight = run;
    fetchAllInFlightKey = scopedEntity;
    try {
      await run;
    } finally {
      if (fetchAllInFlight === run) {
        lastFetchAllKey = scopedEntity;
        lastFetchAllSettledAt = Date.now();
        fetchAllInFlight = null;
        fetchAllInFlightKey = "";
      }
    }
  },

  pushWorkerEvent: (event: WorkerEvent) => {
    set((s) => ({
      workerEvents: [...s.workerEvents.slice(-99), event],
    }));
  },

  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
}));

// Persist `entities` and `agents` to localStorage on every change. Paired
// with the synchronous `hydrate()` reads above so hard refresh restores
// the real sidebar/company-switcher shape instead of flashing empty
// lists. Plain `subscribe` + module-level reference compares match the
// auth-store pattern (no `subscribeWithSelector` middleware needed).
// `quests` and `events` deliberately do NOT persist — quests are
// entity-scoped (a stale cache from one entity could leak into another
// on refresh), and the events stream is bounded to the last 30 entries
// and a fresh fetch is faster than reconstructing local state.
let lastEntities: Company[] = [];
let lastAgents: Agent[] = [];
useDaemonStore.subscribe((state) => {
  if (state.entities !== lastEntities) {
    lastEntities = state.entities;
    try {
      localStorage.setItem("aeqi_daemon_entities", JSON.stringify(state.entities));
    } catch {
      // localStorage unavailable (Safari private etc.) — non-fatal.
    }
  }
  if (state.agents !== lastAgents) {
    lastAgents = state.agents;
    try {
      localStorage.setItem("aeqi_daemon_agents", JSON.stringify(state.agents));
    } catch {
      // localStorage unavailable (Safari private etc.) — non-fatal.
    }
  }
});

/** Selector: list of companies the user owns. */
export function useEntities() {
  return useDaemonStore((s) => s.entities);
}

/** Selector: the company whose id matches activeEntity, or null. */
export function useActiveEntity(activeEntityId: string) {
  return useDaemonStore((s) => s.entities.find((e) => e.id === activeEntityId) ?? null);
}
