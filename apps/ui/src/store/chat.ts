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

/**
 * A message the user typed in the persistent composer while no chat view
 * was mounted. AgentSessionView consumes this on mount so the user doesn't
 * have to re-press Send after we navigate them into the chat.
 */
interface PendingMessage {
  text: string;
  files?: { name: string; content: string; size: number }[];
  prompts?: string[];
  task?: { id: string; name: string };
}

interface ChatState {
  selectedAgent: AgentRef | null;
  setSelectedAgent: (agent: AgentRef | null) => void;
  pendingMessage: PendingMessage | null;
  setPendingMessage: (msg: PendingMessage | null) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedAgent: readSelectedAgent(),
  setSelectedAgent: (agent) => {
    persistSelectedAgent(agent);
    set({ selectedAgent: agent });
  },
  pendingMessage: null,
  setPendingMessage: (msg) => set({ pendingMessage: msg }),
}));
