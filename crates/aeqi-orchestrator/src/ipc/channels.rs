//! Channels IPC handlers.
//!
//! Channels are typed connector config (telegram/discord/slack/whatsapp)
//! tied to an agent. Access is gated by the same tenancy walk used for
//! every other agent-scoped resource.

use std::sync::Arc;

use super::request_field;
use super::tenancy::check_agent_access;
use crate::channel_registry::{ChannelConfig, ChannelError, ChannelStore, NewChannel};

fn store(ctx: &super::CommandContext) -> Arc<ChannelStore> {
    Arc::new(ChannelStore::new(ctx.agent_registry.db()))
}

/// `channels_list { agent_id }` → `{ ok, channels: [...] }`
pub async fn handle_channels_list(
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
    match store(ctx).list_for_agent(agent_id).await {
        Ok(channels) => serde_json::json!({"ok": true, "channels": channels}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `channels_upsert { agent_id, config: ChannelConfig }`
///   → `{ ok, channel }` on success
///   → `{ ok: false, code: "conflict", error }` if the agent already has a
///      channel of this kind. Callers must delete the existing row first; the
///      silent-replace that used to happen here masked bugs where the UI sent
///      stale/wrong config and silently overwrote a working connection.
///
/// The `channels_upsert` name is kept for wire compatibility with existing
/// clients, but the semantics are now strict-create.
pub async fn handle_channels_upsert(
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
    let Some(config_value) = request.get("config").cloned() else {
        return serde_json::json!({"ok": false, "error": "config required"});
    };
    let config: ChannelConfig = match serde_json::from_value(config_value) {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({
                "ok": false,
                "error": format!("invalid channel config: {e}")
            });
        }
    };
    let new = NewChannel {
        agent_id: agent_id.to_string(),
        config,
    };
    match store(ctx).create(&new).await {
        Ok(channel) => {
            if let Some(spawner) = ctx.channel_spawner.as_ref() {
                spawner.spawn(channel.clone());
            }
            serde_json::json!({"ok": true, "channel": channel})
        }
        Err(ChannelError::Conflict { kind }) => serde_json::json!({
            "ok": false,
            "code": "conflict",
            "kind": kind.as_str(),
            "error": format!("a {} channel already exists for this agent — disconnect it first", kind.as_str()),
        }),
        Err(ChannelError::Storage(e)) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `channels_delete { id }` → `{ ok, deleted: bool }`
///
/// Tenancy is derived from the channel row's actual owner — never trust a
/// caller-supplied agent_id on destructive ops, or tenant A can delete tenant
/// B's channel by sending `{id: B's-channel-id, agent_id: A's-agent}`.
pub async fn handle_channels_delete(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let store = store(ctx);
    let channel = match store.get_by_id(id).await {
        // 404 and forbidden look the same on the wire — don't leak which
        // channel ids exist via response differentiation.
        Ok(None) => return serde_json::json!({"ok": true, "deleted": false}),
        Ok(Some(c)) => c,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    if !check_agent_access(&ctx.agent_registry, allowed, &channel.agent_id).await {
        return serde_json::json!({"ok": false, "error": "forbidden"});
    }
    match store.delete(id).await {
        Ok(deleted) => serde_json::json!({"ok": true, "deleted": deleted}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `channels_set_enabled { id, enabled }` → `{ ok }`
///
/// Tenancy is derived from the channel row — see `handle_channels_delete`.
pub async fn handle_channels_set_enabled(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let enabled = request
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let store = store(ctx);
    let channel = match store.get_by_id(id).await {
        Ok(None) => return serde_json::json!({"ok": true, "updated": false}),
        Ok(Some(c)) => c,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    if !check_agent_access(&ctx.agent_registry, allowed, &channel.agent_id).await {
        return serde_json::json!({"ok": false, "error": "forbidden"});
    }
    match store.set_enabled(id, enabled).await {
        Ok(updated) => serde_json::json!({"ok": true, "updated": updated}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `channels_baileys_status { id }` → `{ ok, status }` for the WhatsApp
/// Baileys pairing flow. Returns `{ ok, status: null }` if the channel is
/// not currently spawned (e.g., disabled, daemon restarting). Tenancy is
/// derived from the row.
pub async fn handle_channels_baileys_status(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let store = store(ctx);
    let channel = match store.get_by_id(id).await {
        Ok(None) => return serde_json::json!({"ok": true, "status": null}),
        Ok(Some(c)) => c,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    if !check_agent_access(&ctx.agent_registry, allowed, &channel.agent_id).await {
        return serde_json::json!({"ok": true, "status": null});
    }
    match aeqi_gates::whatsapp_baileys::lookup_status(id).await {
        Some(handle) => {
            let snapshot = handle.read().await.clone();
            serde_json::json!({"ok": true, "status": snapshot})
        }
        None => serde_json::json!({"ok": true, "status": null}),
    }
}

/// `channels_baileys_logout { id }` → `{ ok, logged_out: bool }`
///
/// Forces a WhatsApp Baileys channel to disconnect and wipe its auth
/// state on disk. The user will need to re-scan a QR to reconnect. The
/// channel row itself is left intact.
pub async fn handle_channels_baileys_logout(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let store = store(ctx);
    let channel = match store.get_by_id(id).await {
        Ok(None) => return serde_json::json!({"ok": true, "logged_out": false}),
        Ok(Some(c)) => c,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    if !check_agent_access(&ctx.agent_registry, allowed, &channel.agent_id).await {
        return serde_json::json!({"ok": true, "logged_out": false});
    }
    match aeqi_gates::whatsapp_baileys::logout_channel(id).await {
        Ok(did) => serde_json::json!({"ok": true, "logged_out": did}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `channels_set_allowed_chats { id, chat_ids: [string] }` → `{ ok, channel }`
///
/// Replaces the full allowed_chats set for the channel. Empty list = no
/// whitelist (all chats allowed). Tenancy derived from the row.
pub async fn handle_channels_set_allowed_chats(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let chat_ids: Vec<String> = match request.get("chat_ids") {
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .collect(),
        None => {
            return serde_json::json!({"ok": false, "error": "chat_ids required"});
        }
        _ => {
            return serde_json::json!({"ok": false, "error": "chat_ids must be array"});
        }
    };
    let store = store(ctx);
    // Match the 404/forbidden collapse used by delete/set_enabled — do not
    // let the response shape reveal whether the id exists to a caller who
    // isn't scoped to it (id-enumeration oracle).
    let channel = match store.get_by_id(id).await {
        Ok(None) => return serde_json::json!({"ok": true, "updated": false}),
        Ok(Some(c)) => c,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    if !check_agent_access(&ctx.agent_registry, allowed, &channel.agent_id).await {
        return serde_json::json!({"ok": true, "updated": false});
    }
    if let Err(e) = store.set_allowed_chats(id, &chat_ids).await {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }
    match store.get_by_id(id).await {
        Ok(Some(c)) => serde_json::json!({"ok": true, "updated": true, "channel": c}),
        Ok(None) => serde_json::json!({"ok": false, "error": "vanished after update"}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
