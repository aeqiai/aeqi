import type { Agent } from "@/lib/types";

/**
 * Resolve a URL-param token to its `Agent` record. The token can be:
 * - the canonical entity_id (post-Phase-4 URLs from the switcher)
 * - the agent_id (legacy URLs / bookmarks pre-Phase-4)
 * - the agent name (very legacy slug URLs)
 *
 * Returns the matching agent, or `null` if no agent matches any of the
 * three. Use this everywhere a route param is converted into an Agent —
 * downstream renderers that crash on `agent.name` references depend on
 * it returning a real record, not undefined.
 */
export function findAgentByAnyId(agents: Agent[], token: string): Agent | undefined {
  if (!token) return undefined;
  return (
    agents.find((a) => a.id === token) ??
    agents.find((a) => a.entity_id === token) ??
    agents.find((a) => a.name === token)
  );
}
