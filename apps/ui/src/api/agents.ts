import { apiRequest } from "@/api/client";
import { getEntitiesRaw } from "@/api/entities";
import type { Agent } from "@/lib/types";

export interface AgentsResponse {
  agents?: Agent[];
}

export function listScopedAgents(params?: { root?: boolean }): Promise<AgentsResponse> {
  return apiRequest<AgentsResponse>(params?.root ? "/agents?root=true" : "/agents");
}

export function buildAgentDirectory(
  entitiesData: { entities?: Array<Record<string, unknown>> } | null | undefined,
  agentsData: AgentsResponse | null | undefined,
): Agent[] {
  const rootAgents: Agent[] = Array.isArray(entitiesData?.entities)
    ? entitiesData.entities.map((entity) => {
        const entityId = typeof entity.id === "string" ? entity.id : "";
        const agentId = typeof entity.agent_id === "string" ? entity.agent_id : entityId;
        return {
          id: agentId,
          name: typeof entity.display_name === "string" ? entity.display_name : "",
          status: entity.running === true ? "running" : "stopped",
          entity_id: entityId,
        };
      })
    : [];
  const scopedAgents = Array.isArray(agentsData?.agents) ? agentsData.agents : [];

  const byId = new Map<string, Agent>();
  for (const rootAgent of rootAgents) {
    if (rootAgent.id) byId.set(rootAgent.id, rootAgent);
  }
  for (const agent of scopedAgents) {
    if (agent.id) byId.set(agent.id, agent);
  }
  return Array.from(byId.values());
}

export async function listAgentDirectory(): Promise<Agent[]> {
  const entitiesPromise = getEntitiesRaw().catch(() => null);
  const agentsPromise = listScopedAgents().catch(() => null);
  const [entitiesData, agentsData] = await Promise.all([entitiesPromise, agentsPromise]);
  return buildAgentDirectory(entitiesData, agentsData);
}
