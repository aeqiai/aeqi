use anyhow::{Result, anyhow};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Stripe price ID constants. Set these to match your Stripe dashboard.
const PRICE_STARTER_MONTHLY: &str = "price_starter_monthly";
const PRICE_GROWTH_MONTHLY: &str = "price_growth_monthly";

const STRIPE_API_BASE: &str = "https://api.stripe.com/v1";

#[derive(Clone)]
pub struct StripeClient {
    secret_key: String,
    webhook_secret: String,
    http: reqwest::Client,
}

impl StripeClient {
    pub fn new(secret_key: String, webhook_secret: String) -> Self {
        Self {
            secret_key,
            webhook_secret,
            http: reqwest::Client::new(),
        }
    }

    /// Create a Stripe customer. Returns the customer ID.
    pub async fn create_customer(&self, email: &str, name: &str) -> Result<String> {
        let resp = self
            .http
            .post(format!("{}/customers", STRIPE_API_BASE))
            .header("Authorization", format!("Bearer {}", self.secret_key))
            .form(&[("email", email), ("name", name)])
            .send()
            .await?;

        let status = resp.status();
        let body: serde_json::Value = resp.json().await?;

        if !status.is_success() {
            let msg = body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown Stripe error");
            return Err(anyhow!("Stripe create_customer failed: {msg}"));
        }

        body.get("id")
            .and_then(|id| id.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("Stripe customer response missing id"))
    }

    /// Create a Checkout Session. Returns the checkout URL.
    pub async fn create_checkout_session(
        &self,
        customer_id: &str,
        plan: &str,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<String> {
        let price_id = match plan {
            "starter" => PRICE_STARTER_MONTHLY,
            "growth" => PRICE_GROWTH_MONTHLY,
            _ => return Err(anyhow!("unknown plan: {plan}")),
        };

        let resp = self
            .http
            .post(format!("{}/checkout/sessions", STRIPE_API_BASE))
            .header("Authorization", format!("Bearer {}", self.secret_key))
            .form(&[
                ("mode", "subscription"),
                ("customer", customer_id),
                ("line_items[0][price]", price_id),
                ("line_items[0][quantity]", "1"),
                ("success_url", success_url),
                ("cancel_url", cancel_url),
            ])
            .send()
            .await?;

        let status = resp.status();
        let body: serde_json::Value = resp.json().await?;

        if !status.is_success() {
            let msg = body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown Stripe error");
            return Err(anyhow!("Stripe create_checkout_session failed: {msg}"));
        }

        body.get("url")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("Stripe checkout session response missing url"))
    }

    /// Create a Customer Portal session. Returns the portal URL.
    pub async fn create_portal_session(
        &self,
        customer_id: &str,
        return_url: &str,
    ) -> Result<String> {
        let resp = self
            .http
            .post(format!("{}/billing_portal/sessions", STRIPE_API_BASE))
            .header("Authorization", format!("Bearer {}", self.secret_key))
            .form(&[("customer", customer_id), ("return_url", return_url)])
            .send()
            .await?;

        let status = resp.status();
        let body: serde_json::Value = resp.json().await?;

        if !status.is_success() {
            let msg = body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("unknown Stripe error");
            return Err(anyhow!("Stripe create_portal_session failed: {msg}"));
        }

        body.get("url")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("Stripe portal session response missing url"))
    }

    /// Verify a Stripe webhook signature and parse the event payload.
    pub fn verify_webhook(
        &self,
        payload: &[u8],
        signature_header: &str,
    ) -> Result<serde_json::Value> {
        // Parse the Stripe-Signature header: "t=timestamp,v1=sig1,v1=sig2,..."
        let mut timestamp = None;
        let mut signatures = Vec::new();

        for part in signature_header.split(',') {
            let part = part.trim();
            if let Some(t) = part.strip_prefix("t=") {
                timestamp = Some(t.to_string());
            } else if let Some(sig) = part.strip_prefix("v1=") {
                signatures.push(sig.to_string());
            }
        }

        let timestamp =
            timestamp.ok_or_else(|| anyhow!("missing timestamp in Stripe-Signature header"))?;

        if signatures.is_empty() {
            return Err(anyhow!("no v1 signatures in Stripe-Signature header"));
        }

        // Compute expected signature: HMAC-SHA256("{timestamp}.{payload}")
        let payload_str = std::str::from_utf8(payload)
            .map_err(|_| anyhow!("webhook payload is not valid UTF-8"))?;
        let signed_payload = format!("{}.{}", timestamp, payload_str);

        let mut mac = HmacSha256::new_from_slice(self.webhook_secret.as_bytes())
            .map_err(|e| anyhow!("HMAC key error: {e}"))?;
        mac.update(signed_payload.as_bytes());
        let expected = hex::encode(mac.finalize().into_bytes());

        // Check if any of the provided signatures match.
        let valid = signatures.iter().any(|sig| sig == &expected);
        if !valid {
            return Err(anyhow!("webhook signature verification failed"));
        }

        // Optionally check timestamp tolerance (5 min).
        if let Ok(ts) = timestamp.parse::<i64>() {
            let now = chrono::Utc::now().timestamp();
            if (now - ts).abs() > 300 {
                return Err(anyhow!("webhook timestamp too old"));
            }
        }

        let event: serde_json::Value = serde_json::from_slice(payload)?;
        Ok(event)
    }
}
