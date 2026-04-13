import { create } from "zustand";
import type { AgentRef } from "@/lib/types";

const SELECTED_AGENT_KEY = "aeqi_selected_agent";

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
  setSelectedAgent: (agent: AgentRef | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedAgent: readSelectedAgent(),
  setSelectedAgent: (agent) => {
    persistSelectedAgent(agent);
    set({ selectedAgent: agent });
  },
}));
