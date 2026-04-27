import { useDaemonStore } from "@/store/daemon";

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
 * URL. Every agent is addressable at `/:agentId/...`, but the platform
 * proxies to a runtime by the tree's root — hosting topology lives at the
 * root, not at every node. So the URL segment identifies the *target*
 * agent (passed separately as `agent_id` in payloads) and this function
 * produces the *routing key* by walking that segment up the parent chain.
 *
 * Falls back to the cached `aeqi_entity` (kept in sync by AppLayout) when
 * the agent store hasn't loaded yet, and finally to the raw URL segment
 * for cold-start with nothing cached.
 *
 * Migration: reads the old `aeqi_root` key once on first call, writes
 * `aeqi_entity`, then removes the old key so no stale data persists.
 */
export function getScopedEntity(): string {
  const path = window.location.pathname;
  const segments = path.split("/").filter(Boolean);
  const urlSegment =
    segments.length > 0 && !NON_AGENT_ROUTES.has(segments[0])
      ? decodeURIComponent(segments[0])
      : "";

  if (urlSegment) {
    const { agents } = useDaemonStore.getState();
    if (agents.length > 0) {
      const byId = new Map(agents.map((a) => [a.id, a] as const));
      const byName = new Map(agents.map((a) => [a.name, a] as const));
      let current = byId.get(urlSegment) || byName.get(urlSegment);
      for (let i = 0; i < 20 && current; i++) {
        if (!current.parent_id) return current.id;
        current = byId.get(current.parent_id);
      }
    }
  }

  // Migrate legacy key on first read.
  const legacy = localStorage.getItem("aeqi_root");
  if (legacy) {
    localStorage.setItem("aeqi_entity", legacy);
    localStorage.removeItem("aeqi_root");
  }

  let stored = localStorage.getItem("aeqi_entity");
  if (!stored) {
    const olderLegacy = localStorage.getItem("aeqi_company");
    if (olderLegacy) {
      localStorage.setItem("aeqi_entity", olderLegacy);
      localStorage.removeItem("aeqi_company");
      stored = olderLegacy;
    }
  }
  if (stored && NON_AGENT_ROUTES.has(stored)) {
    localStorage.removeItem("aeqi_entity");
    stored = null;
  }
  if (stored) return stored;

  return urlSegment;
}

const NON_AGENT_ROUTES = new Set([
  "login",
  "signup",
  "waitlist",
  "verify",
  "auth",
  "reset-password",
  "new",
  "profile",
  "templates",
  "agents",
  "drive",
]);
