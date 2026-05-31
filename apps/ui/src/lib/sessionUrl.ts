import type { Company } from "@/lib/types";
import { entityPath } from "@/lib/entityPath";

/**
 * Build the canonical session URL —
 * `/company/<addr>/sessions/<session>` for launched entities.
 * When the entity isn't known at the call site, falls back to the flat
 * `/sessions/<session>` form which the SessionRedirect resolves.
 */
export function sessionDeepUrl(
  entity: Pick<Company, "id" | "company_address"> | null | undefined,
  _agentId: string | null | undefined,
  sessionId: string,
): string {
  if (entity) {
    return entityPath(entity, "sessions", encodeURIComponent(sessionId));
  }
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * Id-keyed variant — used by callers that hold `companyId: string` and
 * have access to the daemon `entities` array. Resolves through
 * `entityPath` semantics; falls back to the flat session URL when the
 * entity isn't in the array.
 */
export function sessionDeepUrlFromId(
  entities: ReadonlyArray<Pick<Company, "id" | "company_address">>,
  companyId: string | null | undefined,
  agentId: string | null | undefined,
  sessionId: string,
): string {
  if (!companyId || !agentId) return `/sessions/${encodeURIComponent(sessionId)}`;
  const entity = entities.find((e) => e.id === companyId);
  return sessionDeepUrl(entity ?? { id: companyId }, agentId, sessionId);
}
