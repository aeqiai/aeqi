import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ideasApi from "@/api/ideas";
import type { Idea } from "@/lib/types";
import { ideaKeys } from "./keys";

const EMPTY_IDEAS: Idea[] = [];

export function useAgentIdeas(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ideaKeys.byAgent(agentId ?? ""),
    queryFn: async () => {
      const data = await ideasApi.listIdeas({ agent_id: agentId ?? "" });
      return data.ideas ?? EMPTY_IDEAS;
    },
    enabled: Boolean(agentId),
    staleTime: 30_000,
  });
}

export function useAgentIdeasCache(agentId: string) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ideaKeys.byAgent(agentId), [agentId]);

  const invalidateIdeas = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const patchIdea = useCallback(
    (id: string, patch: Partial<Idea>) => {
      queryClient.setQueryData<Idea[]>(key, (current) =>
        current?.map((idea) => (idea.id === id ? { ...idea, ...patch } : idea)),
      );
    },
    [queryClient, key],
  );

  const addIdea = useCallback(
    (idea: Idea) => {
      queryClient.setQueryData<Idea[]>(key, (current) => {
        const existing = current ?? EMPTY_IDEAS;
        if (existing.some((item) => item.id === idea.id)) {
          return existing.map((item) => (item.id === idea.id ? { ...item, ...idea } : item));
        }
        return [idea, ...existing];
      });
    },
    [queryClient, key],
  );

  const removeIdea = useCallback(
    (id: string) => {
      queryClient.setQueryData<Idea[]>(key, (current) => current?.filter((idea) => idea.id !== id));
    },
    [queryClient, key],
  );

  return { invalidateIdeas, patchIdea, addIdea, removeIdea };
}
