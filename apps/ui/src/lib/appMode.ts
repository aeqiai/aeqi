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
 * URL. The canonical shell is `/:entityId/...`; this function resolves the
 * active entity from the URL or the cached `aeqi_entity` value.
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
      const found = agents.find((a) => a.id === urlSegment);
      if (found) {
        return found.entity_id || found.id;
      }
    }
  }

  let stored = localStorage.getItem("aeqi_entity");
  if (stored && NON_AGENT_ROUTES.has(stored)) {
    localStorage.removeItem("aeqi_entity");
    stored = null;
  }
  if (stored) return stored;

  return urlSegment;
}

const NON_AGENT_ROUTES = new Set([
  "account",
  "blueprints",
  "economy",
  "login",
  "signup",
  "waitlist",
  "verify",
  "auth",
  "reset-password",
  "new",
  "profile",
  "sessions",
  "start",
  "agents",
  "company",
  "crm",
  "drive",
  "events",
  "governance",
  "ideas",
  "integrations",
  "metrics",
  "ownership",
  "plan",
  "projects",
  "quests",
  "settings",
  "tools",
  "treasury",
]);
