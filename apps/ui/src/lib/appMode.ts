export type AppMode = "runtime" | "platform";

export function getStoredAppMode(): AppMode | null {
  const value = localStorage.getItem("aeqi_app_mode");
  return value === "runtime" || value === "platform" ? value : null;
}

export function isPlatformAppMode(mode: AppMode | null | undefined): mode is "platform" {
  return mode === "platform";
}

type CachedTrust = {
  id: string;
  trust_address?: string | null;
};

function readCachedTrusts(): CachedTrust[] {
  try {
    const raw = localStorage.getItem("aeqi_daemon_entities");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedTrust[]) : [];
  } catch {
    return [];
  }
}

function resolveTrustAddress(trustAddress: string): string | null {
  const trusts = readCachedTrusts();
  const match =
    trusts.find((entity) => entity.trust_address === trustAddress) ??
    trusts.find((entity) => entity.id === trustAddress);
  return match?.id ?? null;
}

/**
 * Resolve the routing key (`X-Trust` header / WS `?root=`) for the current
 * URL. The canonical shell is `/trust/:trustAddress/...`; user-scope routes
 * (`/account`, `/launch`, `/sessions/:id`, …) return "" so the caller falls
 * back to the cached active entity.
 *
 * The URL slug after `/trust/` is the trust address in the browser route,
 * while the backend proxy expects the canonical trust id. The hydrated trust
 * cache carries both, so resolve the slug to the canonical id when possible
 * and fall back to the slug only when the cache has not loaded yet.
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
