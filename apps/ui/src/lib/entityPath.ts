import type { Entity } from "@/lib/types";

/**
 * Canonical URL base for an entity.
 *
 * - On-chain entities (trust_address set): `/trust/<address>`
 * - Pending / off-chain entities:          `/c/<id>`
 *
 * Use this everywhere a link or navigation targets a company entity so
 * the address is consistently the primary URL once registerTRUST lands.
 */
export function entityBasePath(entity: Pick<Entity, "id" | "trust_address">): string {
  if (entity.trust_address) {
    return `/trust/${entity.trust_address.toLowerCase()}`;
  }
  return `/c/${encodeURIComponent(entity.id)}`;
}

/**
 * Full path for an entity + optional sub-path.
 * e.g. entityPath(entity, "overview") → "/trust/0xabc.../overview"
 */
export function entityPath(
  entity: Pick<Entity, "id" | "trust_address">,
  ...segments: string[]
): string {
  const base = entityBasePath(entity);
  if (segments.length === 0) return base;
  return `${base}/${segments.join("/")}`;
}

/**
 * Build a canonical path when the call site only has the entity id (not
 * the full Entity object). Resolves to `/trust/<addr>` when the entities
 * lookup hits a row with `trust_address`; otherwise falls back to
 * `/c/<id>`.
 *
 * Use this in components that hold `entityId: string` and have access to
 * the daemon store's `entities` array. Prefer `entityPath(entity, ...)`
 * when an Entity object is in scope — this helper is the id-keyed
 * alternative.
 */
export function entityPathFromId(
  entities: ReadonlyArray<Pick<Entity, "id" | "trust_address">>,
  id: string,
  ...segments: string[]
): string {
  const entity = entities.find((e) => e.id === id);
  if (entity) return entityPath(entity, ...segments);
  const base = `/c/${encodeURIComponent(id)}`;
  if (segments.length === 0) return base;
  return `${base}/${segments.join("/")}`;
}

/** Same as `entityBasePath` but keyed by id with an entities-array lookup. */
export function entityBasePathFromId(
  entities: ReadonlyArray<Pick<Entity, "id" | "trust_address">>,
  id: string,
): string {
  return entityPathFromId(entities, id);
}
