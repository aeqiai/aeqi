use aeqi_core::traits::{Channel, IncomingMessage, OutgoingMessage};
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{error, info};

const SLACK_API: &str = "https://slack.com/api";

/// Slack Bot channel using Web API.
/// Uses conversations.history polling (Socket Mode requires websockets).
pub struct SlackChannel {
    client: Client,
    token: String,
    channel_ids: Vec<String>,
    shutdown: tokio::sync::watch::Sender<bool>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
}

impl SlackChannel {
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
struct SlackResponse {
    ok: bool,
    messages: Option<Vec<SlackMessage>>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct SlackMessage {
    ts: String,
    user: Option<String>,
    text: Option<String>,
    #[serde(default)]
    bot_id: Option<String>,
    _channel: Option<String>,
}

#[async_trait]
impl Channel for SlackChannel {
    async fn start(&self) -> Result<mpsc::Receiver<IncomingMessage>> {
        let (tx, rx) = mpsc::channel(100);
        let client = self.client.clone();
        let token = self.token.clone();
        let channel_ids = self.channel_ids.clone();
        let mut shutdown_rx = self.shutdown_rx.clone();

        tokio::spawn(async move {
            let mut last_ts: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            let mut backoff_secs: u64 = 5;
            const MAX_BACKOFF_SECS: u64 = 60;
            info!("Slack polling started");

            loop {
                if *shutdown_rx.borrow() {
                    break;
                }

                let mut had_error = false;

                for channel_id in &channel_ids {
                    let mut params = vec![("channel", channel_id.as_str()), ("limit", "10")];

                    let oldest_binding;
                    if let Some(ts) = last_ts.get(channel_id) {
                        oldest_binding = ts.clone();
                        params.push(("oldest", &oldest_binding));
                    }

                    let url = format!("{}/conversations.history", SLACK_API);
                    match client
                        .get(&url)
                        .header("Authorization", format!("Bearer {}", token))
                        .query(&params)
                        .send()
                        .await
                    {
                        Ok(response) => {
                            if let Ok(slack_resp) = response.json::<SlackResponse>().await
                                && slack_resp.ok
                            {
                                for msg in slack_resp.messages.unwrap_or_default().iter().rev() {
                                    if msg.bot_id.is_some() {
                                        continue;
                                    }

                                    last_ts.insert(channel_id.clone(), msg.ts.clone());

                                    if let Some(ref text) = msg.text {
                                        let incoming = IncomingMessage {
                                            channel: "slack".to_string(),
                                            sender: msg
                                                .user
                                                .clone()
                                                .unwrap_or_else(|| "unknown".to_string()),
                                            text: text.clone(),
                                            metadata: serde_json::json!({
                                                "channel_id": channel_id,
                                                "ts": msg.ts,
                                            }),
                                        };

                                        if tx.send(incoming).await.is_err() {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            error!(error = %e, channel = %channel_id, backoff_secs, "Slack polling error");
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
            info!("Slack polling stopped");
        });

        Ok(rx)
    }

    async fn send(&self, message: OutgoingMessage) -> Result<()> {
        let channel_id = message
            .metadata
            .get("channel_id")
            .and_then(|v| v.as_str())
            .context("missing channel_id in metadata")?;

        let url = format!("{}/chat.postMessage", SLACK_API);
        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.token))
            .json(&serde_json::json!({
                "channel": channel_id,
                "text": message.text,
            }))
            .send()
            .await
            .context("failed to send Slack message")?;

        let body: SlackResponse = response.json().await?;
        if !body.ok {
            anyhow::bail!("Slack send failed: {}", body.error.unwrap_or_default());
        }

        Ok(())
    }

    fn name(&self) -> &str {
        "slack"
    }

    async fn stop(&self) -> Result<()> {
        let _ = self.shutdown.send(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── SlackChannel construction ──

    #[test]
    fn channel_name_is_slack() {
        let ch = SlackChannel::new("xoxb-tok".to_string(), vec!["C123".to_string()]);
        assert_eq!(ch.name(), "slack");
    }

    // ── URL construction ──

    #[test]
    fn conversations_history_url() {
        let url = format!("{}/conversations.history", SLACK_API);
        assert_eq!(url, "https://slack.com/api/conversations.history");
    }

    #[test]
    fn chat_post_message_url() {
        let url = format!("{}/chat.postMessage", SLACK_API);
        assert_eq!(url, "https://slack.com/api/chat.postMessage");
    }

    // ── Authorization header format ──

    #[test]
    fn bearer_auth_header_format() {
        let token = "xoxb-123-456-abc";
        let header = format!("Bearer {}", token);
        assert_eq!(header, "Bearer xoxb-123-456-abc");
    }

    // ── SlackResponse deserialization ──

    #[test]
    fn slack_response_ok_with_messages() {
        let json = r#"{
            "ok": true,
            "messages": [
                {
                    "ts": "1234567890.123456",
                    "user": "U123",
                    "text": "Hello Slack!"
                }
            ]
        }"#;
        let resp: SlackResponse = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        let messages = resp.messages.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].ts, "1234567890.123456");
        assert_eq!(messages[0].user.as_deref(), Some("U123"));
        assert_eq!(messages[0].text.as_deref(), Some("Hello Slack!"));
        assert!(messages[0].bot_id.is_none());
    }

    #[test]
    fn slack_response_error() {
        let json = r#"{
            "ok": false,
            "error": "channel_not_found"
        }"#;
        let resp: SlackResponse = serde_json::from_str(json).unwrap();
        assert!(!resp.ok);
        assert_eq!(resp.error.as_deref(), Some("channel_not_found"));
        assert!(resp.messages.is_none());
    }

    #[test]
    fn slack_response_ok_empty_messages() {
        let json = r#"{
            "ok": true,
            "messages": []
        }"#;
        let resp: SlackResponse = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        assert!(resp.messages.unwrap().is_empty());
    }

    // ── SlackMessage deserialization ──

    #[test]
    fn slack_message_with_all_fields() {
        let json = r#"{
            "ts": "1234567890.000001",
            "user": "U_ABC",
            "text": "Test message",
            "bot_id": "B_XYZ"
        }"#;
        let msg: SlackMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.ts, "1234567890.000001");
        assert_eq!(msg.user.as_deref(), Some("U_ABC"));
        assert_eq!(msg.text.as_deref(), Some("Test message"));
        assert_eq!(msg.bot_id.as_deref(), Some("B_XYZ"));
    }

    #[test]
    fn slack_message_minimal() {
        let json = r#"{"ts": "1234.5678"}"#;
        let msg: SlackMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.ts, "1234.5678");
        assert!(msg.user.is_none());
        assert!(msg.text.is_none());
        assert!(msg.bot_id.is_none());
    }

    #[test]
    fn slack_message_unicode_text() {
        let json = r#"{
            "ts": "1.0",
            "text": "Привет 🌍 señor"
        }"#;
        let msg: SlackMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.text.unwrap(), "Привет 🌍 señor");
    }

    #[test]
    fn slack_message_empty_text() {
        let json = r#"{"ts": "1.0", "text": ""}"#;
        let msg: SlackMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.text.as_deref(), Some(""));
    }

    // ── Bot message filtering ──

    #[test]
    fn bot_message_is_filtered() {
        let json = r#"[
            {"ts": "1.0", "user": "U1", "text": "human msg"},
            {"ts": "2.0", "user": "U2", "text": "bot msg", "bot_id": "B1"},
            {"ts": "3.0", "user": "U3", "text": "another human"}
        ]"#;
        let messages: Vec<SlackMessage> = serde_json::from_str(json).unwrap();

        // Simulate the filtering logic from the polling loop
        let human_messages: Vec<&SlackMessage> = messages
            .iter()
            .filter(|m| m.bot_id.is_none())
            .collect();
        assert_eq!(human_messages.len(), 2);
        assert_eq!(human_messages[0].user.as_deref(), Some("U1"));
        assert_eq!(human_messages[1].user.as_deref(), Some("U3"));
    }

    // ── IncomingMessage construction from SlackMessage ──

    #[test]
    fn incoming_from_slack_message() {
        let channel_id = "C_GENERAL";
        let msg_json = r#"{
            "ts": "1700000000.000001",
            "user": "U_DEV",
            "text": "check status"
        }"#;
        let msg: SlackMessage = serde_json::from_str(msg_json).unwrap();

        let incoming = IncomingMessage {
            channel: "slack".to_string(),
            sender: msg.user.clone().unwrap_or_else(|| "unknown".to_string()),
            text: msg.text.clone().unwrap(),
            metadata: serde_json::json!({
                "channel_id": channel_id,
                "ts": msg.ts,
            }),
        };

        assert_eq!(incoming.channel, "slack");
        assert_eq!(incoming.sender, "U_DEV");
        assert_eq!(incoming.text, "check status");
        assert_eq!(incoming.metadata["channel_id"], "C_GENERAL");
        assert_eq!(incoming.metadata["ts"], "1700000000.000001");
    }

    #[test]
    fn incoming_from_slack_message_without_user() {
        let msg_json = r#"{"ts": "1.0", "text": "anonymous"}"#;
        let msg: SlackMessage = serde_json::from_str(msg_json).unwrap();

        let sender = msg.user.clone().unwrap_or_else(|| "unknown".to_string());
        assert_eq!(sender, "unknown");
    }

    #[test]
    fn incoming_from_slack_message_without_text_is_skipped() {
        let msg_json = r#"{"ts": "1.0", "user": "U1"}"#;
        let msg: SlackMessage = serde_json::from_str(msg_json).unwrap();

        // The polling loop only creates IncomingMessage when text is Some
        assert!(msg.text.is_none());
    }

    // ── Outgoing message body ──

    #[test]
    fn outgoing_slack_json_body() {
        let channel_id = "C123";
        let text = "Deployment successful!";
        let body = serde_json::json!({
            "channel": channel_id,
            "text": text,
        });
        assert_eq!(body["channel"], "C123");
        assert_eq!(body["text"], "Deployment successful!");
    }

    // ── OutgoingMessage metadata extraction ──

    #[test]
    fn channel_id_extraction_from_metadata() {
        let message = OutgoingMessage {
            channel: "slack".to_string(),
            recipient: String::new(),
            text: "hello".to_string(),
            metadata: serde_json::json!({
                "channel_id": "C_GENERAL",
            }),
        };
        let channel_id = message
            .metadata
            .get("channel_id")
            .and_then(|v| v.as_str());
        assert_eq!(channel_id, Some("C_GENERAL"));
    }

    #[test]
    fn channel_id_missing_from_metadata() {
        let message = OutgoingMessage {
            channel: "slack".to_string(),
            recipient: String::new(),
            text: "hello".to_string(),
            metadata: serde_json::json!({}),
        };
        let channel_id = message
            .metadata
            .get("channel_id")
            .and_then(|v| v.as_str());
        assert!(channel_id.is_none());
    }

    // ── Multiple responses deserialization ──

    #[test]
    fn slack_response_many_messages() {
        let json = r#"{
            "ok": true,
            "messages": [
                {"ts": "1.0", "user": "U1", "text": "msg 1"},
                {"ts": "2.0", "user": "U2", "text": "msg 2"},
                {"ts": "3.0", "text": "msg 3"},
                {"ts": "4.0", "user": "U4", "text": "msg 4", "bot_id": "B1"},
                {"ts": "5.0"}
            ]
        }"#;
        let resp: SlackResponse = serde_json::from_str(json).unwrap();
        let messages = resp.messages.unwrap();
        assert_eq!(messages.len(), 5);

        // Count messages that would produce IncomingMessages (has text, no bot_id)
        let processable: Vec<&SlackMessage> = messages
            .iter()
            .filter(|m| m.bot_id.is_none() && m.text.is_some())
            .collect();
        assert_eq!(processable.len(), 3);  // msgs 1, 2, 3 (msg 5 has no text)
    }

    // ── Error message formatting ──

    #[test]
    fn slack_error_message_formatting() {
        let error = Some("not_authed".to_string());
        let msg = format!("Slack send failed: {}", error.unwrap_or_default());
        assert_eq!(msg, "Slack send failed: not_authed");
    }

    #[test]
    fn slack_error_message_when_none() {
        let error: Option<String> = None;
        let msg = format!("Slack send failed: {}", error.unwrap_or_default());
        assert_eq!(msg, "Slack send failed: ");
    }
}
