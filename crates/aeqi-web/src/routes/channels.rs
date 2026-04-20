//! Channel routes — typed connector config (telegram/discord/slack/whatsapp).
//!
//! Replaces the `channel:*` ideas hack: configs are now first-class rows
//! with schema-per-kind. IPC handlers live in
//! `aeqi-orchestrator/src/ipc/channels.rs`.

use axum::{
    Json, Router,
    extract::{Path, State},
    response::Response,
    routing::{get, patch},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/agents/{id}/channels",
            get(list_channels).post(upsert_channel),
        )
        .route("/channels/{id}", axum::routing::delete(delete_channel))
        .route("/channels/{id}/enabled", patch(set_enabled))
        .route("/channels/{id}/allowed-chats", patch(set_allowed_chats))
        .route("/channels/{id}/baileys-status", get(baileys_status))
        .route(
            "/channels/{id}/baileys-logout",
            axum::routing::post(baileys_logout),
        )
}

async fn list_channels(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "channels_list",
        serde_json::json!({"agent_id": id}),
    )
    .await
}

/// JSON body: `{ config: { kind: "telegram", token: "...", allowed_chats: [] } }`.
/// `config` is a tagged enum — `kind` picks which shape the rest is validated
/// against. On success returns the upserted channel row.
async fn upsert_channel(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["agent_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "channels_upsert", params).await
}

/// `DELETE /channels/:id` — no body. Tenancy is resolved from the row itself
/// by the IPC handler; accepting a caller-supplied agent_id here was a
/// privilege-escalation hole.
async fn delete_channel(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "channels_delete", params).await
}

/// `PATCH /channels/:id/enabled` with body `{ enabled }`. Tenancy resolved
/// from the row.
async fn set_enabled(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let enabled = body
        .get("enabled")
        .cloned()
        .unwrap_or(serde_json::json!(true));
    let params = serde_json::json!({"id": id, "enabled": enabled});
    ipc_proxy(state, scope.as_ref(), "channels_set_enabled", params).await
}

/// `PATCH /channels/:id/allowed-chats` with body `{ chat_ids: [string] }`.
/// Replaces the whitelist. Empty array = no restriction (all chats allowed).
/// Tenancy resolved from the row.
async fn set_allowed_chats(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let chat_ids = body
        .get("chat_ids")
        .cloned()
        .unwrap_or(serde_json::json!([]));
    let params = serde_json::json!({"id": id, "chat_ids": chat_ids});
    ipc_proxy(state, scope.as_ref(), "channels_set_allowed_chats", params).await
}

/// `GET /channels/:id/baileys-status` → `{ ok, status }`. Used by the
/// WhatsApp Baileys pairing UI to poll for the current QR code and
/// connection state.
async fn baileys_status(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "channels_baileys_status", params).await
}

/// `POST /channels/:id/baileys-logout` → `{ ok, logged_out }`. Disconnects
/// the WhatsApp Baileys session and wipes auth state — the user will need
/// to re-scan a QR next time the channel starts.
async fn baileys_logout(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "channels_baileys_logout", params).await
}
