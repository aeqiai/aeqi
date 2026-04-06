import { create } from "zustand";
import type { AgentRef, ChatThreadState } from "@/lib/types";

const THREADS_STORAGE_KEY = "aeqi_session_threads";
const SELECTED_AGENT_KEY = "aeqi_selected_agent";
const GLOBAL_KEY = "__global__";

function agentKey(agentId: string | null): string {
  return agentId || GLOBAL_KEY;
}

function readThreads(): Record<string, ChatThreadState> {
  try {
    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChatThreadState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistThreads(threads: Record<string, ChatThreadState>) {
  try {
    localStorage.setItem(THREADS_STORAGE_KEY, JSON.stringify(threads));
  } catch {
    // ignore localStorage failures
  }
}

function readSelectedAgent(): AgentRef | null {
  try {
    const raw = localStorage.getItem(SELECTED_AGENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AgentRef;
  } catch {
    return null;
  }
}

function persistSelectedAgent(agent: AgentRef | null) {
  try {
    if (agent) localStorage.setItem(SELECTED_AGENT_KEY, JSON.stringify(agent));
    else localStorage.removeItem(SELECTED_AGENT_KEY);
  } catch {
    // ignore localStorage failures
  }
}

interface ChatState {
  selectedAgent: AgentRef | null;
  threads: Record<string, ChatThreadState>;
  setSelectedAgent: (agent: AgentRef | null) => void;
  getOrCreateThread: (agentId: string | null) => ChatThreadState;
  updateThread: (agentId: string | null, patch: Partial<ChatThreadState>) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  selectedAgent: readSelectedAgent(),
  threads: readThreads(),
  setSelectedAgent: (agent) => {
    persistSelectedAgent(agent);
    set({ selectedAgent: agent });
  },
  getOrCreateThread: (agentId): ChatThreadState => {
    const key = agentKey(agentId);
    const current = get().threads[key];
    if (current) {
      return current;
    }

    const next = {};
    set((state) => {
      const threads = { ...state.threads, [key]: next };
      persistThreads(threads);
      return { threads };
    });
    return next;
  },
  updateThread: (agentId, patch) => {
    const key = agentKey(agentId);
    set((state) => {
      const current = state.threads[key] || {};
      const threads = {
        ...state.threads,
        [key]: { ...current, ...patch },
      };
      persistThreads(threads);
      return { threads };
    });
  },
}));
