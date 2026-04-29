import { useQuery } from "@tanstack/react-query";
import * as agentsApi from "@/api/agents";
import type { Agent } from "@/lib/types";
import { agentKeys } from "./keys";

const EMPTY_AGENTS: Agent[] = [];

export function useAgentsQuery() {
  return useQuery({
    queryKey: agentKeys.directory,
    queryFn: agentsApi.listAgentDirectory,
    staleTime: 30_000,
  });
}

export function useAgents() {
  return useAgentsQuery().data ?? EMPTY_AGENTS;
}
