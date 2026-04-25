//! Channels IPC handlers.
//!
//! Channels are typed connector config (telegram/discord/slack/whatsapp)
//! tied to an agent. Access is gated by the same tenancy walk used for
//! every other agent-scoped resource.
//!
//! T1.9.1 — Move B.4: `channels.create` accepts a `token` field in the
//! payload (alongside `kind` and other config). The handler writes the
//! token directly to the credentials substrate as
//! `(scope_kind=channel, scope_id=<channel_id>, provider=<kind>,
//! name=<field_name>)`, then saves the channel row with a config blob
//! that has no token field. The UI input shape is unchanged.

use std::sync::Arc;

use aeqi_core::credentials::{CredentialInsert, CredentialStore, ScopeKind};

use super::request_field;
use super::tenancy::check_agent_access;
use crate::channel_registry::{
    AllowedChat, ChannelConfig, ChannelError, ChannelKind, ChannelStore, NewChannel,
};

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
///
/// T1.9.1 — Move B.4: token-shaped fields in the inbound `config` JSON
/// (`token`, `bot_token`, `app_token`, `access_token`, `verify_token`)
/// are siphoned off before the row is saved and written to the
/// credentials substrate after the row is committed. The saved
/// `channels.config` blob never carries a secret.
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
    let Some(mut config_value) = request.get("config").cloned() else {
        return serde_json::json!({"ok": false, "error": "config required"});
    };

    // Discriminant lookup so we know which fields are token-shaped for
    // this kind. Mirrors `channel_credential_migration::token_fields_for`.
    let kind_str = config_value
        .get("kind")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let Some(kind_str) = kind_str else {
        return serde_json::json!({"ok": false, "error": "config.kind required"});
    };
    let token_fields: &'static [&'static str] = match kind_str.as_str() {
        "telegram" => &["token"],
        "slack" => &["bot_token", "app_token"],
        "discord" => &["token"],
        "whatsapp" => &["access_token", "verify_token"],
        _ => &[],
    };
    let mut pending_tokens: Vec<(&'static str, String)> = Vec::new();
    if let Some(obj) = config_value.as_object_mut() {
        for &field in token_fields {
            if let Some(serde_json::Value::String(s)) = obj.remove(field)
                && !s.is_empty()
            {
                pending_tokens.push((field, s));
            }
        }
    }

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
    let channel = match store(ctx).create(&new).await {
        Ok(channel) => channel,
        Err(ChannelError::Conflict { kind }) => {
            return serde_json::json!({
                "ok": false,
                "code": "conflict",
                "kind": kind.as_str(),
                "error": format!("a {} channel already exists for this agent — disconnect it first", kind.as_str()),
            });
        }
        Err(ChannelError::Storage(e)) => {
            return serde_json::json!({"ok": false, "error": e.to_string()});
        }
    };

    // Write the harvested tokens into the credentials substrate. We do
    // this AFTER the channel row insert so the credential is keyed on
    // the freshly-allocated channel_id. Failures here roll back the
    // channel row to avoid leaving an unusable gateway in place.
    if !pending_tokens.is_empty() {
        if let Some(creds) = ctx.credentials.as_ref() {
            if let Err(e) =
                write_channel_tokens(creds, &channel.id, &kind_str, pending_tokens).await
            {
                let _ = store(ctx).delete(&channel.id).await;
                return serde_json::json!({
                    "ok": false,
                    "error": format!("failed to persist channel credentials: {e}"),
                });
            }
        } else {
            // No substrate handle on this CommandContext (test path or
            // misconfigured daemon) — the row exists but the token
            // didn't land. Roll back the row so the operator can retry.
            let _ = store(ctx).delete(&channel.id).await;
            return serde_json::json!({
                "ok": false,
                "error": "credentials substrate unavailable — cannot persist channel token",
            });
        }
    }

    if let Some(spawner) = ctx.channel_spawner.as_ref() {
        spawner.spawn(channel.clone());
    }
    serde_json::json!({"ok": true, "channel": channel})
}

/// Write a list of `(field_name, plaintext)` pairs into the credentials
/// substrate keyed on the freshly-saved channel id. Used by Move B.4 so
/// the IPC handler doesn't grow a closure-shaped match on `ChannelKind`.
async fn write_channel_tokens(
    credentials: &CredentialStore,
    channel_id: &str,
    kind: &str,
    tokens: Vec<(&'static str, String)>,
) -> anyhow::Result<()> {
    // Validate the kind string is a known channel kind so we don't write
    // a row that the gateway-side resolver will never look up.
    if ChannelKind::parse(kind).is_none() {
        anyhow::bail!("unknown channel kind: {kind}");
    }
    for (field, value) in tokens {
        credentials
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Channel,
                scope_id: channel_id.to_string(),
                provider: kind.to_string(),
                name: field.to_string(),
                lifecycle_kind: "static_secret".to_string(),
                plaintext_blob: value.into_bytes(),
                metadata: serde_json::json!({"source": "channel_ipc_create"}),
                expires_at: None,
            })
            .await?;
    }
    Ok(())
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

/// `channels_set_allowed_chats { id, chat_ids: [...] }` → `{ ok, channel }`
///
/// Replaces the full allowed_chats set for the channel. Empty list = no
/// whitelist (all chats allowed). Tenancy derived from the row.
///
/// Wire format for `chat_ids` accepts both shapes:
/// - **Typed**: `[{ "chat_id": "...", "reply_allowed": true|false }, ...]`
/// - **Legacy**: `["chat_id", ...]` — every entry is treated as
///   `reply_allowed=true` (the historical "ingest = act" semantics).
///
/// The split between inbound (always allowed when whitelisted) and outbound
/// (gated by `reply_allowed`) lets operators mark a contact as read-only:
/// the agent can read the conversation but its reply tools refuse to send.
pub async fn handle_channels_set_allowed_chats(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id required"});
    };
    let chats: Vec<AllowedChat> = match request.get("chat_ids") {
        Some(serde_json::Value::Array(arr)) => {
            let mut out = Vec::with_capacity(arr.len());
            for v in arr {
                match v {
                    serde_json::Value::String(s) => out.push(AllowedChat::allow(s.clone())),
                    serde_json::Value::Number(n) => out.push(AllowedChat::allow(n.to_string())),
                    serde_json::Value::Object(_) => {
                        match serde_json::from_value::<AllowedChat>(v.clone()) {
                            Ok(a) => out.push(a),
                            Err(e) => {
                                return serde_json::json!({
                                    "ok": false,
                                    "error": format!("invalid allowed-chat entry: {e}")
                                });
                            }
                        }
                    }
                    _ => {
                        return serde_json::json!({
                            "ok": false,
                            "error": "chat_ids entries must be string or object"
                        });
                    }
                }
            }
            out
        }
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
    if let Err(e) = store.set_allowed_chats(id, &chats).await {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }
    match store.get_by_id(id).await {
        Ok(Some(c)) => serde_json::json!({"ok": true, "updated": true, "channel": c}),
        Ok(None) => serde_json::json!({"ok": false, "error": "vanished after update"}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
