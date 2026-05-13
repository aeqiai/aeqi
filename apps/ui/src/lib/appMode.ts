export type AppMode = "runtime" | "platform";

export function getStoredAppMode(): AppMode | null {
  const value = localStorage.getItem("aeqi_app_mode");
  return value === "runtime" || value === "platform" ? value : null;
}

export function isPlatformAppMode(mode: AppMode | null | undefined): mode is "platform" {
  return mode === "platform";
}

/**
 * Resolve the routing key (`X-Entity` header / WS `?root=`) for the current
 * URL. The canonical shell is `/trust/:trustAddress/...`; user-scope routes
 * (`/account`, `/launch`, `/sessions/:id`, …) return "" so the
 * caller falls back to the cached active entity.
 *
 * The URL slug after `/trust/` is the on-chain TRUST address (Solana
 * base58), but the platform proxy only accepts entity_id UUIDs as the
 * `X-Entity` header (see `aeqi-platform/src/routes/proxy.rs::extract_entity_id`
 * — "slug fallback chain is gone"). We resolve trust_address → entity_id
 * via the `aeqi_trust_to_entity` mirror the daemon store writes after
 * every `fetchEntities` success. Falling back to the raw slug preserves
 * the pre-mirror behavior — the proxy 404s on the slug, which surfaces
 * a meaningful error in DevTools instead of silent UI emptiness.
 */
export function getScopedEntity(): string {
  const path = window.location.pathname;
  const match = path.match(/^\/trust\/([^/]+)/);
  if (match) {
    const slug = decodeURIComponent(match[1]);
    try {
      const raw = localStorage.getItem("aeqi_trust_to_entity");
      if (raw) {
        const map = JSON.parse(raw) as Record<string, string>;
        const entityId = map[slug];
        if (entityId) return entityId;
      }
    } catch {
      // Bad JSON / quota / private mode — fall through to the raw slug.
    }
    return slug;
  }

  const stored = localStorage.getItem("aeqi_entity");
  return stored ?? "";
}
