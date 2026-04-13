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
        format!(
            "{}/Accounts/{}/Messages.json",
            TWILIO_API, self.account_sid
        )
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
            Err(anyhow::anyhow!(
                "Twilio API error ({}): {}",
                status,
                body
            ))
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
