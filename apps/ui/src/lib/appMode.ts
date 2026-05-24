export type AppMode = "runtime" | "platform";

export function getStoredAppMode(): AppMode | null {
  const value = localStorage.getItem("aeqi_app_mode");
  return value === "runtime" || value === "platform" ? value : null;
}

export function isPlatformAppMode(mode: AppMode | null | undefined): mode is "platform" {
  return mode === "platform";
}

function resolveTrustAddress(trustAddress: string): string | null {
  try {
    const raw = localStorage.getItem("aeqi_daemon_entities");
    if (!raw) return null;
    const entities = JSON.parse(raw) as Array<{ id?: string; trust_address?: string | null }>;
    if (!Array.isArray(entities)) return null;

    const entity = entities.find((item) => item?.trust_address === trustAddress) ?? null;
    if (entity?.id) return entity.id;

    const sameId = entities.find((item) => item?.id === trustAddress) ?? null;
    return sameId?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the routing key (`X-Trust` header / WS `?root=`) for the current
 * URL. The canonical shell is `/trust/:trustAddress/...`; user-scope routes
 * (`/account`, `/launch`, `/sessions/:id`, …) return "" so the caller falls
 * back to the cached active entity.
 *
 * The route slug is the on-chain TRUST address. The backend usually wants the
 * canonical entity id, so resolve the slug through the cached entity list when
 * possible and fall back to the slug only when the cache has not hydrated yet.
 */
export function getScopedEntity(): string {
  const path = window.location.pathname;
  const match = path.match(/^\/trust\/([^/]+)/);
  if (match) {
    const trustAddress = decodeURIComponent(match[1]);
    return resolveTrustAddress(trustAddress) ?? trustAddress;
  }

  const stored = localStorage.getItem("aeqi_entity");
  return stored ?? "";
}
