//! Drive / files routes. See also the IPC handlers in
//! `aeqi-orchestrator/src/ipc/files.rs` which do the actual work.
//!
//! Namespaced under `/drive` to avoid colliding with `/agents/:id/files`,
//! which is reserved for the agent's markdown identity files.

use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::Engine as _;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agents/{id}/drive", get(list_files).post(upload_file))
        .route("/drive/{fid}", get(download_file).delete(delete_file))
}

async fn list_files(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "files_list",
        serde_json::json!({"agent_id": id}),
    )
    .await
}

/// JSON body: `{ name, mime?, content_b64 }`. The frontend reads the File,
/// base64-encodes it, and posts it. 25 MiB cap is enforced server-side.
async fn upload_file(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["agent_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "files_upload", params).await
}

/// Download — returns the raw bytes with the original name + mime type.
/// We decode the base64 the IPC handler returns so the browser gets real
/// bytes, not a JSON-wrapped blob.
async fn download_file(
    State(state): State<AppState>,
    scope: Scope,
    Path(fid): Path<String>,
) -> Response {
    let mut params = serde_json::json!({"id": fid});
    if let Some(s) = scope.as_ref() {
        params["allowed_roots"] = serde_json::json!(s.roots);
    }
    let result = state.ipc.cmd_with("files_read", params).await;
    let resp = match result {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };
    if !resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let status = match resp.get("error").and_then(|v| v.as_str()) {
            Some("forbidden") => StatusCode::FORBIDDEN,
            Some("not found") => StatusCode::NOT_FOUND,
            _ => StatusCode::BAD_REQUEST,
        };
        return (status, Json(resp)).into_response();
    }
    let content_b64 = resp
        .get("content_b64")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let bytes = match base64::engine::general_purpose::STANDARD.decode(content_b64) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"ok": false, "error": format!("decode: {e}")})),
            )
                .into_response();
        }
    };
    let meta = resp.get("file").cloned().unwrap_or(serde_json::Value::Null);
    let name = meta.get("name").and_then(|v| v.as_str()).unwrap_or("file");
    let mime = meta
        .get("mime")
        .and_then(|v| v.as_str())
        .unwrap_or("application/octet-stream");
    // Inline disposition — browser decides whether to render or download.
    let disposition = format!("inline; filename=\"{}\"", name.replace('"', ""));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, mime.to_string()),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        Bytes::from(bytes),
    )
        .into_response()
}

async fn delete_file(
    State(state): State<AppState>,
    scope: Scope,
    Path(fid): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "files_delete",
        serde_json::json!({"id": fid}),
    )
    .await
}
