/**
 * Build the canonical session URL —
 * `/c/<entity>/agents/<agent>/inbox/<session>`. When entity or agent
 * isn't known at the call site, falls back to the flat
 * `/sessions/<session>` form which the SessionRedirect resolves.
 */
export function sessionDeepUrl(
  entityId: string | null | undefined,
  agentId: string | null | undefined,
  sessionId: string,
): string {
  if (entityId && agentId) {
    return `/c/${encodeURIComponent(entityId)}/agents/${encodeURIComponent(agentId)}/inbox/${encodeURIComponent(sessionId)}`;
  }
  return `/sessions/${encodeURIComponent(sessionId)}`;
}
