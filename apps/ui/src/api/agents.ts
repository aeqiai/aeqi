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
  entitiesData: { roots?: Array<Record<string, unknown>> } | null | undefined,
  agentsData: AgentsResponse | null | undefined,
): Agent[] {
  const rootAgents: Agent[] = Array.isArray(entitiesData?.roots)
    ? entitiesData.roots.map((root) => {
        const entityId = typeof root.id === "string" ? root.id : "";
        const agentId = typeof root.agent_id === "string" ? root.agent_id : entityId;
        return {
          id: agentId,
          name: typeof root.name === "string" ? root.name : "",
          status: root.running === true ? "running" : "stopped",
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
