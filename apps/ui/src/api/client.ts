import { getScopedEntity } from "@/lib/appMode";
import { goExternal } from "@/lib/navigation";
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

export interface ApiRequestOptions extends RequestInit {
  scopedEntity?: string | null | false;
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

/**
 * Probe `/auth/me` to disambiguate why the API returned 401.
 *
 * Tri-state result so we can distinguish "token was actually rejected"
 * (log the user out) from "we couldn't reach the auth probe" (preserve
 * the session — transient network/proxy issues should NOT boot a valid
 * user). The old boolean form treated `false` from a `fetch` throw as
 * authoritative "token bad," which logged users out on every transient
 * proxy hiccup mid-session.
 *
 *   - "valid"   → /auth/me returned 200; the original 401 is a per-request
 *                 permission or server error, not an auth-state issue.
 *   - "invalid" → /auth/me returned 401/403; the token genuinely is bad.
 *                 Only this case clears session + redirects to /login.
 *   - "unknown" → network error, 5xx, or any non-auth response. Treat as
 *                 transient: keep the user signed in and surface the
 *                 original 401 to the caller so it can decide.
 */
type TokenValidity = "valid" | "invalid" | "unknown";

async function tokenStillValid(token: string): Promise<TokenValidity> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.ok) return "valid";
    if (res.status === 401 || res.status === 403) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
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

export async function apiRequest<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const token = getToken();
  const { scopedEntity, ...fetchOptions } = options ?? {};
  const isFormData = typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const companyId = scopedEntity === false ? null : (scopedEntity ?? getScopedEntity());
  if (companyId && !path.startsWith("/auth/")) {
    headers["X-Company"] = companyId;
  }

  const res = await fetch(url, { ...fetchOptions, headers });

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
      // Boot to /login ONLY when /auth/me authoritatively rejects the
      // token (401/403). "valid" means the original 401 is a permission
      // / route-specific error — surface it to the caller and let the
      // session survive. "unknown" means the probe itself failed
      // (network, 5xx, CORS) — preserve the session; user is mid-flight
      // and we shouldn't log them out on a transient proxy hiccup.
      const validity = token ? await tokenStillValid(token) : "invalid";
      if (validity !== "invalid") {
        throw new ApiError(401, "Unauthorized");
      }
      clearSessionData();
      localStorage.removeItem("aeqi_auth_mode");
      // Preserve the user's current location as ?next= so post-auth
      // they return to the page that 401'd, not to /.
      const here = window.location.pathname + window.location.search;
      const skipNext = here === "/" || here.startsWith("/login") || here.startsWith("/signup");
      goExternal(skipNext ? "/login" : `/login?next=${encodeURIComponent(here)}`);
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
