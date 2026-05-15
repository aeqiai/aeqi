import { apiRequest } from "@/api/client";
import { getScopedEntity } from "@/lib/appMode";
import type { Agent } from "@/lib/types";

export interface AgentsResponse {
  agents?: Agent[];
}

export function listScopedAgents(params?: { root?: boolean }): Promise<AgentsResponse> {
  return apiRequest<AgentsResponse>(params?.root ? "/agents?root=true" : "/agents");
}

export function buildAgentDirectory(
  _entitiesData: unknown,
  agentsData: AgentsResponse | null | undefined,
  scopeEntityId?: string,
): Agent[] {
  const agents = Array.isArray(agentsData?.agents) ? agentsData.agents : [];
  const byId = new Map<string, Agent>();
  for (const agent of agents) {
    if (!agent.id) continue;
    // Hosted runtimes store agents under their runtime-local tenant UUID,
    // not the platform entity UUID the rest of the UI keys off. Stamp the
    // active scope's entity id so every consumer (`agent.entity_id ===
    // entityId` filters across CompanyPage, EntityAgentsTab,
    // AddParticipantModal, AgentSettingsPage, etc.) lines up with the URL
    // shape. The response is already scope-bound by X-Entity, so every
    // agent in `agents` belongs to `scopeEntityId` by definition.
    const normalised: Agent = scopeEntityId ? { ...agent, entity_id: scopeEntityId } : agent;
    byId.set(agent.id, normalised);
  }
  return Array.from(byId.values());
}

export async function listAgentDirectory(): Promise<Agent[]> {
  const scopeEntityId = getScopedEntity() || undefined;
  const agentsData = await listScopedAgents().catch(() => null);
  return buildAgentDirectory(null, agentsData, scopeEntityId);
}
