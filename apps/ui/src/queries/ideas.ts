import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ideasApi from "@/api/ideas";
import type { Idea } from "@/lib/types";
import { ideaKeys } from "./keys";

const EMPTY_IDEAS: Idea[] = [];

export function useVisibleIdeas(enabled = true, scopedEntity?: string | null) {
  return useQuery({
    queryKey: ideaKeys.visible(scopedEntity),
    queryFn: async () => {
      const data = await ideasApi.listIdeas(undefined, scopedEntity);
      return data.ideas ?? EMPTY_IDEAS;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useAgentIdeas(
  agentId: string | null | undefined,
  enabled = true,
  scopedEntity?: string | null,
) {
  return useQuery({
    queryKey: ideaKeys.byAgent(agentId ?? "", scopedEntity),
    queryFn: async () => {
      const data = await ideasApi.listIdeas({ agent_id: agentId ?? "" }, scopedEntity);
      return data.ideas ?? EMPTY_IDEAS;
    },
    enabled: enabled && Boolean(agentId),
    staleTime: 30_000,
  });
}

export function useAgentIdeasCache(agentId: string, scopedEntity?: string | null) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ideaKeys.byAgent(agentId, scopedEntity), [agentId, scopedEntity]);
  const visibleKey = useMemo(() => ideaKeys.visible(scopedEntity), [scopedEntity]);

  const invalidateIdeas = useCallback(() => {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: visibleKey }),
    ]);
  }, [queryClient, key, visibleKey]);

  const patchIdea = useCallback(
    (id: string, patch: Partial<Idea>) => {
      const applyPatch = (current: Idea[] | undefined) =>
        current?.map((idea) => (idea.id === id ? { ...idea, ...patch } : idea));
      queryClient.setQueryData<Idea[]>(key, applyPatch);
      queryClient.setQueryData<Idea[]>(visibleKey, applyPatch);
    },
    [queryClient, key, visibleKey],
  );

  const addIdea = useCallback(
    (idea: Idea) => {
      const addToList = (current: Idea[] | undefined) => {
        const existing = current ?? EMPTY_IDEAS;
        if (existing.some((item) => item.id === idea.id)) {
          return existing.map((item) => (item.id === idea.id ? { ...item, ...idea } : item));
        }
        return [idea, ...existing];
      };
      queryClient.setQueryData<Idea[]>(key, addToList);
      queryClient.setQueryData<Idea[]>(visibleKey, addToList);
    },
    [queryClient, key, visibleKey],
  );

  const removeIdea = useCallback(
    (id: string) => {
      const removeFromList = (current: Idea[] | undefined) =>
        current?.filter((idea) => idea.id !== id);
      queryClient.setQueryData<Idea[]>(key, removeFromList);
      queryClient.setQueryData<Idea[]>(visibleKey, removeFromList);
    },
    [queryClient, key, visibleKey],
  );

  return { invalidateIdeas, patchIdea, addIdea, removeIdea };
}
