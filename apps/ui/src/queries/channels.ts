import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as channelsApi from "@/api/channels";
import type { ChannelEntry } from "@/api/channels";
import { channelKeys } from "./keys";

const EMPTY_CHANNELS: ChannelEntry[] = [];

export function useAgentChannels(agentId: string | null | undefined) {
  return useQuery({
    queryKey: channelKeys.byAgent(agentId ?? ""),
    queryFn: async () => {
      const data = await channelsApi.listAgentChannels(agentId ?? "");
      return data.channels ?? EMPTY_CHANNELS;
    },
    enabled: Boolean(agentId),
    staleTime: 30_000,
  });
}

export function useChannelSessions(agentId: string | null | undefined) {
  return useQuery({
    queryKey: channelKeys.sessions(agentId ?? ""),
    queryFn: async () => {
      const data = await channelsApi.listChannelSessions(agentId ?? "");
      return data.sessions ?? [];
    },
    enabled: Boolean(agentId),
    staleTime: 15_000,
  });
}

export function useAgentChannelsCache(agentId: string) {
  const queryClient = useQueryClient();
  const key = useMemo(() => channelKeys.byAgent(agentId), [agentId]);

  const invalidateChannels = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const getChannels = useCallback(() => {
    return queryClient.getQueryData<ChannelEntry[]>(key) ?? EMPTY_CHANNELS;
  }, [queryClient, key]);

  const patchChannel = useCallback(
    (id: string, patch: Partial<ChannelEntry>) => {
      queryClient.setQueryData<ChannelEntry[]>(key, (current) =>
        current?.map((channel) => (channel.id === id ? { ...channel, ...patch } : channel)),
      );
    },
    [queryClient, key],
  );

  const removeChannel = useCallback(
    (id: string) => {
      queryClient.setQueryData<ChannelEntry[]>(key, (current) =>
        current?.filter((channel) => channel.id !== id),
      );
    },
    [queryClient, key],
  );

  return { getChannels, invalidateChannels, patchChannel, removeChannel };
}
