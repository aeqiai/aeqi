export type AppMode = "runtime" | "platform";

export function getStoredAppMode(): AppMode | null {
  const value = localStorage.getItem("aeqi_app_mode");
  return value === "runtime" || value === "platform" ? value : null;
}

export function isPlatformAppMode(mode: AppMode | null | undefined): mode is "platform" {
  return mode === "platform";
}

/**
 * Get the active company name. Reads from the URL path first (/:company/...),
 * falls back to localStorage for contexts outside the router (WebSocket, etc).
 */
export function getScopedCompany(): string {
  // In the browser, extract from URL: /company-name/agents → "company-name"
  const path = window.location.pathname;
  const segments = path.split("/").filter(Boolean);
  // Skip known root-level routes that are NOT company names.
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
  return localStorage.getItem("aeqi_company") || "";
}
