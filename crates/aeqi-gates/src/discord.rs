use aeqi_core::traits::{Channel, IncomingMessage, OutgoingMessage};
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{error, info};

const DISCORD_API: &str = "https://discord.com/api/v10";

/// Discord Bot channel using HTTP API (no gateway/websocket for simplicity).
/// Polls for new messages at a configurable interval.
pub struct DiscordChannel {
    client: Client,
    token: String,
    channel_ids: Vec<String>,
    shutdown: tokio::sync::watch::Sender<bool>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
}

impl DiscordChannel {
    pub fn new(token: String, channel_ids: Vec<String>) -> Self {
        let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
        Self {
            client: Client::new(),
            token,
            channel_ids,
            shutdown,
            shutdown_rx,
        }
    }
}

#[derive(Deserialize)]
struct DiscordMessage {
    id: String,
    channel_id: String,
    content: String,
    author: DiscordUser,
}

#[derive(Deserialize)]
struct DiscordUser {
    id: String,
    username: String,
    bot: Option<bool>,
}

#[async_trait]
impl Channel for DiscordChannel {
    async fn start(&self) -> Result<mpsc::Receiver<IncomingMessage>> {
        let (tx, rx) = mpsc::channel(100);
        let client = self.client.clone();
        let token = self.token.clone();
        let channel_ids = self.channel_ids.clone();
        let mut shutdown_rx = self.shutdown_rx.clone();

        tokio::spawn(async move {
            let mut last_message_ids: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            let mut backoff_secs: u64 = 5;
            const MAX_BACKOFF_SECS: u64 = 60;
            info!("Discord polling started");

            loop {
                if *shutdown_rx.borrow() {
                    break;
                }

                let mut had_error = false;
                for channel_id in &channel_ids {
                    let mut url = reqwest::Url::parse(&format!(
                        "{}/channels/{}/messages",
                        DISCORD_API, channel_id
                    ))
                    .expect("valid Discord API URL");
                    url.query_pairs_mut().append_pair("limit", "10");
                    if let Some(after) = last_message_ids.get(channel_id) {
                        url.query_pairs_mut().append_pair("after", after.as_str());
                    }
                    let mut req = client
                        .get(url)
                        .header("Authorization", format!("Bot {}", token));

                    match req.send().await {
                        Ok(response) => {
                            if let Ok(messages) = response.json::<Vec<DiscordMessage>>().await {
                                for msg in messages.iter().rev() {
                                    if msg.author.bot.unwrap_or(false) {
                                        continue;
                                    }

                                    last_message_ids.insert(channel_id.clone(), msg.id.clone());

                                    let incoming = IncomingMessage {
                                        channel: "discord".to_string(),
                                        sender: msg.author.username.clone(),
                                        text: msg.content.clone(),
                                        metadata: serde_json::json!({
                                            "channel_id": msg.channel_id,
                                            "message_id": msg.id,
                                            "author_id": msg.author.id,
                                        }),
                                    };

                                    if tx.send(incoming).await.is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            error!(error = %e, channel = %channel_id, backoff_secs, "Discord polling error");
                            had_error = true;
                        }
                    }
                }

                if had_error {
                    backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                } else {
                    backoff_secs = 5;
                }

                tokio::select! {
                    _ = shutdown_rx.changed() => break,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => {},
                }
            }
            info!("Discord polling stopped");
        });

        Ok(rx)
    }

    async fn send(&self, message: OutgoingMessage) -> Result<()> {
        let channel_id = message
            .metadata
            .get("channel_id")
            .and_then(|v| v.as_str())
            .context("missing channel_id in metadata")?;

        let url = format!("{}/channels/{}/messages", DISCORD_API, channel_id);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bot {}", self.token))
            .json(&serde_json::json!({
                "content": message.text,
            }))
            .send()
            .await
            .context("failed to send Discord message")?;

        if !response.status().is_success() {
            let body = response.text().await?;
            anyhow::bail!("Discord send failed: {body}");
        }

        Ok(())
    }

    fn name(&self) -> &str {
        "discord"
    }

    async fn stop(&self) -> Result<()> {
        let _ = self.shutdown.send(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── DiscordChannel construction ──

    #[test]
    fn channel_name_is_discord() {
        let ch = DiscordChannel::new("tok".to_string(), vec!["123".to_string()]);
        assert_eq!(ch.name(), "discord");
    }

    // ── URL construction ──

    #[test]
    fn messages_url_format() {
        let channel_id = "987654321";
        let url = format!("{}/channels/{}/messages?limit=10", DISCORD_API, channel_id);
        assert_eq!(
            url,
            "https://discord.com/api/v10/channels/987654321/messages?limit=10"
        );
    }

    #[test]
    fn send_message_url_format() {
        let channel_id = "123456789";
        let url = format!("{}/channels/{}/messages", DISCORD_API, channel_id);
        assert_eq!(
            url,
            "https://discord.com/api/v10/channels/123456789/messages"
        );
    }

    // ── DiscordMessage deserialization ──

    #[test]
    fn discord_message_deserializes() {
        let json = r#"{
            "id": "111222333",
            "channel_id": "444555666",
            "content": "Hello Discord!",
            "author": {
                "id": "777888999",
                "username": "testuser",
                "bot": false
            }
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.id, "111222333");
        assert_eq!(msg.channel_id, "444555666");
        assert_eq!(msg.content, "Hello Discord!");
        assert_eq!(msg.author.id, "777888999");
        assert_eq!(msg.author.username, "testuser");
        assert_eq!(msg.author.bot, Some(false));
    }

    #[test]
    fn discord_message_without_bot_field() {
        let json = r#"{
            "id": "1",
            "channel_id": "2",
            "content": "test",
            "author": {
                "id": "3",
                "username": "user"
            }
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();
        assert!(msg.author.bot.is_none());
    }

    #[test]
    fn discord_bot_message_detection() {
        let json = r#"{
            "id": "1",
            "channel_id": "2",
            "content": "bot message",
            "author": {
                "id": "3",
                "username": "webhookbot",
                "bot": true
            }
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();
        // The polling loop does: if msg.author.bot.unwrap_or(false) { continue; }
        assert!(msg.author.bot.unwrap_or(false));
    }

    #[test]
    fn discord_non_bot_message_not_skipped() {
        let json = r#"{
            "id": "1",
            "channel_id": "2",
            "content": "human message",
            "author": {
                "id": "3",
                "username": "human"
            }
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();
        assert!(!msg.author.bot.unwrap_or(false));
    }

    #[test]
    fn discord_message_unicode_content() {
        let json = r#"{
            "id": "1",
            "channel_id": "2",
            "content": "日本語テスト 🚀 Ü",
            "author": {"id": "3", "username": "user"}
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.content, "日本語テスト 🚀 Ü");
    }

    #[test]
    fn discord_message_empty_content() {
        let json = r#"{
            "id": "1",
            "channel_id": "2",
            "content": "",
            "author": {"id": "3", "username": "user"}
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.content, "");
    }

    // ── IncomingMessage construction from DiscordMessage ──

    #[test]
    fn incoming_from_discord_message() {
        let json = r#"{
            "id": "msg_001",
            "channel_id": "ch_001",
            "content": "deploy staging",
            "author": {
                "id": "user_001",
                "username": "devops_lead"
            }
        }"#;
        let msg: DiscordMessage = serde_json::from_str(json).unwrap();

        let incoming = IncomingMessage {
            channel: "discord".to_string(),
            sender: msg.author.username.clone(),
            text: msg.content.clone(),
            metadata: serde_json::json!({
                "channel_id": msg.channel_id,
                "message_id": msg.id,
                "author_id": msg.author.id,
            }),
        };

        assert_eq!(incoming.channel, "discord");
        assert_eq!(incoming.sender, "devops_lead");
        assert_eq!(incoming.text, "deploy staging");
        assert_eq!(incoming.metadata["channel_id"], "ch_001");
        assert_eq!(incoming.metadata["message_id"], "msg_001");
        assert_eq!(incoming.metadata["author_id"], "user_001");
    }

    // ── Outgoing message body ──

    #[test]
    fn outgoing_message_json_body() {
        let text = "Deployment complete!";
        let body = serde_json::json!({
            "content": text,
        });
        assert_eq!(body["content"], "Deployment complete!");
    }

    #[test]
    fn outgoing_message_json_body_with_long_text() {
        // Discord has a 2000 char limit; verify we construct the body correctly
        let text = "a".repeat(2000);
        let body = serde_json::json!({
            "content": text,
        });
        assert_eq!(body["content"].as_str().unwrap().len(), 2000);
    }

    // ── Authorization header format ──

    #[test]
    fn auth_header_format() {
        let token = "MTIzNDU2Nzg5.example.token";
        let header = format!("Bot {}", token);
        assert_eq!(header, "Bot MTIzNDU2Nzg5.example.token");
    }

    // ── Multiple messages deserialization ──

    #[test]
    fn discord_messages_array_deserializes() {
        let json = r#"[
            {
                "id": "1",
                "channel_id": "c1",
                "content": "first",
                "author": {"id": "u1", "username": "alice"}
            },
            {
                "id": "2",
                "channel_id": "c1",
                "content": "second",
                "author": {"id": "u2", "username": "bob", "bot": true}
            },
            {
                "id": "3",
                "channel_id": "c1",
                "content": "third",
                "author": {"id": "u3", "username": "charlie"}
            }
        ]"#;
        let messages: Vec<DiscordMessage> = serde_json::from_str(json).unwrap();
        assert_eq!(messages.len(), 3);

        // Simulate the filtering logic from the polling loop
        let human_messages: Vec<&DiscordMessage> = messages
            .iter()
            .filter(|m| !m.author.bot.unwrap_or(false))
            .collect();
        assert_eq!(human_messages.len(), 2);
        assert_eq!(human_messages[0].author.username, "alice");
        assert_eq!(human_messages[1].author.username, "charlie");
    }

    // ── OutgoingMessage metadata extraction ──

    #[test]
    fn channel_id_extraction_from_metadata() {
        let message = OutgoingMessage {
            channel: "discord".to_string(),
            recipient: String::new(),
            text: "hello".to_string(),
            metadata: serde_json::json!({
                "channel_id": "123456789",
            }),
        };
        let channel_id = message.metadata.get("channel_id").and_then(|v| v.as_str());
        assert_eq!(channel_id, Some("123456789"));
    }

    #[test]
    fn channel_id_missing_from_metadata() {
        let message = OutgoingMessage {
            channel: "discord".to_string(),
            recipient: String::new(),
            text: "hello".to_string(),
            metadata: serde_json::json!({}),
        };
        let channel_id = message.metadata.get("channel_id").and_then(|v| v.as_str());
        assert!(channel_id.is_none());
    }

    #[test]
    fn channel_id_wrong_type_in_metadata() {
        let message = OutgoingMessage {
            channel: "discord".to_string(),
            recipient: String::new(),
            text: "hello".to_string(),
            metadata: serde_json::json!({
                "channel_id": 12345,
            }),
        };
        let channel_id = message.metadata.get("channel_id").and_then(|v| v.as_str());
        // as_str() returns None for integer values
        assert!(channel_id.is_none());
    }
}
