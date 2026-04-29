import { create } from "zustand";
import { api } from "@/lib/api";
import type { Agent, ActivityEntry, Entity } from "@/lib/types";

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
  quests: Array<Record<string, unknown>>;
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
      const data = await api.getStatus();
      set({ status: data });
    } catch {
      set({ status: null });
    }
  },

  fetchDashboard: async () => {
    set({ loading: true });
    try {
      const data = await api.getDashboard();
      set({ dashboard: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchCost: async () => {
    try {
      set({ cost: await api.getCost() });
    } catch {
      // Cost is non-critical, don't surface errors.
    }
  },

  fetchEntities: async () => {
    try {
      const data = await api.getEntities();
      const raw: Array<Record<string, unknown>> = Array.isArray(data?.roots)
        ? (data.roots as Array<Record<string, unknown>>)
        : [];
      const nextEntities: Entity[] = raw
        .map<Entity>((r) => ({
          id: (r.id as string) ?? "",
          name: r.name as string,
          type: "company" as const,
          status: (r.running as boolean) ? "active" : "paused",
          avatar: r.avatar as string | undefined,
          color: r.color as string | undefined,
          budget_usd: r.budget_usd as number | undefined,
          created_at: (r.created_at as string) ?? new Date(0).toISOString(),
          last_active: r.last_active as string | undefined,
        }))
        .filter((e) => e.id);
      if (nextEntities.length === 0 && raw.length === 0) return;
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
    const entitiesPromise = api.getEntities().catch(() => null);
    const agentsPromise = api.getAgents().catch(() => null);
    const [entitiesData, agentsData] = await Promise.all([entitiesPromise, agentsPromise]);

    // Each entity in `entitiesData.roots` corresponds to one company. We
    // synthesize a placeholder Agent record per entity so the sidebar can
    // render a row even when the per-entity agents list hasn't loaded.
    // After Phase 4 these placeholders carry the entity_id (the agent_id
    // surfaced by the IPC response is the entity's root agent id, but the
    // sidebar treats them interchangeably for navigation purposes).
    const rootAgents: Agent[] = Array.isArray(entitiesData?.roots)
      ? (entitiesData.roots as Array<Record<string, unknown>>).map((r) => {
          const entityId = (r.id as string) ?? "";
          const agentId = (r.agent_id as string) ?? entityId;
          return {
            id: agentId,
            name: r.name as string,
            status: (r.running as boolean) ? "running" : "stopped",
            entity_id: entityId,
          };
        })
      : [];
    const scopedAgents: Agent[] = (agentsData?.agents as Agent[]) || [];

    if (rootAgents.length === 0 && scopedAgents.length === 0) {
      // Both failed — keep existing state rather than blanking the tree.
      return;
    }

    const byId = new Map<string, Agent>();
    for (const r of rootAgents) byId.set(r.id, r);
    for (const a of scopedAgents) byId.set(a.id, a);
    set({ agents: Array.from(byId.values()) });
  },

  fetchQuests: async () => {
    try {
      const data = await api.getQuests({});
      set({ quests: (data?.quests as Array<Record<string, unknown>>) || [] });
    } catch {
      // Keep existing quests on transient failure.
    }
  },

  fetchEvents: async () => {
    try {
      const data = await api.getActivityStream({ last: 30 });
      set({ events: (data?.events as ActivityEntry[]) || [] });
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
