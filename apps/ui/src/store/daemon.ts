import { create } from "zustand";
import * as activityApi from "@/api/activity";
import * as agentsApi from "@/api/agents";
import * as entitiesApi from "@/api/entities";
import * as questsApi from "@/api/quests";
import * as runtimeApi from "@/api/runtime";
import { getScopedEntity } from "@/lib/appMode";
import type { Agent, ActivityEntry, Entity, Quest } from "@/lib/types";

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
  entities: Entity[];
  agents: Agent[];
  quests: Quest[];
  events: ActivityEntry[];
  workerEvents: WorkerEvent[];
  wsConnected: boolean;
  loading: boolean;
  initialLoaded: boolean;

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

export const useDaemonStore = create<DaemonState>((set, get) => ({
  status: null,
  dashboard: null,
  cost: null,
  entities: [],
  agents: [],
  quests: [],
  events: [],
  workerEvents: [],
  wsConnected: false,
  loading: false,
  initialLoaded: false,

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
      const data = await entitiesApi.getEntitiesRaw();
      const nextEntities = entitiesApi.normalizeEntityRoots(data);
      // Empty + no `entities` key on the response = transient/auth
      // failure; keep what we had. Empty + key present = the user
      // genuinely has no companies; commit the empty list.
      if (nextEntities.length === 0 && !Array.isArray(data.entities)) return;
      set({ entities: nextEntities, initialLoaded: true });
      // Mirror trust_address → entity_id so module-level helpers
      // (`getScopedEntity` in particular, which runs without React
      // context to compute the `X-Entity` header for every API call
      // and the WS routing key) can resolve `/trust/<addr>/...` URL
      // slugs into the canonical entity_id the platform proxy expects.
      // The platform `extract_entity_id` only accepts UUIDs ("slug
      // fallback chain is gone" per `src/routes/proxy.rs`) — without
      // this mirror every entity-scoped fetch from a `/trust/<addr>/...`
      // route 404s. Stable JSON shape: `{ <trust_address>: <entity_id> }`.
      try {
        const map: Record<string, string> = {};
        for (const e of nextEntities) {
          if (e.trust_address) map[e.trust_address] = e.id;
        }
        localStorage.setItem("aeqi_trust_to_entity", JSON.stringify(map));
      } catch {
        // localStorage can fail in private-mode or quota-exceeded —
        // resolution falls back to the raw URL slug, which is the
        // pre-fix behavior. Don't block the entity hydration.
      }
    } catch {
      // Keep existing entities on transient failure.
    }
  },

  fetchAgents: async () => {
    // `/api/entities` is user-scoped (no X-Entity required) and always
    // lists every company the user owns. `/api/agents` is scoped to the
    // active X-Entity and returns the full subtree. We fetch both so the
    // sidebar has roots to show on `/` (where no X-Entity is set) and the
    // agent subtree is available for per-company pages.
    const nextAgents = await agentsApi.listAgentDirectory();

    if (nextAgents.length === 0) {
      // Both failed — keep existing state rather than blanking the tree.
      return;
    }

    set({ agents: nextAgents });
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
    const s = get();
    // fetchEntities is user-scoped (no X-Entity required) and produces the
    // companies the user owns. Run it first so that on first ever load we
    // don't fire the entity-scoped proxy fetches against an empty scope —
    // the proxy 400s with "X-Entity required" and the dashboard ends up
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
  },

  pushWorkerEvent: (event: WorkerEvent) => {
    set((s) => ({
      workerEvents: [...s.workerEvents.slice(-99), event],
    }));
  },

  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
}));

/** Selector: list of entities (companies) the user owns. */
export function useEntities() {
  return useDaemonStore((s) => s.entities);
}

/** Selector: the entity whose id matches activeEntity, or null. */
export function useActiveEntity(activeEntityId: string) {
  return useDaemonStore((s) => s.entities.find((e) => e.id === activeEntityId) ?? null);
}
