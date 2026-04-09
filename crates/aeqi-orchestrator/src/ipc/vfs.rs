//! VFS (virtual filesystem) IPC handlers.

use super::tenancy::is_allowed;

pub async fn handle_vfs_list(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let path = request.get("path").and_then(|v| v.as_str()).unwrap_or("/");
    let vfs_denied = if allowed.is_some() {
        let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        match segs.as_slice() {
            ["agents", name, ..] | ["companies", name, ..] => !is_allowed(allowed, name),
            _ => false,
        }
    } else {
        false
    };
    if vfs_denied {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let vfs = crate::vfs::VfsTree::with_direct_deps(
        ctx.agent_registry.clone(),
        ctx.session_store.clone(),
    );
    match vfs.list(path).await {
        Ok(mut resp) => {
            if allowed.is_some() {
                resp.nodes.retain(|n| {
                    let p_segs: Vec<&str> = n.path.split('/').filter(|s| !s.is_empty()).collect();
                    match p_segs.as_slice() {
                        ["agents", name, ..] | ["companies", name, ..] => is_allowed(allowed, name),
                        _ => true,
                    }
                });
            }
            serde_json::to_value(resp).unwrap_or_else(|_| serde_json::json!({"ok": false}))
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_vfs_read(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let path = request.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let vfs_denied = if allowed.is_some() && !path.is_empty() {
        let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        match segs.as_slice() {
            ["agents", name, ..] | ["companies", name, ..] => !is_allowed(allowed, name),
            _ => false,
        }
    } else {
        false
    };
    if path.is_empty() {
        return serde_json::json!({"ok": false, "error": "path required"});
    }
    if vfs_denied {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let vfs = crate::vfs::VfsTree::with_direct_deps(
        ctx.agent_registry.clone(),
        ctx.session_store.clone(),
    );
    match vfs.read(path).await {
        Ok(resp) => serde_json::to_value(resp).unwrap_or_else(|_| serde_json::json!({"ok": false})),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_vfs_search(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let query = request.get("query").and_then(|v| v.as_str()).unwrap_or("");
    if query.is_empty() {
        return serde_json::json!({"ok": false, "error": "query required"});
    }

    let vfs = crate::vfs::VfsTree::with_direct_deps(
        ctx.agent_registry.clone(),
        ctx.session_store.clone(),
    );
    match vfs.search(query).await {
        Ok(mut resp) => {
            if allowed.is_some() {
                resp.results.retain(|r| {
                    let p_segs: Vec<&str> = r.path.split('/').filter(|s| !s.is_empty()).collect();
                    match p_segs.as_slice() {
                        ["agents", name, ..] | ["companies", name, ..] => is_allowed(allowed, name),
                        _ => true,
                    }
                });
            }
            serde_json::to_value(resp).unwrap_or_else(|_| serde_json::json!({"ok": false}))
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
