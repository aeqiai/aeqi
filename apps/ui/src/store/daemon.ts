import { create } from "zustand";
import { api } from "@/lib/api";
import type { Agent, AuditEntry } from "@/lib/types";

interface DaemonState {
  status: any | null;
  dashboard: any | null;
  cost: any | null;
  agents: Agent[];
  quests: any[];
  events: AuditEntry[];
  workerEvents: any[];
  wsConnected: boolean;
  loading: boolean;

  fetchStatus: () => Promise<void>;
  fetchDashboard: () => Promise<void>;
  fetchCost: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchQuests: () => Promise<void>;
  fetchEvents: () => Promise<void>;
  fetchAll: () => Promise<void>;
  pushWorkerEvent: (event: any) => void;
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
      set({ agents: Array.isArray(raw) ? raw : [] });
    } catch {}
  },

  fetchQuests: async () => {
    try {
      const data = await api.getTasks({});
      const raw = data?.tasks || [];
      set({ quests: Array.isArray(raw) ? raw : [] });
    } catch {}
  },

  fetchEvents: async () => {
    try {
      const data = await api.getAudit({ last: 30 });
      const raw = data?.entries || data?.audit || [];
      set({ events: Array.isArray(raw) ? raw : [] });
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
  },

  pushWorkerEvent: (event: any) => {
    set((s) => ({
      workerEvents: [...s.workerEvents.slice(-99), event],
    }));
  },

  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
}));
