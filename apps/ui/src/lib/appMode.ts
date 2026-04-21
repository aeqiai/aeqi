export type AppMode = "runtime" | "platform";

export function getStoredAppMode(): AppMode | null {
  const value = localStorage.getItem("aeqi_app_mode");
  return value === "runtime" || value === "platform" ? value : null;
}

export function isPlatformAppMode(mode: AppMode | null | undefined): mode is "platform" {
  return mode === "platform";
}

/**
 * Get the active root agent ID (UUID). Reads from the URL path first (/:root/...),
 * falls back to localStorage for contexts outside the router (WebSocket, etc).
 */
export function getScopedRoot(): string {
  // In the browser, extract from URL: /uuid/agents → UUID
  const path = window.location.pathname;
  const segments = path.split("/").filter(Boolean);
  // Skip known root-level routes that are NOT root agent names. Anything
  // the App.tsx router matches as a literal top-level path must be listed
  // here; otherwise the segment is mis-read as a root agent ID, poisoning
  // the X-Root header and the `aeqi_root` cache on every /:non-agent visit.
  if (segments.length > 0 && !NON_AGENT_ROUTES.has(segments[0])) {
    return decodeURIComponent(segments[0]);
  }
  // Fallback for pre-navigation contexts.
  // Migration: read old key if new key doesn't exist.
  let stored = localStorage.getItem("aeqi_root");
  if (!stored) {
    const legacy = localStorage.getItem("aeqi_company");
    if (legacy) {
      localStorage.setItem("aeqi_root", legacy);
      stored = legacy;
    }
  }
  // If a prior bug wrote a non-agent segment (e.g. "profile") into the
  // cache, discard it so we don't keep shipping garbage in X-Root.
  if (stored && NON_AGENT_ROUTES.has(stored)) {
    localStorage.removeItem("aeqi_root");
    stored = null;
  }
  return stored || "";
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
