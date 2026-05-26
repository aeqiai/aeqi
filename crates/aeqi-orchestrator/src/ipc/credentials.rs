//! Credentials IPC handlers.
//!
//! Surfaces a thin write/upsert path for the platform's OAuth app
//! callbacks (Path B). The platform exchanges the authorization code for
//! tokens server-side, then ships the bootstrapped row to the per-tenant
//! runtime over the platform→runtime IPC HTTP boundary; the runtime
//! forwards the call to this IPC verb so the credential lands in the
//! same SQLite store the daemon's pack tools read at runtime.
//!
//! Tenancy is enforced by scope: agent rows verify the agent's owning
//! entity against the caller's allowed roots; trust rows verify the scope id
//! itself is in those roots.

use aeqi_core::credentials::{CredentialInsert, CredentialKey, CredentialUpdate, ScopeKind};

use super::request_field;
use super::tenancy::{check_agent_access, is_allowed};

/// `credentials_ingest {scope_kind, scope_id, provider, name, lifecycle_kind,
///   plaintext_blob_json, metadata, expires_at}` →
/// `{ok, credential_id}` on success.
///
/// Idempotent: if a row already exists at
/// `(scope_kind, scope_id, provider, name)` it is updated
/// in place (so a re-consent flow refreshes tokens cleanly without
/// needing a separate disconnect step).
///
/// Field shapes:
/// * `plaintext_blob_json` — JSON value the lifecycle's `validate` will
///   accept on read. For `oauth2` this is `{access_token, refresh_token,
///   token_type, scope}`.
/// * `metadata` — JSON object stored alongside the row. For `oauth2`
///   it carries `provider_kind`, `token_url`, `client_id`,
///   `client_secret`, `scopes`, `redirect_uri`, `expires_at`.
/// * `expires_at` — RFC3339 string or null.
pub async fn handle_credentials_ingest(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let scope_kind_str = request_field(request, "scope_kind").unwrap_or("agent");
    let Some(scope_kind) = ScopeKind::parse(scope_kind_str) else {
        return serde_json::json!({"ok": false, "error": "invalid scope_kind"});
    };
    let Some(scope_id) = request_field(request, "scope_id") else {
        return serde_json::json!({"ok": false, "error": "scope_id required"});
    };
    let Some(provider) = request_field(request, "provider") else {
        return serde_json::json!({"ok": false, "error": "provider required"});
    };
    let Some(name) = request_field(request, "name") else {
        return serde_json::json!({"ok": false, "error": "name required"});
    };
    let lifecycle_kind = request_field(request, "lifecycle_kind").unwrap_or("oauth2");

    match &scope_kind {
        ScopeKind::Agent => {
            if !check_agent_access(&ctx.agent_registry, allowed, scope_id).await {
                return serde_json::json!({"ok": false, "error": "forbidden"});
            }
        }
        ScopeKind::Trust => {
            if !is_allowed(allowed, scope_id) {
                return serde_json::json!({"ok": false, "error": "forbidden"});
            }
        }
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "only scope_kind=agent or trust supported"
            });
        }
    }

    // Plaintext blob comes in as JSON; serialise to bytes so we hand the
    // exact wire shape to the lifecycle's `validate`.
    let Some(plaintext_value) = request.get("plaintext_blob_json").cloned() else {
        return serde_json::json!({"ok": false, "error": "plaintext_blob_json required"});
    };
    let plaintext_blob = match serde_json::to_vec(&plaintext_value) {
        Ok(b) => b,
        Err(e) => {
            return serde_json::json!({"ok": false, "error": format!("blob serialise failed: {e}")});
        }
    };
    let metadata = request
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let expires_at = request
        .get("expires_at")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc));

    let Some(credentials) = ctx.credentials.as_ref() else {
        return serde_json::json!({"ok": false, "error": "credentials substrate unavailable"});
    };

    // Upsert: find by (scope, provider, name) → update OR insert fresh.
    let key = CredentialKey {
        scope_kind: scope_kind.clone(),
        scope_id: scope_id.to_string(),
        provider: provider.to_string(),
        name: name.to_string(),
    };
    let existing = match credentials.find(&key).await {
        Ok(row) => row,
        Err(e) => return serde_json::json!({"ok": false, "error": format!("find failed: {e}")}),
    };
    if let Some(row) = existing {
        let upd = CredentialUpdate {
            plaintext_blob: Some(plaintext_blob),
            metadata: Some(metadata),
            expires_at: Some(expires_at),
            bump_last_refreshed: true,
            bump_last_used: false,
        };
        if let Err(e) = credentials.update(&row.id, upd).await {
            return serde_json::json!({"ok": false, "error": format!("update failed: {e}")});
        }
        return serde_json::json!({"ok": true, "credential_id": row.id, "updated": true});
    }

    let ins = CredentialInsert {
        scope_kind,
        scope_id: scope_id.to_string(),
        provider: provider.to_string(),
        name: name.to_string(),
        lifecycle_kind: lifecycle_kind.to_string(),
        plaintext_blob,
        metadata,
        expires_at,
    };
    match credentials.insert(ins).await {
        Ok(id) => serde_json::json!({"ok": true, "credential_id": id, "updated": false}),
        Err(e) => serde_json::json!({"ok": false, "error": format!("insert failed: {e}")}),
    }
}
