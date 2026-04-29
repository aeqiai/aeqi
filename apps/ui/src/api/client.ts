import { getScopedEntity } from "@/lib/appMode";
import { setRateLimitedUntil } from "@/lib/rateLimit";
import { clearSessionData } from "@/lib/session";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class RateLimitedError extends ApiError {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(429, message);
    this.name = "RateLimitedError";
  }
}

/**
 * Parse RFC 7231 `Retry-After`. The header is either an integer number
 * of seconds (`Retry-After: 30`) or an HTTP-date; the governor crate emits
 * seconds, but we handle both defensively. Returns ms; fallback is 30s.
 */
function parseRetryAfter(header: string | null): number {
  if (!header) return 30_000;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 30_000;
  }
  return 30_000;
}

function getToken(): string | null {
  return localStorage.getItem("aeqi_token");
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const entity = getScopedEntity();
  if (entity && !path.startsWith("/auth/")) {
    headers["X-Entity"] = entity;
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
    setRateLimitedUntil(Date.now() + retryAfterMs);
    throw new RateLimitedError("rate limited", retryAfterMs);
  }

  const body = (await parseResponseBody(res)) as Record<string, unknown> | null;

  if (res.status === 401) {
    // Don't redirect for auth mode check or if mode is "none".
    const authMode = localStorage.getItem("aeqi_auth_mode");
    if (authMode !== "none" && !path.startsWith("/auth/")) {
      clearSessionData();
      localStorage.removeItem("aeqi_auth_mode");
      // Preserve the user's current location as ?next= so post-auth
      // they return to the page that 401'd, not to /.
      const here = window.location.pathname + window.location.search;
      const skipNext = here === "/" || here.startsWith("/login") || here.startsWith("/signup");
      window.location.href = skipNext ? "/login" : `/login?next=${encodeURIComponent(here)}`;
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (res.status === 403 && !path.startsWith("/auth/")) {
    localStorage.removeItem("aeqi_entity");
  }

  if (!res.ok) {
    const message =
      (typeof body?.error === "string" ? body.error : null) ||
      (typeof body?.message === "string" ? body.message : null) ||
      `API error: ${res.statusText}`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}
