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
      const data = await api.getCost();
      set({ cost: data });
    } catch {}
  },

  fetchAgents: async () => {
    try {
      const data = await api.getAgents();
      const raw = data?.agents || data?.registry || [];
      set({ agents: Array.isArray(raw) ? (raw as Agent[]) : [] });
    } catch {}
  },

  fetchQuests: async () => {
    try {
      const data = await api.getTasks({});
      const raw = data?.tasks || [];
      set({ quests: Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [] });
    } catch {}
  },

  fetchEvents: async () => {
    try {
      const data = await api.getActivityStream({ last: 30 });
      const raw = data?.entries || data?.activity || [];
      set({ events: Array.isArray(raw) ? (raw as ActivityEntry[]) : [] });
    } catch {}
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
