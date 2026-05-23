import { useQuery } from "@tanstack/react-query";
import * as agentsApi from "@/api/agents";
import type { Agent } from "@/lib/types";
import { agentKeys } from "./keys";

const EMPTY_AGENTS: Agent[] = [];

export function useAgentsQuery(scopedEntity?: string | null) {
  return useQuery({
    queryKey: agentKeys.directory(scopedEntity),
    queryFn: () => agentsApi.listAgentDirectory(scopedEntity),
    staleTime: 30_000,
  });
}

export function useAgents(scopedEntity?: string | null) {
  return useAgentsQuery(scopedEntity).data ?? EMPTY_AGENTS;
}
