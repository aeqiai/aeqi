import { create } from "zustand";
import { api } from "@/lib/api";
import type { Agent, ActivityEntry } from "@/lib/types";

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

  fetchAgents: async () => {
    // `/api/roots` is user-scoped (no X-Root required) and always lists
    // every company the user owns. `/api/agents` is scoped to the active
    // X-Root and returns the full subtree. We always fetch roots so the
    // sidebar tree has something to render on `/` (where no X-Root is
    // set). When a root is in scope, the subtree response is merged on
    // top, keyed by id.
    const rootsPromise = api.getRoots().catch(() => null);
    const agentsPromise = api.getAgents().catch(() => null);
    const [rootsData, agentsData] = await Promise.all([rootsPromise, agentsPromise]);

    const rootAgents: Agent[] = Array.isArray(rootsData?.roots)
      ? (rootsData.roots as Array<Record<string, unknown>>).map((r) => ({
          id: (r.id as string) ?? (r.name as string),
          name: r.name as string,
          display_name: (r.display_name as string | undefined) ?? undefined,
          status: (r.running as boolean) ? "running" : "stopped",
          parent_id: null,
        }))
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
