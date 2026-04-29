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
 * URL. The canonical shell is `/c/:entityId/...`; user-scope routes
 * (`/me`, `/economy`, `/start`, `/sessions/:id`, …) return "" so the
 * caller falls back to the cached active entity.
 */
export function getScopedEntity(): string {
  const path = window.location.pathname;
  const match = path.match(/^\/c\/([^/]+)/);
  if (match) return decodeURIComponent(match[1]);

  const stored = localStorage.getItem("aeqi_entity");
  return stored ?? "";
}
