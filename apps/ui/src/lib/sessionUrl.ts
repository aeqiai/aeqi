import type { Entity } from "@/lib/types";
import { entityPath } from "@/lib/entityPath";

/**
 * Build the canonical session URL —
 * `/trust/<addr>/agents/<agent>/inbox/<session>` for on-chain entities,
 * `/c/<entity>/agents/<agent>/inbox/<session>` for pending ones.
 * When entity or agent isn't known at the call site, falls back to the
 * flat `/sessions/<session>` form which the SessionRedirect resolves.
 */
export function sessionDeepUrl(
  entity: Pick<Entity, "id" | "trust_address"> | null | undefined,
  agentId: string | null | undefined,
  sessionId: string,
): string {
  if (entity && agentId) {
    return entityPath(
      entity,
      "agents",
      encodeURIComponent(agentId),
      "inbox",
      encodeURIComponent(sessionId),
    );
  }
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * Id-keyed variant — used by callers that hold `entityId: string` and
 * have access to the daemon `entities` array. Resolves through
 * `entityPath` semantics; falls back to `/c/<id>` when the entity isn't
 * in the array.
 */
export function sessionDeepUrlFromId(
  entities: ReadonlyArray<Pick<Entity, "id" | "trust_address">>,
  entityId: string | null | undefined,
  agentId: string | null | undefined,
  sessionId: string,
): string {
  if (!entityId || !agentId) return `/sessions/${encodeURIComponent(sessionId)}`;
  const entity = entities.find((e) => e.id === entityId);
  return sessionDeepUrl(entity ?? { id: entityId }, agentId, sessionId);
}
