import type { Trust } from "@/lib/types";
import { entityPath } from "@/lib/entityPath";

/**
 * Build the canonical session URL —
 * `/trust/<addr>/sessions/<session>` for launched entities.
 * When the entity isn't known at the call site, falls back to the flat
 * `/sessions/<session>` form which the SessionRedirect resolves.
 */
export function sessionDeepUrl(
  entity: Pick<Trust, "id" | "trust_address"> | null | undefined,
  _agentId: string | null | undefined,
  sessionId: string,
): string {
  if (entity) {
    return entityPath(entity, "sessions", encodeURIComponent(sessionId));
  }
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * Id-keyed variant — used by callers that hold `trustId: string` and
 * have access to the daemon `entities` array. Resolves through
 * `entityPath` semantics; falls back to the flat session URL when the
 * entity isn't in the array.
 */
export function sessionDeepUrlFromId(
  entities: ReadonlyArray<Pick<Trust, "id" | "trust_address">>,
  trustId: string | null | undefined,
  agentId: string | null | undefined,
  sessionId: string,
): string {
  if (!trustId || !agentId) return `/sessions/${encodeURIComponent(sessionId)}`;
  const entity = entities.find((e) => e.id === trustId);
  return sessionDeepUrl(entity ?? { id: trustId }, agentId, sessionId);
}
