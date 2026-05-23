import { useCallback, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as eventsApi from "@/api/events";
import type { AgentEvent } from "@/lib/types";
import { eventKeys } from "./keys";

const EMPTY_EVENTS: AgentEvent[] = [];

export function useAgentEvents(agentId: string | null | undefined) {
  return useQuery({
    queryKey: eventKeys.byAgent(agentId ?? ""),
    queryFn: async () => {
      const data = await eventsApi.listAgentEvents(agentId ?? "");
      return data.events ?? EMPTY_EVENTS;
    },
    enabled: Boolean(agentId),
    staleTime: 30_000,
  });
}

export function useAgentEventCounts(agentIds: readonly string[]) {
  const queries = useQueries({
    queries: agentIds.map((agentId) => ({
      queryKey: eventKeys.byAgent(agentId),
      queryFn: async () => {
        const data = await eventsApi.listAgentEvents(agentId);
        return data.events ?? EMPTY_EVENTS;
      },
      enabled: Boolean(agentId),
      staleTime: 30_000,
    })),
  });

  return useMemo(() => {
    const counts = new Map<string, number>();
    agentIds.forEach((agentId, index) => {
      counts.set(agentId, queries[index]?.data?.length ?? 0);
    });
    return {
      counts,
      isLoading: queries.some((query) => query.isLoading),
    };
  }, [agentIds, queries]);
}

export function useAgentEventsCache(agentId: string) {
  const queryClient = useQueryClient();
  const key = useMemo(() => eventKeys.byAgent(agentId), [agentId]);

  const invalidateEvents = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const patchEvent = useCallback(
    (id: string, patch: Partial<AgentEvent>) => {
      queryClient.setQueryData<AgentEvent[]>(key, (current) =>
        current?.map((event) => (event.id === id ? { ...event, ...patch } : event)),
      );
    },
    [queryClient, key],
  );

  const removeEvent = useCallback(
    (id: string) => {
      queryClient.setQueryData<AgentEvent[]>(key, (current) =>
        current?.filter((event) => event.id !== id),
      );
    },
    [queryClient, key],
  );

  return { invalidateEvents, patchEvent, removeEvent };
}
