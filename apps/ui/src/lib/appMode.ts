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
  // Skip known root-level routes that are NOT root agent names.
  const rootRoutes = new Set([
    "login",
    "signup",
    "waitlist",
    "verify",
    "auth",
    "reset-password",
    "new",
  ]);
  if (segments.length > 0 && !rootRoutes.has(segments[0])) {
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
  return stored || "";
}
