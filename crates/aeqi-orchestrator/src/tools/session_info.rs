//! `session.info` — read-only runtime self-inspection for agents.
//!
//! This tool gives an agent a canonical way to answer questions like
//! "which session am I running in?", "which transport delivered this turn?",
//! and "which channels are bound to me?" without spelunking SQLite paths.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;
use serde_json::json;
use std::sync::Arc;

use crate::agent_registry::AgentRegistry;
use crate::channel_registry::ChannelStore;

pub struct SessionInfoTool {
    agent_registry: Arc<AgentRegistry>,
    calling_agent_id: String,
    current_session_id: String,
    current_transport: Option<String>,
}

impl SessionInfoTool {
    pub fn new(
        agent_registry: Arc<AgentRegistry>,
        calling_agent_id: String,
        current_session_id: String,
        current_transport: Option<String>,
    ) -> Self {
        Self {
            agent_registry,
            calling_agent_id,
            current_session_id,
            current_transport,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct ChannelKeyInfo {
    channel_key: String,
    transport: String,
    agent_id: String,
    transport_peer_id: String,
}

#[derive(Debug, Serialize)]
struct AgentInfo {
    id: String,
    name: String,
    entity_id: Option<String>,
    workdir: Option<String>,
    can_self_delegate: bool,
    can_ask_director: bool,
}

#[derive(Debug, Serialize)]
struct AllowedChatInfo {
    chat_id: String,
    reply_allowed: bool,
}

#[derive(Debug, Serialize)]
struct ChannelInfo {
    id: String,
    kind: String,
    enabled: bool,
    allowed_chats: Vec<AllowedChatInfo>,
}

#[derive(Debug, Serialize)]
struct ChannelMatch {
    id: String,
    kind: String,
    enabled: bool,
}

#[derive(Debug, Serialize)]
struct ChannelSessionInfo {
    #[serde(flatten)]
    channel: ChannelKeyInfo,
    session_id: String,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct CurrentSessionInfo {
    id: String,
    transport: Option<String>,
    transport_peer_id: Option<String>,
    channel_key: Option<String>,
    current_channel: Option<ChannelKeyInfo>,
    matching_channels: Vec<ChannelMatch>,
}

#[derive(Debug, Serialize)]
struct SessionInfoData {
    agent: Option<AgentInfo>,
    session: CurrentSessionInfo,
    channels: Vec<ChannelInfo>,
    channel_sessions: Vec<ChannelSessionInfo>,
}

fn channel_key_parts(channel_key: &str) -> ChannelKeyInfo {
    let mut parts = channel_key.splitn(3, ':');
    ChannelKeyInfo {
        channel_key: channel_key.to_string(),
        transport: parts.next().unwrap_or("unknown").to_string(),
        agent_id: parts.next().unwrap_or("").to_string(),
        transport_peer_id: parts.next().unwrap_or("").to_string(),
    }
}

#[async_trait]
impl Tool for SessionInfoTool {
    async fn execute(&self, _args: serde_json::Value) -> Result<ToolResult> {
        let agent = self.agent_registry.get(&self.calling_agent_id).await?;
        let channel_store = ChannelStore::new(self.agent_registry.db());
        let channels = channel_store.list_for_agent(&self.calling_agent_id).await?;
        let channel_sessions = self
            .agent_registry
            .list_channel_sessions(&self.calling_agent_id)
            .await?;
        let current_channel_key = self
            .agent_registry
            .get_channel_key_for_session(&self.current_session_id)
            .await?;

        let channel_data: Vec<_> = channels
            .iter()
            .map(|ch| ChannelInfo {
                id: ch.id.clone(),
                kind: ch.kind.as_str().to_string(),
                enabled: ch.enabled,
                allowed_chats: ch
                    .allowed_chats
                    .iter()
                    .map(|entry| AllowedChatInfo {
                        chat_id: entry.chat_id.clone(),
                        reply_allowed: entry.reply_allowed,
                    })
                    .collect(),
            })
            .collect();

        let channel_session_data: Vec<_> = channel_sessions
            .iter()
            .map(|(channel_key, session_id, created_at)| ChannelSessionInfo {
                channel: channel_key_parts(channel_key),
                session_id: session_id.clone(),
                created_at: created_at.clone(),
            })
            .collect();

        let current_channel = current_channel_key.as_deref().map(channel_key_parts);

        let configured_transport = current_channel
            .as_ref()
            .map(|ch| ch.transport.as_str())
            .filter(|s| !s.is_empty() && *s != "unknown")
            .map(str::to_string)
            .or_else(|| self.current_transport.clone());

        let current_peer = current_channel
            .as_ref()
            .map(|ch| ch.transport_peer_id.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let matching_channels: Vec<_> = channels
            .iter()
            .filter(|ch| {
                configured_transport
                    .as_deref()
                    .map(|t| ch.kind.as_str() == t)
                    .unwrap_or(false)
            })
            .map(|ch| ChannelMatch {
                id: ch.id.clone(),
                kind: ch.kind.as_str().to_string(),
                enabled: ch.enabled,
            })
            .collect();

        let data = SessionInfoData {
            agent: agent.map(|a| AgentInfo {
                id: a.id,
                name: a.name,
                entity_id: a.entity_id,
                workdir: a.workdir,
                can_self_delegate: a.can_self_delegate,
                can_ask_director: a.can_ask_director,
            }),
            session: CurrentSessionInfo {
                id: self.current_session_id.clone(),
                transport: configured_transport,
                transport_peer_id: current_peer,
                channel_key: current_channel_key,
                current_channel,
                matching_channels,
            },
            channels: channel_data,
            channel_sessions: channel_session_data,
        };

        let output = serde_json::to_string_pretty(&data)?;
        Ok(ToolResult::success(output).with_data(serde_json::to_value(data)?))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "session.info".to_string(),
            description: "Read-only self-inspection for the current agent session. Returns the \
                          current session id, transport, channel-session binding, agent metadata, \
                          enabled channels, and allowed chat/contact metadata. Does not expose \
                          credentials or tokens."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
            }),
        }
    }

    fn name(&self) -> &str {
        "session.info"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }

    fn produces_context(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use crate::channel_registry::{AllowedChat, ChannelConfig, NewChannel, TelegramConfig};

    #[tokio::test]
    async fn session_info_reports_telegram_channel_binding_without_db_access() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Arc::new(AgentRegistry::open(dir.path()).unwrap());
        let agent = registry.spawn("Luca Eich", None, None).await.unwrap();
        let channel_store = ChannelStore::new(registry.db());
        let channel = channel_store
            .create(&NewChannel {
                agent_id: agent.id.clone(),
                config: ChannelConfig::Telegram(TelegramConfig::default()),
            })
            .await
            .unwrap();
        channel_store
            .set_allowed_chats(&channel.id, &[AllowedChat::allow("7822194320")])
            .await
            .unwrap();

        let channel_key = format!("telegram:{}:7822194320", agent.id);
        let session_id = registry
            .get_or_create_channel_session(&channel_key, &agent.id)
            .await
            .unwrap();

        let tool = SessionInfoTool::new(
            registry,
            agent.id.clone(),
            session_id.clone(),
            Some("telegram".to_string()),
        );
        let result = tool.execute(json!({})).await.unwrap();

        assert!(!result.is_error);
        assert_eq!(result.data["session"]["id"], session_id);
        assert_eq!(result.data["session"]["transport"], "telegram");
        assert_eq!(result.data["session"]["transport_peer_id"], "7822194320");
        assert_eq!(result.data["session"]["channel_key"], channel_key);
        assert_eq!(
            result.data["session"]["current_channel"]["transport_peer_id"],
            "7822194320"
        );
        assert_eq!(result.data["channels"][0]["id"], channel.id);
        assert_eq!(result.data["channels"][0]["kind"], "telegram");
        assert_eq!(
            result.data["channels"][0]["allowed_chats"][0]["chat_id"],
            "7822194320"
        );
        assert_eq!(
            result.data["channel_sessions"][0]["channel_key"],
            channel_key
        );
    }
}
