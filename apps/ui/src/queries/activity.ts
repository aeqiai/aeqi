import { useQuery } from "@tanstack/react-query";
import * as activityApi from "@/api/activity";
import type { ActivityEntry } from "@/lib/types";
import { activityKeys } from "./keys";

const EMPTY_ACTIVITY: ActivityEntry[] = [];

export function useActivityStreamQuery(params?: { last?: number; root?: string }) {
  return useQuery({
    queryKey: activityKeys.stream(params),
    queryFn: async () => {
      const data = await activityApi.listActivityStream(params);
      return data.events ?? EMPTY_ACTIVITY;
    },
    staleTime: 30_000,
  });
}
