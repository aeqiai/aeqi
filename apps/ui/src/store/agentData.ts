import { create } from "zustand";
import { api } from "@/lib/api";
import type { AgentEvent, Idea } from "@/lib/types";

/**
 * Shared per-agent data for the master/detail rail pattern.
 *
 * Multiple components need the same list at the same time — ContentCTA
 * renders the list in the right rail, the main tab component renders the
 * detail. Keeping the data in one place avoids double-fetching and keeps
 * list/detail in sync.
 */

export interface ChannelEntry {
  id: string;
  agent_id: string;
  kind: string;
  config: Record<string, unknown>;
  enabled: boolean;
  /** Whitelisted external chat ids (telegram chat_id, slack channel, etc.).
   *  Empty = no restriction. Lives in the `channel_allowed_chats` table
   *  server-side; joined into the channel row on read. */
  allowed_chats: string[];
}

interface AgentDataState {
  eventsByAgent: Record<string, AgentEvent[]>;
  channelsByAgent: Record<string, ChannelEntry[]>;
  ideasByAgent: Record<string, Idea[]>;

  loadEvents: (agentId: string) => Promise<void>;
  loadChannels: (agentId: string) => Promise<void>;
  loadIdeas: (agentId: string) => Promise<void>;

  /** Replace a single event in-place (after edit) without a full refetch. */
  patchEvent: (agentId: string, id: string, patch: Partial<AgentEvent>) => void;
  /** Drop an event from the list (after delete). */
  removeEvent: (agentId: string, id: string) => void;
  /** Drop a channel from the list (after delete). */
  removeChannel: (agentId: string, id: string) => void;
  /** Replace a single channel in-place (optimistic update). */
  patchChannel: (agentId: string, id: string, patch: Partial<ChannelEntry>) => void;
  /** Replace a single idea in-place (after edit) without a full refetch. */
  patchIdea: (agentId: string, id: string, patch: Partial<Idea>) => void;
  /** Drop an idea from the list (after delete). */
  removeIdea: (agentId: string, id: string) => void;
  /** Prepend a freshly-created idea (after create). */
  addIdea: (agentId: string, idea: Idea) => void;
}

export const useAgentDataStore = create<AgentDataState>((set, get) => ({
  eventsByAgent: {},
  channelsByAgent: {},
  ideasByAgent: {},

  loadEvents: async (agentId) => {
    if (!agentId) return;
    try {
      const data = await api.getAgentEvents(agentId);
      const events = ((data.events as AgentEvent[]) || []).slice();
      set((s) => ({ eventsByAgent: { ...s.eventsByAgent, [agentId]: events } }));
    } catch {
      set((s) => ({ eventsByAgent: { ...s.eventsByAgent, [agentId]: [] } }));
    }
  },

  loadChannels: async (agentId) => {
    if (!agentId) return;
    try {
      const data = await api.getAgentChannels(agentId);
      const rows = (data.channels || []) as Array<Record<string, unknown>>;
      const channels: ChannelEntry[] = rows.map((r) => {
        const config = (r.config as Record<string, unknown>) || {};
        const kind = (r.kind as string) || (config.kind as string) || "unknown";
        const allowed = (r.allowed_chats as unknown[]) || [];
        return {
          id: r.id as string,
          agent_id: r.agent_id as string,
          kind,
          config,
          enabled: (r.enabled as boolean) ?? true,
          allowed_chats: allowed.map((v) => String(v)),
        };
      });
      set((s) => ({ channelsByAgent: { ...s.channelsByAgent, [agentId]: channels } }));
    } catch {
      // Don't wipe the list on a transient fetch failure — that renders
      // "No channels" (empty-state), indistinguishable from success. Leave
      // whatever is cached. Only initialize to [] if nothing was loaded yet
      // so the detail pane can render its empty state on first-visit errors.
      set((s) => {
        if (s.channelsByAgent[agentId] !== undefined) return s;
        return { channelsByAgent: { ...s.channelsByAgent, [agentId]: [] } };
      });
    }
  },

  loadIdeas: async (agentId) => {
    if (!agentId) return;
    try {
      const data = await api.getIdeas({ agent_id: agentId });
      const ideas = ((data.ideas as Idea[]) || []).slice();
      set((s) => ({ ideasByAgent: { ...s.ideasByAgent, [agentId]: ideas } }));
    } catch {
      set((s) => {
        if (s.ideasByAgent[agentId] !== undefined) return s;
        return { ideasByAgent: { ...s.ideasByAgent, [agentId]: [] } };
      });
    }
  },

  patchEvent: (agentId, id, patch) => {
    const current = get().eventsByAgent[agentId];
    if (!current) return;
    set((s) => ({
      eventsByAgent: {
        ...s.eventsByAgent,
        [agentId]: current.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
    }));
  },

  removeEvent: (agentId, id) => {
    const current = get().eventsByAgent[agentId];
    if (!current) return;
    set((s) => ({
      eventsByAgent: {
        ...s.eventsByAgent,
        [agentId]: current.filter((e) => e.id !== id),
      },
    }));
  },

  removeChannel: (agentId, id) => {
    const current = get().channelsByAgent[agentId];
    if (!current) return;
    set((s) => ({
      channelsByAgent: {
        ...s.channelsByAgent,
        [agentId]: current.filter((c) => c.id !== id),
      },
    }));
  },

  patchChannel: (agentId, id, patch) => {
    const current = get().channelsByAgent[agentId];
    if (!current) return;
    set((s) => ({
      channelsByAgent: {
        ...s.channelsByAgent,
        [agentId]: current.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
    }));
  },

  patchIdea: (agentId, id, patch) => {
    const current = get().ideasByAgent[agentId];
    if (!current) return;
    set((s) => ({
      ideasByAgent: {
        ...s.ideasByAgent,
        [agentId]: current.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      },
    }));
  },

  removeIdea: (agentId, id) => {
    const current = get().ideasByAgent[agentId];
    if (!current) return;
    set((s) => ({
      ideasByAgent: {
        ...s.ideasByAgent,
        [agentId]: current.filter((i) => i.id !== id),
      },
    }));
  },

  addIdea: (agentId, idea) => {
    const current = get().ideasByAgent[agentId] ?? [];
    set((s) => ({
      ideasByAgent: {
        ...s.ideasByAgent,
        [agentId]: [idea, ...current],
      },
    }));
  },
}));
