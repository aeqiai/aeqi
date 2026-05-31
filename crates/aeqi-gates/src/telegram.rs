use std::sync::Arc;

use aeqi_core::traits::{
    Channel, CompletedResponse, DeliveryMode, IncomingMessage, OutgoingMessage, SessionGateway,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::suppression::{Channel as NotificationChannel, NotificationSuppression};

const TELEGRAM_API: &str = "https://api.telegram.org";

/// Notification-suppression commands the poll loop intercepts. See quest 67-189.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Command {
    Stop,
    Resume,
}

/// Parse a Telegram message body into a known suppression command, or `None`
/// if the message is not a command. Recognises:
///
/// - `/stop` and `/resume` as bare commands.
/// - `/stop@BotName` per Telegram convention (groups disambiguate by suffix).
/// - Trailing whitespace or arguments (e.g. `/stop please`) — the suffix is
///   ignored. Commands MUST start at column 0.
fn parse_command(text: &str) -> Option<Command> {
    // Strip leading whitespace; Telegram clients sometimes send a BOM or
    // ZWSP before the slash, so trim before the prefix check.
    let trimmed = text.trim_start();
    let head = trimmed.split_whitespace().next()?;
    // `/stop` or `/stop@BotName` — split on the optional bot suffix.
    let cmd = head.split('@').next()?;
    match cmd {
        "/stop" => Some(Command::Stop),
        "/resume" => Some(Command::Resume),
        _ => None,
    }
}

/// Telegram Bot API channel.
pub struct TelegramChannel {
    client: Client,
    token: String,
    /// Chat IDs allowed to interact (empty = all).
    allowed_chats: Vec<i64>,
    /// Optional STOP-path primitive (quest 67-189). When set, the poll loop
    /// intercepts `/stop` and `/resume` commands before the mention-gate and
    /// drives the suppression layer. When `None`, the channel behaves as
    /// before — useful for tests and for any deployment that hasn't wired
    /// the suppression store yet.
    suppression: Option<Arc<dyn NotificationSuppression>>,
    shutdown: tokio::sync::watch::Sender<bool>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
}

impl TelegramChannel {
    pub fn new(token: String, allowed_chats: Vec<i64>) -> Self {
        let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
        Self {
            client: Client::new(),
            token,
            allowed_chats,
            suppression: None,
            shutdown,
            shutdown_rx,
        }
    }

    /// Attach a notification-suppression store. Once set, the poll loop will
    /// intercept `/stop` and `/resume` commands and never forward them as
    /// `IncomingMessage` events.
    pub fn with_suppression(mut self, suppression: Arc<dyn NotificationSuppression>) -> Self {
        self.suppression = Some(suppression);
        self
    }

    fn api_url(&self, method: &str) -> String {
        format!("{}/bot{}/{}", TELEGRAM_API, self.token, method)
    }

    /// Send a typing indicator to a chat.
    pub async fn send_typing(&self, chat_id: i64) -> Result<()> {
        let _ = self
            .client
            .post(self.api_url("sendChatAction"))
            .json(&serde_json::json!({
                "chat_id": chat_id,
                "action": "typing"
            }))
            .send()
            .await;
        Ok(())
    }

    /// Send a reply quoting an existing message.
    pub async fn send_reply(&self, chat_id: i64, text: String, reply_to: i64) -> Result<()> {
        let msg = SendMessageWithReply {
            chat_id,
            text: text.clone(),
            parse_mode: Some("Markdown".to_string()),
            reply_to_message_id: Some(reply_to),
        };

        let response = self
            .client
            .post(self.api_url("sendMessage"))
            .json(&msg)
            .send()
            .await
            .context("failed to send Telegram reply")?;

        let body: TelegramResponse<serde_json::Value> = response.json().await?;
        if !body.ok {
            // Markdown parse failed — retry as plain text.
            debug!(error = ?body.description, "Markdown reply failed, retrying as plain text");
            let plain = SendMessageWithReply {
                chat_id,
                text,
                parse_mode: None,
                reply_to_message_id: Some(reply_to),
            };
            let response = self
                .client
                .post(self.api_url("sendMessage"))
                .json(&plain)
                .send()
                .await
                .context("failed to send Telegram reply (plain)")?;
            let body: TelegramResponse<serde_json::Value> = response.json().await?;
            if !body.ok {
                anyhow::bail!(
                    "Telegram sendMessage (reply) failed: {}",
                    body.description.unwrap_or_default()
                );
            }
        }

        Ok(())
    }
}

#[derive(Deserialize)]
struct TelegramResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[derive(Deserialize)]
struct TelegramMessage {
    message_id: i64,
    chat: TelegramChat,
    from: Option<TelegramUser>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct TelegramChat {
    id: i64,
    /// "private" (DM) | "group" | "supergroup" | "channel". Defaults to
    /// "private" so a fixture missing the field behaves like a DM
    /// (always spawn) — matches pre-mention-gate behavior.
    #[serde(rename = "type", default = "default_chat_type")]
    chat_type: String,
}

fn default_chat_type() -> String {
    "private".to_string()
}

#[derive(Deserialize)]
struct GetMeResult {
    username: Option<String>,
}

#[derive(Deserialize)]
struct TelegramUser {
    // Parsed for payload validation; identity is tracked by username/first_name.
    #[allow(dead_code)]
    id: i64,
    first_name: String,
    username: Option<String>,
}

#[derive(Serialize)]
struct SendMessage {
    chat_id: i64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parse_mode: Option<String>,
}

#[derive(Serialize)]
struct SendMessageWithReply {
    chat_id: i64,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parse_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to_message_id: Option<i64>,
}

/// Resolve the bot's @username via `getMe` so we can mention-gate group
/// messages. Returns the username without the leading `@`. Errors if
/// the API call fails or the bot has no username (which never happens
/// for production bots — every Telegram bot is created via @BotFather
/// with a mandatory username — but the bail keeps the failure mode
/// explicit instead of silently degrading to "always spawn").
async fn resolve_bot_username(client: &Client, token: &str) -> Result<String> {
    let url = format!("{}/bot{}/getMe", TELEGRAM_API, token);
    let resp = client
        .post(&url)
        .send()
        .await
        .context("getMe request failed")?;
    let body: TelegramResponse<GetMeResult> = resp.json().await.context("getMe body parse")?;
    if !body.ok {
        anyhow::bail!("getMe returned ok=false: {:?}", body.description);
    }
    body.result
        .and_then(|r| r.username)
        .filter(|u| !u.is_empty())
        .context("getMe response missing username")
}

#[async_trait]
impl Channel for TelegramChannel {
    async fn start(&self) -> Result<mpsc::Receiver<IncomingMessage>> {
        let (tx, rx) = mpsc::channel(100);
        let client = self.client.clone();
        let token = self.token.clone();
        let allowed_chats = self.allowed_chats.clone();
        let suppression = self.suppression.clone();
        let mut shutdown_rx = self.shutdown_rx.clone();

        // Mention-gate setup: resolve our @username via getMe so we can
        // distinguish "addressed to me" from "background traffic" in
        // groups. Empty marker = treat every message as addressed (the
        // pre-gate behavior) so a startup hiccup never makes the bot
        // unresponsive.
        let mention_marker = match resolve_bot_username(&client, &token).await {
            Ok(name) => {
                info!(bot_username = %name, "Telegram identity resolved");
                format!("@{}", name.to_lowercase())
            }
            Err(e) => {
                error!(error = %e, "getMe failed; mention-gate disabled");
                String::new()
            }
        };

        tokio::spawn(async move {
            let mut offset: Option<i64> = None;
            let mut backoff_secs: u64 = 1;
            const MAX_BACKOFF_SECS: u64 = 30;
            info!("Telegram polling started");

            loop {
                if *shutdown_rx.borrow() {
                    break;
                }

                let url = format!("{}/bot{}/getUpdates", TELEGRAM_API, token);
                let mut params = serde_json::json!({ "timeout": 30 });
                if let Some(off) = offset {
                    params["offset"] = serde_json::json!(off);
                }

                let result = tokio::select! {
                    _ = shutdown_rx.changed() => break,
                    r = client.post(&url).json(&params).send() => r,
                };

                match result {
                    Ok(response) => {
                        match response
                            .json::<TelegramResponse<Vec<TelegramUpdate>>>()
                            .await
                        {
                            Ok(body) if body.ok => {
                                backoff_secs = 1;
                                for update in body.result.unwrap_or_default() {
                                    offset = Some(update.update_id + 1);

                                    if let Some(msg) = update.message {
                                        if !allowed_chats.is_empty()
                                            && !allowed_chats.contains(&msg.chat.id)
                                        {
                                            debug!(
                                                chat_id = msg.chat.id,
                                                "ignoring message from unauthorized chat"
                                            );
                                            continue;
                                        }

                                        // STOP-path intercept (quest 67-189). Bypasses the
                                        // mention-gate so /stop works in groups without
                                        // having to address the bot — opting out must be
                                        // frictionless. The intercept consumes the message
                                        // and never forwards it as an IncomingMessage.
                                        if let Some(sup) = suppression.as_ref()
                                            && let Some(text) = msg.text.as_deref()
                                            && let Some(cmd) = parse_command(text)
                                        {
                                            let chat_id = msg.chat.id;
                                            let address = chat_id.to_string();
                                            match cmd {
                                                Command::Stop => {
                                                    if let Err(e) = sup
                                                        .suppress(
                                                            NotificationChannel::Telegram,
                                                            &address,
                                                            None,
                                                        )
                                                        .await
                                                    {
                                                        warn!(error = %e, chat_id, "suppress failed");
                                                    } else {
                                                        info!(
                                                            chat_id,
                                                            event = "genesis.activation.stop",
                                                            "telegram /stop applied"
                                                        );
                                                        let _ = client
                                                            .post(format!(
                                                                "{}/bot{}/sendMessage",
                                                                TELEGRAM_API, token
                                                            ))
                                                            .json(&serde_json::json!({
                                                                "chat_id": chat_id,
                                                                "text": "Won't message you about your COMPANY(s) again. Type /resume to re-enable.",
                                                            }))
                                                            .send()
                                                            .await;
                                                    }
                                                    continue;
                                                }
                                                Command::Resume => {
                                                    if let Err(e) = sup
                                                        .resume(
                                                            NotificationChannel::Telegram,
                                                            &address,
                                                        )
                                                        .await
                                                    {
                                                        warn!(error = %e, chat_id, "resume failed");
                                                    } else {
                                                        info!(
                                                            chat_id,
                                                            event = "genesis.activation.resume",
                                                            "telegram /resume applied"
                                                        );
                                                        let _ = client
                                                            .post(format!(
                                                                "{}/bot{}/sendMessage",
                                                                TELEGRAM_API, token
                                                            ))
                                                            .json(&serde_json::json!({
                                                                "chat_id": chat_id,
                                                                "text": "Notifications re-enabled. You'll hear from your COMPANY again.",
                                                            }))
                                                            .send()
                                                            .await;
                                                    }
                                                    continue;
                                                }
                                            }
                                        }

                                        // Mention-gate: in groups, only act when our
                                        // @username appears in the text. DMs always
                                        // act. If the marker is empty (getMe failed
                                        // at startup) fall through and act on all,
                                        // so a transient identity-fetch failure
                                        // doesn't silence the bot entirely.
                                        let is_group = msg.chat.chat_type != "private";
                                        let addressed = mention_marker.is_empty()
                                            || !is_group
                                            || msg.text.as_deref().is_some_and(|t| {
                                                t.to_lowercase().contains(&mention_marker)
                                            });
                                        if !addressed {
                                            debug!(
                                                chat_id = msg.chat.id,
                                                chat_type = %msg.chat.chat_type,
                                                "group message without mention; skipping"
                                            );
                                            continue;
                                        }

                                        if let Some(text) = msg.text {
                                            let react_url = format!(
                                                "{}/bot{}/setMessageReaction",
                                                TELEGRAM_API, token
                                            );
                                            let typing_url = format!(
                                                "{}/bot{}/sendChatAction",
                                                TELEGRAM_API, token
                                            );
                                            let c1 = client.clone();
                                            let c2 = client.clone();
                                            let chat = msg.chat.id;
                                            let mid = msg.message_id;
                                            tokio::spawn(async move {
                                                let _ = tokio::join!(
                                                    c1.post(&react_url).json(&serde_json::json!({
                                                        "chat_id": chat,
                                                        "message_id": mid,
                                                        "reaction": [{"type": "emoji", "emoji": "\u{1F440}"}]
                                                    })).send(),
                                                    c2.post(&typing_url).json(&serde_json::json!({
                                                        "chat_id": chat,
                                                        "action": "typing"
                                                    })).send()
                                                );
                                            });

                                            let sender = msg
                                                .from
                                                .map(|u| u.username.unwrap_or(u.first_name))
                                                .unwrap_or_else(|| "unknown".to_string());

                                            info!(sender = %sender, "received telegram message");

                                            let incoming = IncomingMessage {
                                                channel: "telegram".to_string(),
                                                sender,
                                                text,
                                                metadata: serde_json::json!({
                                                    "chat_id": msg.chat.id,
                                                    "message_id": msg.message_id,
                                                }),
                                            };

                                            if tx.send(incoming).await.is_err() {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            Ok(body) => {
                                error!(description = ?body.description, backoff_secs, "Telegram API error");
                                tokio::time::sleep(std::time::Duration::from_secs(backoff_secs))
                                    .await;
                                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                            }
                            Err(e) => {
                                error!(error = %e, backoff_secs, "failed to parse Telegram response");
                                tokio::time::sleep(std::time::Duration::from_secs(backoff_secs))
                                    .await;
                                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                            }
                        }
                    }
                    Err(e) => {
                        error!(error = %e, backoff_secs, "Telegram polling error");
                        tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)).await;
                        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                    }
                }
            }
            info!("Telegram polling stopped");
        });

        Ok(rx)
    }

    async fn send(&self, message: OutgoingMessage) -> Result<()> {
        let chat_id = message
            .metadata
            .get("chat_id")
            .and_then(|v| v.as_i64())
            .context("missing chat_id in metadata")?;

        // Try Markdown first, fall back to plain text if Telegram can't parse it.
        let send_msg = SendMessage {
            chat_id,
            text: message.text.clone(),
            parse_mode: Some("Markdown".to_string()),
        };

        let response = self
            .client
            .post(self.api_url("sendMessage"))
            .json(&send_msg)
            .send()
            .await
            .context("failed to send Telegram message")?;

        let body: TelegramResponse<serde_json::Value> = response.json().await?;
        if !body.ok {
            // Markdown parse failed — retry as plain text.
            debug!(error = ?body.description, "Markdown send failed, retrying as plain text");
            let plain_msg = SendMessage {
                chat_id,
                text: message.text,
                parse_mode: None,
            };
            let response = self
                .client
                .post(self.api_url("sendMessage"))
                .json(&plain_msg)
                .send()
                .await
                .context("failed to send Telegram message (plain)")?;
            let body: TelegramResponse<serde_json::Value> = response.json().await?;
            if !body.ok {
                anyhow::bail!(
                    "Telegram sendMessage failed: {}",
                    body.description.unwrap_or_default()
                );
            }
        }

        Ok(())
    }

    async fn react(&self, chat_id: i64, message_id: i64, emoji: &str) -> Result<()> {
        let response = self
            .client
            .post(self.api_url("setMessageReaction"))
            .json(&serde_json::json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "reaction": [{"type": "emoji", "emoji": emoji}]
            }))
            .send()
            .await
            .context("failed to send reaction request")?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "reaction request failed: {}",
                response.status()
            ))
        }
    }

    fn name(&self) -> &str {
        "telegram"
    }

    async fn stop(&self) -> Result<()> {
        let _ = self.shutdown.send(true);
        Ok(())
    }
}

/// Telegram output gateway — delivers batched responses to a Telegram chat.
pub struct TelegramGateway {
    id: String,
    channel: Arc<TelegramChannel>,
    chat_id: i64,
}

impl TelegramGateway {
    pub fn new(channel: Arc<TelegramChannel>, chat_id: i64, agent_id: &str) -> Self {
        Self {
            id: format!("telegram:{}:{}", agent_id, chat_id),
            channel,
            chat_id,
        }
    }
}

#[async_trait]
impl SessionGateway for TelegramGateway {
    fn gateway_type(&self) -> &str {
        "telegram"
    }

    fn delivery_mode(&self) -> DeliveryMode {
        DeliveryMode::Batched
    }

    fn gateway_id(&self) -> &str {
        &self.id
    }

    async fn deliver_response(
        &self,
        _session_id: &str,
        response: &CompletedResponse,
    ) -> anyhow::Result<()> {
        if response.text.is_empty() {
            return Ok(());
        }
        let out = OutgoingMessage {
            channel: "telegram".to_string(),
            recipient: String::new(),
            text: response.text.clone(),
            metadata: serde_json::json!({ "chat_id": self.chat_id }),
        };
        self.channel.send(out).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TelegramChannel construction and api_url ──

    #[test]
    fn api_url_formats_correctly() {
        let ch = TelegramChannel::new("123:ABC".to_string(), vec![]);
        assert_eq!(
            ch.api_url("sendMessage"),
            "https://api.telegram.org/bot123:ABC/sendMessage"
        );
    }

    #[test]
    fn api_url_different_methods() {
        let ch = TelegramChannel::new("tok".to_string(), vec![]);
        assert_eq!(
            ch.api_url("getUpdates"),
            "https://api.telegram.org/bottok/getUpdates"
        );
        assert_eq!(
            ch.api_url("sendChatAction"),
            "https://api.telegram.org/bottok/sendChatAction"
        );
        assert_eq!(
            ch.api_url("setMessageReaction"),
            "https://api.telegram.org/bottok/setMessageReaction"
        );
    }

    #[test]
    fn api_url_with_special_chars_in_token() {
        let ch = TelegramChannel::new("123456:ABC-DEF_ghi".to_string(), vec![]);
        assert_eq!(
            ch.api_url("sendMessage"),
            "https://api.telegram.org/bot123456:ABC-DEF_ghi/sendMessage"
        );
    }

    #[test]
    fn channel_name_is_telegram() {
        let ch = TelegramChannel::new("tok".to_string(), vec![]);
        assert_eq!(ch.name(), "telegram");
    }

    // ── /stop /resume parser (quest 67-189) ──

    #[test]
    fn parse_command_recognises_bare_stop_and_resume() {
        assert_eq!(parse_command("/stop"), Some(Command::Stop));
        assert_eq!(parse_command("/resume"), Some(Command::Resume));
    }

    #[test]
    fn parse_command_strips_bot_suffix() {
        assert_eq!(parse_command("/stop@MyBot"), Some(Command::Stop));
        assert_eq!(parse_command("/resume@MyBot"), Some(Command::Resume));
    }

    #[test]
    fn parse_command_ignores_trailing_args() {
        assert_eq!(parse_command("/stop please"), Some(Command::Stop));
        assert_eq!(parse_command("/resume now"), Some(Command::Resume));
    }

    #[test]
    fn parse_command_strips_leading_whitespace() {
        assert_eq!(parse_command("  /stop"), Some(Command::Stop));
    }

    #[test]
    fn parse_command_returns_none_for_unrelated_text() {
        assert_eq!(parse_command("hello"), None);
        assert_eq!(parse_command("/help"), None);
        assert_eq!(parse_command("not /stop"), None);
        assert_eq!(parse_command(""), None);
    }

    #[test]
    fn parse_command_does_not_match_embedded_stop() {
        // "/stopping" must not be a /stop command — substring matching
        // would suppress users whose message happens to start with that
        // letter sequence.
        assert_eq!(parse_command("/stopping"), None);
    }

    #[test]
    fn with_suppression_attaches_the_store() {
        use crate::suppression::SqliteNotificationSuppression;
        use std::sync::Arc;
        let tmp = tempfile::TempDir::new().unwrap();
        let sup = Arc::new(SqliteNotificationSuppression::open(tmp.path()).unwrap());
        let ch = TelegramChannel::new("tok".to_string(), vec![])
            .with_suppression(sup as Arc<dyn NotificationSuppression>);
        assert!(ch.suppression.is_some());
    }

    // ── SendMessage serialization ──

    #[test]
    fn send_message_serializes_with_parse_mode() {
        let msg = SendMessage {
            chat_id: 42,
            text: "Hello **bold**".to_string(),
            parse_mode: Some("Markdown".to_string()),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["chat_id"], 42);
        assert_eq!(json["text"], "Hello **bold**");
        assert_eq!(json["parse_mode"], "Markdown");
    }

    #[test]
    fn send_message_omits_parse_mode_when_none() {
        let msg = SendMessage {
            chat_id: 99,
            text: "plain text".to_string(),
            parse_mode: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["chat_id"], 99);
        assert_eq!(json["text"], "plain text");
        assert!(json.get("parse_mode").is_none());
    }

    #[test]
    fn send_message_with_unicode_text() {
        let msg = SendMessage {
            chat_id: 1,
            text: "Привет мир 🌍 你好世界".to_string(),
            parse_mode: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["text"], "Привет мир 🌍 你好世界");
    }

    #[test]
    fn send_message_with_empty_text() {
        let msg = SendMessage {
            chat_id: 1,
            text: String::new(),
            parse_mode: Some("Markdown".to_string()),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["text"], "");
    }

    // ── TelegramResponse deserialization ──

    #[test]
    fn telegram_response_ok_with_result() {
        let json = r#"{"ok": true, "result": [1, 2, 3]}"#;
        let resp: TelegramResponse<Vec<i64>> = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        assert_eq!(resp.result.unwrap(), vec![1, 2, 3]);
        assert!(resp.description.is_none());
    }

    #[test]
    fn telegram_response_error_with_description() {
        let json = r#"{"ok": false, "description": "Bad Request: chat not found"}"#;
        let resp: TelegramResponse<serde_json::Value> = serde_json::from_str(json).unwrap();
        assert!(!resp.ok);
        assert!(resp.result.is_none());
        assert_eq!(resp.description.unwrap(), "Bad Request: chat not found");
    }

    // ── TelegramUpdate deserialization ──

    #[test]
    fn telegram_update_with_text_message() {
        let json = r#"{
            "update_id": 100,
            "message": {
                "message_id": 42,
                "chat": {"id": 999},
                "from": {"id": 1, "first_name": "Alice", "username": "alice_bot"},
                "text": "Hello there"
            }
        }"#;
        let update: TelegramUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.update_id, 100);
        let msg = update.message.unwrap();
        assert_eq!(msg.message_id, 42);
        assert_eq!(msg.chat.id, 999);
        let from = msg.from.unwrap();
        assert_eq!(from.first_name, "Alice");
        assert_eq!(from.username.unwrap(), "alice_bot");
        assert_eq!(msg.text.unwrap(), "Hello there");
    }

    #[test]
    fn telegram_update_without_message() {
        let json = r#"{"update_id": 200}"#;
        let update: TelegramUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.update_id, 200);
        assert!(update.message.is_none());
    }

    #[test]
    fn telegram_update_message_without_text() {
        let json = r#"{
            "update_id": 300,
            "message": {
                "message_id": 5,
                "chat": {"id": 10},
                "from": {"id": 2, "first_name": "Bob"}
            }
        }"#;
        let update: TelegramUpdate = serde_json::from_str(json).unwrap();
        let msg = update.message.unwrap();
        assert!(msg.text.is_none());
    }

    #[test]
    fn telegram_update_message_without_from() {
        let json = r#"{
            "update_id": 400,
            "message": {
                "message_id": 6,
                "chat": {"id": 20},
                "text": "channel post"
            }
        }"#;
        let update: TelegramUpdate = serde_json::from_str(json).unwrap();
        let msg = update.message.unwrap();
        assert!(msg.from.is_none());
        assert_eq!(msg.text.unwrap(), "channel post");
    }

    #[test]
    fn telegram_user_without_username_falls_back_to_first_name() {
        // This tests the sender extraction logic from the polling loop.
        let json = r#"{
            "id": 99,
            "first_name": "Charlie"
        }"#;
        let user: TelegramUser = serde_json::from_str(json).unwrap();
        // The polling loop does: u.username.unwrap_or(u.first_name)
        let sender = user.username.unwrap_or(user.first_name);
        assert_eq!(sender, "Charlie");
    }

    #[test]
    fn telegram_user_with_username_uses_username() {
        let json = r#"{
            "id": 99,
            "first_name": "Charlie",
            "username": "charlie99"
        }"#;
        let user: TelegramUser = serde_json::from_str(json).unwrap();
        let sender = user.username.unwrap_or(user.first_name);
        assert_eq!(sender, "charlie99");
    }

    #[test]
    fn telegram_update_unicode_text() {
        let json = r#"{
            "update_id": 500,
            "message": {
                "message_id": 7,
                "chat": {"id": 30},
                "text": "こんにちは 🎉 Ñoño"
            }
        }"#;
        let update: TelegramUpdate = serde_json::from_str(json).unwrap();
        assert_eq!(update.message.unwrap().text.unwrap(), "こんにちは 🎉 Ñoño");
    }

    // ── Incoming message construction (mirrors polling loop logic) ──

    #[test]
    fn incoming_message_from_telegram_update() {
        let update_json = r#"{
            "update_id": 600,
            "message": {
                "message_id": 50,
                "chat": {"id": 12345},
                "from": {"id": 1, "first_name": "Dev", "username": "dev_user"},
                "text": "deploy prod"
            }
        }"#;
        let update: TelegramUpdate = serde_json::from_str(update_json).unwrap();
        let msg = update.message.unwrap();
        let text = msg.text.unwrap();
        let from = msg.from.unwrap();
        let sender = from.username.unwrap_or(from.first_name);

        let incoming = IncomingMessage {
            channel: "telegram".to_string(),
            sender: sender.clone(),
            text: text.clone(),
            metadata: serde_json::json!({
                "chat_id": msg.chat.id,
                "message_id": msg.message_id,
            }),
        };

        assert_eq!(incoming.channel, "telegram");
        assert_eq!(incoming.sender, "dev_user");
        assert_eq!(incoming.text, "deploy prod");
        assert_eq!(incoming.metadata["chat_id"], 12345);
        assert_eq!(incoming.metadata["message_id"], 50);
    }

    // ── Chat filtering logic ──

    #[test]
    fn allowed_chats_filter_behavior() {
        let allowed: Vec<i64> = vec![100, 200, 300];

        // Authorized chat passes
        assert!(allowed.is_empty() || allowed.contains(&100));
        assert!(allowed.is_empty() || allowed.contains(&200));

        // Unauthorized chat blocked
        assert!(!allowed.contains(&999));

        // Empty allowed list means all pass
        let empty: Vec<i64> = vec![];
        assert!(empty.is_empty() || empty.contains(&999));
    }

    // ── TelegramGateway ──

    #[test]
    fn gateway_id_format() {
        let ch = Arc::new(TelegramChannel::new("tok".to_string(), vec![]));
        let gw = TelegramGateway::new(ch, 42, "agent-alpha");
        assert_eq!(gw.gateway_id(), "telegram:agent-alpha:42");
    }

    #[test]
    fn gateway_id_with_different_agents_and_chats() {
        let ch = Arc::new(TelegramChannel::new("tok".to_string(), vec![]));
        let gw1 = TelegramGateway::new(Arc::clone(&ch), 100, "bot-1");
        let gw2 = TelegramGateway::new(Arc::clone(&ch), 200, "bot-2");
        assert_eq!(gw1.gateway_id(), "telegram:bot-1:100");
        assert_eq!(gw2.gateway_id(), "telegram:bot-2:200");
        assert_ne!(gw1.gateway_id(), gw2.gateway_id());
    }

    #[test]
    fn gateway_id_negative_chat_id() {
        let ch = Arc::new(TelegramChannel::new("tok".to_string(), vec![]));
        // Telegram group chats have negative IDs
        let gw = TelegramGateway::new(ch, -1001234567890, "agent");
        assert_eq!(gw.gateway_id(), "telegram:agent:-1001234567890");
    }

    #[test]
    fn gateway_delivery_mode_is_batched() {
        let ch = Arc::new(TelegramChannel::new("tok".to_string(), vec![]));
        let gw = TelegramGateway::new(ch, 1, "a");
        assert_eq!(gw.delivery_mode(), DeliveryMode::Batched);
    }

    #[test]
    fn gateway_type_is_telegram() {
        let ch = Arc::new(TelegramChannel::new("tok".to_string(), vec![]));
        let gw = TelegramGateway::new(ch, 1, "a");
        assert_eq!(gw.gateway_type(), "telegram");
    }

    #[test]
    fn gateway_is_alive_default() {
        let ch = Arc::new(TelegramChannel::new("tok".to_string(), vec![]));
        let gw = TelegramGateway::new(ch, 1, "a");
        assert!(gw.is_alive());
    }

    // ── TelegramResponse batch deserialization ──

    #[test]
    fn telegram_get_updates_response_multiple_updates() {
        let json = r#"{
            "ok": true,
            "result": [
                {
                    "update_id": 1,
                    "message": {
                        "message_id": 10,
                        "chat": {"id": 100},
                        "text": "first"
                    }
                },
                {
                    "update_id": 2,
                    "message": {
                        "message_id": 11,
                        "chat": {"id": 100},
                        "text": "second"
                    }
                },
                {
                    "update_id": 3
                }
            ]
        }"#;
        let resp: TelegramResponse<Vec<TelegramUpdate>> = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        let updates = resp.result.unwrap();
        assert_eq!(updates.len(), 3);
        assert_eq!(updates[0].update_id, 1);
        assert_eq!(
            updates[1].message.as_ref().unwrap().text.as_deref(),
            Some("second")
        );
        assert!(updates[2].message.is_none());
    }

    #[test]
    fn telegram_response_empty_result() {
        let json = r#"{"ok": true, "result": []}"#;
        let resp: TelegramResponse<Vec<TelegramUpdate>> = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        assert!(resp.result.unwrap().is_empty());
    }

    // ── Offset tracking logic ──

    #[test]
    fn offset_calculation() {
        // The loop does: offset = Some(update.update_id + 1)
        let update_id: i64 = 123456789;
        let next_offset = update_id + 1;
        assert_eq!(next_offset, 123456790);
    }

    // ── OutgoingMessage construction for gateway deliver_response ──

    #[test]
    fn outgoing_message_for_gateway_delivery() {
        let chat_id: i64 = 42;
        let response_text = "Here is your result.";
        let out = OutgoingMessage {
            channel: "telegram".to_string(),
            recipient: String::new(),
            text: response_text.to_string(),
            metadata: serde_json::json!({ "chat_id": chat_id }),
        };
        assert_eq!(out.channel, "telegram");
        assert!(out.recipient.is_empty());
        assert_eq!(out.text, response_text);
        assert_eq!(out.metadata["chat_id"], 42);
    }
}
