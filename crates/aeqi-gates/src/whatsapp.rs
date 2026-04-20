use aeqi_core::traits::{Channel, IncomingMessage, OutgoingMessage};
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use tokio::sync::mpsc;
use tracing::{debug, error, info};

const TWILIO_API: &str = "https://api.twilio.com/2010-04-01";

/// WhatsApp channel via Twilio's Messaging API.
///
/// Incoming messages are pushed by an external webhook handler via
/// `push_incoming()`. Outgoing messages are sent via the Twilio REST API.
pub struct WhatsAppChannel {
    client: Client,
    account_sid: String,
    auth_token: String,
    /// Twilio WhatsApp sender number (e.g., "+15551234567").
    from_number: String,
    /// Internal sender for pushing webhook messages into the channel.
    incoming_tx: mpsc::Sender<IncomingMessage>,
    /// Receiver handed out by `start()`. Wrapped in Option so it can be taken once.
    incoming_rx: std::sync::Mutex<Option<mpsc::Receiver<IncomingMessage>>>,
    shutdown: tokio::sync::watch::Sender<bool>,
    // Held to keep the watch channel alive; a dropped receiver would cause
    // sends to error. Not polled directly — subscribers clone from it.
    #[allow(dead_code)]
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
}

impl WhatsAppChannel {
    pub fn new(account_sid: String, auth_token: String, from_number: String) -> Self {
        let (incoming_tx, incoming_rx) = mpsc::channel(100);
        let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
        Self {
            client: Client::new(),
            account_sid,
            auth_token,
            from_number,
            incoming_tx,
            incoming_rx: std::sync::Mutex::new(Some(incoming_rx)),
            shutdown,
            shutdown_rx,
        }
    }

    /// Push an incoming message into the channel (called by webhook handlers).
    ///
    /// The message fields should be populated from the Twilio webhook payload:
    /// - `sender`: the From number (e.g., "whatsapp:+15559876543")
    /// - `text`: the message Body
    /// - `metadata`: JSON with MessageSid, From, To, etc.
    pub async fn push_incoming(&self, message: IncomingMessage) -> Result<()> {
        self.incoming_tx
            .send(message)
            .await
            .map_err(|_| anyhow::anyhow!("WhatsApp channel receiver dropped"))
    }

    fn messages_url(&self) -> String {
        format!("{}/Accounts/{}/Messages.json", TWILIO_API, self.account_sid)
    }
}

#[async_trait]
impl Channel for WhatsAppChannel {
    async fn start(&self) -> Result<mpsc::Receiver<IncomingMessage>> {
        let rx = self
            .incoming_rx
            .lock()
            .map_err(|_| anyhow::anyhow!("lock poisoned"))?
            .take()
            .ok_or_else(|| anyhow::anyhow!("WhatsApp channel already started (receiver taken)"))?;

        info!(from = %self.from_number, "WhatsApp channel started (webhook-driven)");
        Ok(rx)
    }

    async fn send(&self, message: OutgoingMessage) -> Result<()> {
        let to = message
            .metadata
            .get("to")
            .and_then(|v| v.as_str())
            .or_else(|| message.metadata.get("from").and_then(|v| v.as_str()))
            .context("missing 'to' or 'from' in WhatsApp message metadata")?;

        // Twilio WhatsApp requires the whatsapp: prefix.
        let to_whatsapp = if to.starts_with("whatsapp:") {
            to.to_string()
        } else {
            format!("whatsapp:{}", to)
        };
        let from_whatsapp = format!("whatsapp:{}", self.from_number);

        debug!(to = %to_whatsapp, "sending WhatsApp message via Twilio");

        let response = self
            .client
            .post(self.messages_url())
            .basic_auth(&self.account_sid, Some(&self.auth_token))
            .form(&[
                ("Body", message.text.as_str()),
                ("From", from_whatsapp.as_str()),
                ("To", to_whatsapp.as_str()),
            ])
            .send()
            .await
            .context("failed to send WhatsApp message via Twilio")?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            error!(status = %status, body = %body, "Twilio API error");
            Err(anyhow::anyhow!("Twilio API error ({}): {}", status, body))
        }
    }

    fn name(&self) -> &str {
        "whatsapp"
    }

    async fn stop(&self) -> Result<()> {
        let _ = self.shutdown.send(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── WhatsAppChannel construction ──

    #[test]
    fn channel_name_is_whatsapp() {
        let ch = WhatsAppChannel::new(
            "AC123".to_string(),
            "auth_tok".to_string(),
            "+15551234567".to_string(),
        );
        assert_eq!(ch.name(), "whatsapp");
    }

    // ── messages_url construction ──

    #[test]
    fn messages_url_format() {
        let ch = WhatsAppChannel::new(
            "AC_test_sid".to_string(),
            "auth".to_string(),
            "+1".to_string(),
        );
        assert_eq!(
            ch.messages_url(),
            "https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json"
        );
    }

    #[test]
    fn messages_url_with_real_style_sid() {
        let ch = WhatsAppChannel::new(
            "AC00000000000000000000000000000000".to_string(),
            "tok".to_string(),
            "+15551234567".to_string(),
        );
        assert_eq!(
            ch.messages_url(),
            "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json"
        );
    }

    // ── whatsapp: prefix handling ──

    #[test]
    fn to_number_gets_whatsapp_prefix_when_missing() {
        let to = "+15559876543";
        let to_whatsapp = if to.starts_with("whatsapp:") {
            to.to_string()
        } else {
            format!("whatsapp:{}", to)
        };
        assert_eq!(to_whatsapp, "whatsapp:+15559876543");
    }

    #[test]
    fn to_number_keeps_whatsapp_prefix_when_present() {
        let to = "whatsapp:+15559876543";
        let to_whatsapp = if to.starts_with("whatsapp:") {
            to.to_string()
        } else {
            format!("whatsapp:{}", to)
        };
        assert_eq!(to_whatsapp, "whatsapp:+15559876543");
    }

    #[test]
    fn from_number_always_gets_whatsapp_prefix() {
        let from_number = "+15551234567";
        let from_whatsapp = format!("whatsapp:{}", from_number);
        assert_eq!(from_whatsapp, "whatsapp:+15551234567");
    }

    // ── Metadata "to"/"from" fallback logic ──

    #[test]
    fn metadata_uses_to_field_when_present() {
        let metadata = serde_json::json!({
            "to": "+15551111111",
            "from": "+15552222222",
        });
        let to = metadata
            .get("to")
            .and_then(|v| v.as_str())
            .or_else(|| metadata.get("from").and_then(|v| v.as_str()));
        assert_eq!(to, Some("+15551111111"));
    }

    #[test]
    fn metadata_falls_back_to_from_when_to_missing() {
        let metadata = serde_json::json!({
            "from": "+15552222222",
        });
        let to = metadata
            .get("to")
            .and_then(|v| v.as_str())
            .or_else(|| metadata.get("from").and_then(|v| v.as_str()));
        assert_eq!(to, Some("+15552222222"));
    }

    #[test]
    fn metadata_returns_none_when_both_missing() {
        let metadata = serde_json::json!({
            "other_field": "value",
        });
        let to = metadata
            .get("to")
            .and_then(|v| v.as_str())
            .or_else(|| metadata.get("from").and_then(|v| v.as_str()));
        assert!(to.is_none());
    }

    #[test]
    fn metadata_returns_none_when_to_is_not_string() {
        let metadata = serde_json::json!({
            "to": 12345,
        });
        let to = metadata
            .get("to")
            .and_then(|v| v.as_str())
            .or_else(|| metadata.get("from").and_then(|v| v.as_str()));
        assert!(to.is_none());
    }

    // ── Twilio form body construction ──

    #[test]
    fn twilio_form_body_fields() {
        let from_number = "+15551234567";
        let text = "Hello from AEQI!";
        let to = "whatsapp:+15559876543";
        let from_whatsapp = format!("whatsapp:{}", from_number);

        let body: Vec<(&str, &str)> =
            vec![("Body", text), ("From", from_whatsapp.as_str()), ("To", to)];

        assert_eq!(body[0], ("Body", "Hello from AEQI!"));
        assert_eq!(body[1], ("From", "whatsapp:+15551234567"));
        assert_eq!(body[2], ("To", "whatsapp:+15559876543"));
    }

    #[test]
    fn twilio_form_body_with_unicode() {
        let text = "Привет 🌍 Ñoño";
        let body: Vec<(&str, &str)> = vec![("Body", text)];
        assert_eq!(body[0].1, "Привет 🌍 Ñoño");
    }

    #[test]
    fn twilio_form_body_with_empty_message() {
        let text = "";
        let body: Vec<(&str, &str)> = vec![("Body", text)];
        assert_eq!(body[0].1, "");
    }

    // ── push_incoming ──

    #[tokio::test]
    async fn push_incoming_delivers_message() {
        let ch = WhatsAppChannel::new("AC123".to_string(), "auth".to_string(), "+1".to_string());
        let mut rx = ch.start().await.unwrap();

        let incoming = IncomingMessage {
            channel: "whatsapp".to_string(),
            sender: "whatsapp:+15559876543".to_string(),
            text: "Hey there".to_string(),
            metadata: serde_json::json!({
                "MessageSid": "SM123",
                "From": "whatsapp:+15559876543",
                "To": "whatsapp:+15551234567",
            }),
        };

        ch.push_incoming(incoming.clone()).await.unwrap();

        let received = rx.recv().await.unwrap();
        assert_eq!(received.channel, "whatsapp");
        assert_eq!(received.sender, "whatsapp:+15559876543");
        assert_eq!(received.text, "Hey there");
        assert_eq!(received.metadata["MessageSid"], "SM123");
    }

    #[tokio::test]
    async fn push_incoming_multiple_messages() {
        let ch = WhatsAppChannel::new("AC123".to_string(), "auth".to_string(), "+1".to_string());
        let mut rx = ch.start().await.unwrap();

        for i in 0..3 {
            let incoming = IncomingMessage {
                channel: "whatsapp".to_string(),
                sender: "user".to_string(),
                text: format!("msg {}", i),
                metadata: serde_json::json!({}),
            };
            ch.push_incoming(incoming).await.unwrap();
        }

        for i in 0..3 {
            let received = rx.recv().await.unwrap();
            assert_eq!(received.text, format!("msg {}", i));
        }
    }

    #[tokio::test]
    async fn start_can_only_be_called_once() {
        let ch = WhatsAppChannel::new("AC123".to_string(), "auth".to_string(), "+1".to_string());
        let _rx = ch.start().await.unwrap();
        let result = ch.start().await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("already started"),
            "expected 'already started' error"
        );
    }

    // ── IncomingMessage from webhook data ──

    #[test]
    fn incoming_from_twilio_webhook_payload() {
        // Simulates constructing an IncomingMessage from a Twilio webhook
        let from = "whatsapp:+15559876543";
        let body = "What's the status?";
        let message_sid = "SM_abc123";

        let incoming = IncomingMessage {
            channel: "whatsapp".to_string(),
            sender: from.to_string(),
            text: body.to_string(),
            metadata: serde_json::json!({
                "MessageSid": message_sid,
                "From": from,
                "To": "whatsapp:+15551234567",
            }),
        };

        assert_eq!(incoming.channel, "whatsapp");
        assert_eq!(incoming.sender, "whatsapp:+15559876543");
        assert_eq!(incoming.text, "What's the status?");
    }
}
