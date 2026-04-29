import { useQuery } from "@tanstack/react-query";
import * as questsApi from "@/api/quests";
import type { Quest } from "@/lib/types";
import { questKeys } from "./keys";

const EMPTY_QUESTS: Quest[] = [];

export function useQuestsQuery(params?: { status?: string; root?: string }) {
  return useQuery({
    queryKey: questKeys.list(params),
    queryFn: async () => {
      const data = await questsApi.listQuests(params);
      return data.quests ?? EMPTY_QUESTS;
    },
    staleTime: 30_000,
  });
}

export function useQuests(params?: { status?: string; root?: string }) {
  return useQuestsQuery(params).data ?? EMPTY_QUESTS;
}
