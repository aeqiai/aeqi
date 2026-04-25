/**
 * Typed client for the integrations endpoints (UI1).
 *
 * Mirrors the backend shapes from `crates/aeqi-web/src/routes/integrations.rs`
 * — keep these in sync when fields change. The catalog is fetched once;
 * credentials are fetched per scope and re-fetched after every bootstrap /
 * refresh / disconnect.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("aeqi_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface IntegrationCatalogEntry {
  provider: string;
  name: string;
  label: string;
  description: string;
  lifecycle_kind: string;
  auth_url: string | null;
  token_url: string | null;
  revoke_url: string | null;
  oauth_scopes: string[];
  client_id_env: string | null;
  client_secret_env: string | null;
  per_agent: boolean;
  coming_soon: boolean;
}

export type CredentialStatus =
  | "ok"
  | "missing_credential"
  | "expired"
  | "refresh_failed"
  | "revoked_by_provider"
  | "unsupported_lifecycle"
  | "scope_mismatch"
  | "unresolved_ref";

export interface CredentialView {
  id: string;
  scope_kind: "global" | "agent" | "user" | "channel" | "installation";
  scope_id: string;
  provider: string;
  name: string;
  lifecycle_kind: string;
  status: CredentialStatus;
  account_email: string | null;
  expires_at: string | null;
  created_at: string;
  last_refreshed_at: string | null;
  last_used_at: string | null;
  granted_scopes: string[];
}

export interface BootstrapStartResponse {
  handle: string;
  authorize_url: string;
  expires_at: string;
}

export type BootstrapStatusValue = "pending" | "complete" | "failed" | "expired";

export interface BootstrapStatusResponse {
  handle: string;
  status: BootstrapStatusValue;
  credential_id: string | null;
  error: string | null;
}

// ── API ──────────────────────────────────────────────────────────────────

export const integrationsApi = {
  listIntegrations(): Promise<{ integrations: IntegrationCatalogEntry[] }> {
    return jsonFetch("/integrations");
  },

  listCredentials(scope?: {
    scope_kind: string;
    scope_id: string;
  }): Promise<{ credentials: CredentialView[] }> {
    const qs = scope
      ? `?scope_kind=${encodeURIComponent(scope.scope_kind)}&scope_id=${encodeURIComponent(
          scope.scope_id,
        )}`
      : "";
    return jsonFetch(`/credentials${qs}`);
  },

  bootstrap(body: {
    provider: string;
    scope_kind: string;
    scope_id: string;
    oauth_scopes?: string[];
  }): Promise<BootstrapStartResponse> {
    return jsonFetch("/credentials/bootstrap", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  bootstrapStatus(handle: string): Promise<BootstrapStatusResponse> {
    return jsonFetch(`/credentials/bootstrap/${encodeURIComponent(handle)}`);
  },

  refreshCredential(id: string): Promise<{ ok: boolean; credential: CredentialView }> {
    return jsonFetch(`/credentials/${encodeURIComponent(id)}/refresh`, {
      method: "POST",
    });
  },

  deleteCredential(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

/**
 * Map a credential status to its UI label. Stable strings — UI tests may
 * pin against these so they read like product copy, not enum names.
 */
export function statusLabel(status: CredentialStatus): string {
  switch (status) {
    case "ok":
      return "Connected";
    case "missing_credential":
      return "Not connected";
    case "expired":
      return "Token expired";
    case "refresh_failed":
      return "Refresh failed";
    case "revoked_by_provider":
      return "Revoked by provider";
    case "unsupported_lifecycle":
      return "Unsupported";
    case "scope_mismatch":
      return "Scope mismatch";
    case "unresolved_ref":
      return "Unresolved reference";
  }
}
