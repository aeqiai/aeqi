use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::auth::Claims;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/templates", get(list_templates))
        .route("/templates/spawn", post(spawn_template))
        // Literal `/templates/default` must register before the
        // `{slug}` capture so axum routes the literal first.
        .route("/templates/default", get(default_template))
        .route("/templates/{slug}", get(template_detail))
}

async fn list_templates(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_templates",
        serde_json::json!({}),
    )
    .await
}

/// Resolves to the configured default Blueprint (`[blueprints] default`
/// in `aeqi.toml`). Used by `/start` when the user hasn't picked one.
async fn default_template(State(state): State<AppState>, scope: Scope) -> Response {
    let slug = state.default_blueprint_slug.clone();
    ipc_proxy(
        state,
        scope.as_ref(),
        "template_detail",
        serde_json::json!({"slug": slug}),
    )
    .await
}

async fn template_detail(
    State(state): State<AppState>,
    scope: Scope,
    Path(slug): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "template_detail",
        serde_json::json!({"slug": slug}),
    )
    .await
}

/// Spawn a Blueprint into a fresh root agent.
///
/// In addition to the daemon IPC, this route owns the account-side
/// policy: gate the spawn behind the user's free-trial slot (or paid
/// plan), then link the resulting root to the user's `user_access` row
/// and flip `free_company_used_at` if this was the trial spawn.
///
/// When auth mode is `none` (dev/local), all gating is bypassed —
/// there is no account record to consult.
async fn spawn_template(
    State(state): State<AppState>,
    scope: Scope,
    req: axum::extract::Request,
) -> Response {
    let claims = req.extensions().get::<Claims>().cloned();
    let body: serde_json::Value = match axum::body::to_bytes(req.into_body(), 1_048_576).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    };

    let acting_user_id = claims
        .as_ref()
        .and_then(|c| c.user_id.as_deref())
        .map(|s| s.to_string());

    // Trial-slot gate (only enforced when accounts mode is on AND we
    // resolved a user from the JWT — proxy/scope tokens don't carry one
    // and shouldn't be billed).
    if let (Some(accounts), Some(user_id)) = (&state.accounts, acting_user_id.as_deref()) {
        let paid = accounts.user_has_paid_plan(user_id).unwrap_or(false);
        let trial_used = accounts
            .get_user_by_id(user_id)
            .ok()
            .flatten()
            .and_then(|u| u.free_company_used_at)
            .is_some();
        if !paid && trial_used {
            return (
                StatusCode::PAYMENT_REQUIRED,
                Json(serde_json::json!({
                    "ok": false,
                    "code": "trial_used",
                    "error": "Your free trial company has already been launched. Subscribe to spawn another.",
                })),
            )
                .into_response();
        }
    }

    // Inject scope so the daemon can filter — mirrors what ipc_proxy
    // does internally.
    let mut params = body;
    if let Some(scope_ref) = scope.as_ref() {
        if !params.is_object() {
            params = serde_json::json!({});
        }
        params["allowed_roots"] = serde_json::json!(scope_ref.roots);
    }

    let resp = match state.ipc.cmd_with("spawn_template", params).await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    let succeeded = resp.get("ok") == Some(&serde_json::Value::Bool(true));

    // Link the spawned root to the user + consume trial slot. Best-effort
    // post-process: failures are logged but do not unwind the spawn — the
    // root is real either way; reconciliation belongs to a separate pass.
    if let (Some(accounts), Some(user_id)) = (&state.accounts, acting_user_id.as_deref())
        && succeeded
    {
        if let Some(root_id) = resp.get("root_agent_id").and_then(|v| v.as_str())
            && let Err(err) = accounts.add_director(user_id, root_id)
        {
            tracing::warn!(
                user_id,
                root_id,
                "spawn_template: failed to link root to user: {err}"
            );
        }
        if let Err(err) = accounts.mark_free_company_used(user_id) {
            tracing::warn!(
                user_id,
                "spawn_template: failed to mark free trial slot used: {err}"
            );
        }
    }

    Json(resp).into_response()
}
