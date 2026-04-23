import { create } from "zustand";
import type { AgentRef } from "@/lib/types";
import type { SessionInfo } from "@/components/session/types";

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

export interface PendingMessage {
  id: string;
  text: string;
  files?: { name: string; content: string; size: number }[];
  ideas?: string[];
  task?: { id: string; name: string };
}

interface ChatState {
  selectedAgent: AgentRef | null;
  setSelectedAgent: (agent: AgentRef | null) => void;
  pendingMessageByAgent: Record<string, PendingMessage | null>;
  setPendingMessage: (agentId: string, msg: PendingMessage | null) => void;
  consumePendingMessage: (agentId: string) => PendingMessage | null;
  queuedDraftsBySession: Record<string, PendingMessage[]>;
  queueDraft: (sessionId: string, draft: PendingMessage) => void;
  consumeQueuedDraft: (sessionId: string) => PendingMessage | null;
  drainQueuedDrafts: (sessionId: string) => PendingMessage[];
  clearQueuedDrafts: (sessionId: string) => void;
  /**
   * Per-agent session list, populated by the active AgentSessionView so the
   * SessionsRail (left-adjacent threads column) can render the same data
   * without re-fetching.
   */
  sessionsByAgent: Record<string, SessionInfo[]>;
  setSessionsForAgent: (agentId: string, sessions: SessionInfo[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  selectedAgent: readSelectedAgent(),
  setSelectedAgent: (agent) => {
    persistSelectedAgent(agent);
    set({ selectedAgent: agent });
  },
  pendingMessageByAgent: {},
  setPendingMessage: (agentId, msg) =>
    set((state) => ({
      pendingMessageByAgent: { ...state.pendingMessageByAgent, [agentId]: msg },
    })),
  consumePendingMessage: (agentId) => {
    let pending: PendingMessage | null = null;
    set((state) => {
      pending = state.pendingMessageByAgent[agentId] || null;
      if (!pending) return {};
      const next = { ...state.pendingMessageByAgent };
      delete next[agentId];
      return { pendingMessageByAgent: next };
    });
    return pending;
  },
  queuedDraftsBySession: {},
  queueDraft: (sessionId, draft) =>
    set((state) => {
      const next = state.queuedDraftsBySession[sessionId] || [];
      return {
        queuedDraftsBySession: {
          ...state.queuedDraftsBySession,
          [sessionId]: [...next, draft],
        },
      };
    }),
  consumeQueuedDraft: (sessionId) => {
    let draft: PendingMessage | null = null;
    set((state) => {
      const next = state.queuedDraftsBySession[sessionId] || [];
      if (next.length === 0) return {};
      [draft] = next;
      const rest = next.slice(1);
      const queuedDraftsBySession = { ...state.queuedDraftsBySession };
      if (rest.length > 0) queuedDraftsBySession[sessionId] = rest;
      else delete queuedDraftsBySession[sessionId];
      return { queuedDraftsBySession };
    });
    return draft;
  },
  drainQueuedDrafts: (sessionId) => {
    let drafts: PendingMessage[] = [];
    set((state) => {
      const next = state.queuedDraftsBySession[sessionId] || [];
      if (next.length === 0) return {};
      drafts = next;
      const queuedDraftsBySession = { ...state.queuedDraftsBySession };
      delete queuedDraftsBySession[sessionId];
      return { queuedDraftsBySession };
    });
    return drafts;
  },
  clearQueuedDrafts: (sessionId) =>
    set((state) => {
      if (!state.queuedDraftsBySession[sessionId]) return {};
      const queuedDraftsBySession = { ...state.queuedDraftsBySession };
      delete queuedDraftsBySession[sessionId];
      return { queuedDraftsBySession };
    }),
  sessionsByAgent: {},
  setSessionsForAgent: (agentId, sessions) =>
    set((state) => ({
      sessionsByAgent: { ...state.sessionsByAgent, [agentId]: sessions },
    })),
}));

export function createDraftId(): string {
  return (
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
