import { create } from "zustand";
import * as activityApi from "@/api/activity";
import * as agentsApi from "@/api/agents";
import * as entitiesApi from "@/api/entities";
import * as questsApi from "@/api/quests";
import * as runtimeApi from "@/api/runtime";
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
      set({ entities: nextEntities });
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
    await Promise.all([
      s.fetchStatus(),
      s.fetchAgents(),
      s.fetchEntities(),
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
