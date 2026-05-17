//! Drive / files IPC handlers.
//!
//! Files are scoped to a single agent. Access is enforced by walking the
//! agent's parent chain and checking against `allowed_roots` (same mechanism
//! used for every other agent-scoped operation).

use super::request_field;
use super::tenancy::check_agent_access;
use crate::file_store;
use base64::Engine as _;

/// `files_list { agent_id }` → `{ ok: true, files: [...] }`
pub async fn handle_files_list(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(agent_id) = request_field(request, "agent_id") else {
        return serde_json::json!({"ok": false, "error": "agent_id required"});
    };
    if !check_agent_access(&ctx.agent_registry, allowed, agent_id).await {
        return serde_json::json!({"ok": false, "error": "forbidden"});
    }
    match ctx.agent_registry.list_files_for_agent(agent_id).await {
        Ok(files) => serde_json::json!({"ok": true, "files": files}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `files_upload { agent_id, name, mime, content_b64, uploaded_by? }`
/// → `{ ok: true, file: {...} }`
///
/// Expects base64-encoded bytes so the IPC channel stays line-delimited JSON.
/// For very large files the web layer will stream directly to disk and call a
/// separate path-registration command, but for MVP everything routes through
/// here.
pub async fn handle_files_upload(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(agent_id) = request_field(request, "agent_id") else {
        return serde_json::json!({"ok": false, "error": "agent_id required"});
    };
    let Some(name) = request_field(request, "name") else {
        return serde_json::json!({"ok": false, "error": "name required"});
    };
    let mime = request_field(request, "mime").unwrap_or("application/octet-stream");
    let uploaded_by = request_field(request, "uploaded_by");
    let Some(content_b64) = request_field(request, "content_b64") else {
        return serde_json::json!({"ok": false, "error": "content_b64 required"});
    };

    if !check_agent_access(&ctx.agent_registry, allowed, agent_id).await {
        return serde_json::json!({"ok": false, "error": "forbidden"});
    }

    let bytes = match base64::engine::general_purpose::STANDARD.decode(content_b64) {
        Ok(b) => b,
        Err(e) => return serde_json::json!({"ok": false, "error": format!("invalid base64: {e}")}),
    };
    if (bytes.len() as u64) > file_store::MAX_FILE_BYTES {
        return serde_json::json!({
            "ok": false,
            "error": format!("file exceeds {}-byte limit", file_store::MAX_FILE_BYTES),
        });
    }

    let id = uuid::Uuid::new_v4().to_string();
    let files_dir = ctx.agent_registry.files_dir();
    let path = match file_store::write_blob(&files_dir, &id, &bytes) {
        Ok(p) => p,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let storage_path = path.to_string_lossy().to_string();

    if let Err(e) = ctx
        .agent_registry
        .create_file(
            &id,
            agent_id,
            name,
            mime,
            bytes.len() as u64,
            &storage_path,
            uploaded_by,
        )
        .await
    {
        // Roll back the blob if metadata write failed.
        let _ = file_store::delete_blob(&files_dir, &id);
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Phase 2.6 of ae-002 — Drive becomes a saved view over Ideas[kind=file].
    // Every upload now mints a companion Idea row pointing at the file blob
    // via `idea.file_id`, so files appear in the Ideas tree alongside notes
    // and goals. The file itself stays in the `files` table (binary storage
    // needs and access patterns differ from Ideas); the Idea row carries
    // hierarchy + tags + search.
    //
    // Failure is non-fatal: the file is already on disk and in the files
    // table. We log and proceed — Drive still works, just without Ideas-tree
    // visibility for this row until a future backfill.
    if let Some(ref idea_store) = ctx.idea_store {
        let idea_content = format!(
            "File: {} ({} bytes, {})",
            name,
            bytes.len(),
            mime
        );
        match idea_store
            .store(name, &idea_content, &["file".to_string()], Some(agent_id))
            .await
        {
            Ok(idea_id) => {
                if let Err(e) = idea_store.set_kind(&idea_id, "file", Some(&id)).await {
                    tracing::warn!(
                        file_id = %id,
                        error = %e,
                        "files_upload: companion Idea created but set_kind failed; will appear as kind=note in tree"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    file_id = %id,
                    error = %e,
                    "files_upload: failed to create companion Idea; file is uploaded but won't appear in Ideas tree until backfill"
                );
            }
        }
    }

    match ctx.agent_registry.get_file(&id).await {
        Ok(Some(meta)) => serde_json::json!({"ok": true, "file": meta}),
        Ok(None) => serde_json::json!({"ok": false, "error": "file vanished after insert"}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `files_read { id }` → `{ ok: true, file: {...}, content_b64: "..." }`
pub async fn handle_files_read(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let meta = match ctx.agent_registry.get_file(id).await {
        Ok(Some(m)) => m,
        Ok(None) => return serde_json::json!({"ok": false, "error": "not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let agent_id = meta.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
    if !check_agent_access(&ctx.agent_registry, allowed, agent_id).await {
        return serde_json::json!({"ok": false, "error": "forbidden"});
    }
    let files_dir = ctx.agent_registry.files_dir();
    match file_store::read_blob(&files_dir, id) {
        Ok(bytes) => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            serde_json::json!({"ok": true, "file": meta, "content_b64": encoded})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `files_delete { id }` → `{ ok: true }`
pub async fn handle_files_delete(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let meta = match ctx.agent_registry.get_file(id).await {
        Ok(Some(m)) => m,
        Ok(None) => return serde_json::json!({"ok": true, "deleted": false}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let agent_id = meta.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
    if !check_agent_access(&ctx.agent_registry, allowed, agent_id).await {
        return serde_json::json!({"ok": false, "error": "forbidden"});
    }
    let files_dir = ctx.agent_registry.files_dir();
    let _ = file_store::delete_blob(&files_dir, id);
    let delete_result = ctx.agent_registry.delete_file(id).await;

    // Phase 2.6 — clean up the companion Idea[kind=file] row so the tree
    // doesn't keep showing a phantom entry after deletion. Best-effort:
    // find the Idea by its `file_id` and delete it. If the lookup fails or
    // no companion exists, log and proceed — the file is gone regardless.
    if let Some(ref idea_store) = ctx.idea_store {
        match idea_store.find_by_file_id(id).await {
            Ok(Some(idea_id)) => {
                if let Err(e) = idea_store.delete(&idea_id).await {
                    tracing::warn!(
                        file_id = %id,
                        idea_id = %idea_id,
                        error = %e,
                        "files_delete: blob deleted but companion Idea delete failed"
                    );
                }
            }
            Ok(None) => {
                // Pre-Phase-2.6 files have no companion Idea — silent skip.
            }
            Err(e) => {
                tracing::warn!(
                    file_id = %id,
                    error = %e,
                    "files_delete: companion-Idea lookup failed; tree may show phantom entry until next refresh"
                );
            }
        }
    }

    match delete_result {
        Ok(deleted) => serde_json::json!({"ok": true, "deleted": deleted}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
