import { create } from "zustand";
import { api } from "@/lib/api";
import type { AgentEvent } from "@/lib/types";

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
  key: string;
  content: string;
  channel_type: string;
  config: Record<string, unknown>;
}

interface AgentDataState {
  eventsByAgent: Record<string, AgentEvent[]>;
  channelsByAgent: Record<string, ChannelEntry[]>;

  loadEvents: (agentId: string) => Promise<void>;
  loadChannels: (agentId: string) => Promise<void>;

  /** Replace a single event in-place (after edit) without a full refetch. */
  patchEvent: (agentId: string, id: string, patch: Partial<AgentEvent>) => void;
  /** Drop an event from the list (after delete). */
  removeEvent: (agentId: string, id: string) => void;
  /** Drop a channel from the list (after delete). */
  removeChannel: (agentId: string, id: string) => void;
}

export const useAgentDataStore = create<AgentDataState>((set, get) => ({
  eventsByAgent: {},
  channelsByAgent: {},

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
      const ideas = (data.ideas || []) as Array<Record<string, unknown>>;
      const channels: ChannelEntry[] = ideas
        .filter((i) => typeof i.name === "string" && (i.name as string).startsWith("channel:"))
        .map((i) => {
          const key = i.name as string;
          let config: Record<string, unknown> = {};
          try {
            config = JSON.parse(i.content as string);
          } catch {
            config = { raw: i.content };
          }
          return {
            id: i.id as string,
            key,
            content: i.content as string,
            channel_type: key.replace("channel:", ""),
            config,
          };
        });
      set((s) => ({ channelsByAgent: { ...s.channelsByAgent, [agentId]: channels } }));
    } catch {
      set((s) => ({ channelsByAgent: { ...s.channelsByAgent, [agentId]: [] } }));
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
}));
