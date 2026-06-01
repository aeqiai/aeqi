//! OpenAI-compatible request / response types for the inference API.
//!
//! Shapes match the OpenAI API v1 surface. Callers that already speak OpenAI
//! can point at aeqi-inference without changing their client code.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

/// A single message in a chat conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// Role: `"system"`, `"user"`, `"assistant"`, or `"tool"`.
    pub role: String,
    /// Text content of the message.
    pub content: String,
    /// Model reasoning / chain-of-thought, normalized across providers.
    /// DeepSeek R1 and SiliconFlow expose it as upstream `reasoning_content`;
    /// other providers use `reasoning` or `reasoning_details[].text`
    /// (OpenRouter). Adapters normalize to this canonical field so tool
    /// callers see clean `content` while observability has reasoning
    /// available separately. `None` when the provider/model returned no
    /// reasoning (most non-reasoning models, redacted OpenAI `o1`/`o3`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

/// Request body for `POST /v1/chat/completions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    /// Model identifier, e.g. `"gpt-5"`, `"claude-sonnet-4-6"`, `"deepseek-v4"`.
    pub model: String,
    /// Ordered message history including the new user turn.
    pub messages: Vec<ChatMessage>,
    /// Whether to stream the response via SSE. Defaults to `false`.
    #[serde(default)]
    pub stream: bool,
    /// Maximum tokens to generate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    /// Sampling temperature (0.0–2.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

/// Token-usage statistics returned by the upstream provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// A single choice inside a non-streaming chat completion response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: u32,
    pub message: ChatMessage,
    /// Why the model stopped: `"stop"`, `"length"`, `"content_filter"`, etc.
    pub finish_reason: Option<String>,
}

/// Non-streaming response for `POST /v1/chat/completions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageStats>,
}

// ---------------------------------------------------------------------------
// Streaming chunks
// ---------------------------------------------------------------------------

/// Delta content inside a streaming chunk choice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkDelta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Reasoning delta — same normalization rules as
    /// [`ChatMessage::reasoning_content`]. Streaming SSE consumers can
    /// interleave reasoning + content as they arrive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

/// A single choice inside a streaming chunk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkChoice {
    pub index: u32,
    pub delta: ChunkDelta,
    pub finish_reason: Option<String>,
}

/// Server-Sent Event payload for streaming chat completions (`data: {…}`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub model: String,
    pub choices: Vec<ChunkChoice>,
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/// Request body for `POST /v1/embeddings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingRequest {
    /// Model identifier, e.g. `"text-embedding-3-small"`.
    pub model: String,
    /// Text to embed. Accepts a single string.
    pub input: String,
}

/// A single embedding vector result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingObject {
    pub object: String,
    pub index: u32,
    pub embedding: Vec<f32>,
}

/// Response for `POST /v1/embeddings`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingResponse {
    pub object: String,
    pub model: String,
    pub data: Vec<EmbeddingObject>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageStats>,
}

// ---------------------------------------------------------------------------
// Models list
// ---------------------------------------------------------------------------

/// Metadata for a single available model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub object: String,
    pub created: i64,
    pub owned_by: String,
}

/// Response for `GET /v1/models`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelList {
    pub object: String,
    pub data: Vec<ModelInfo>,
}

// ---------------------------------------------------------------------------
// Provisioning status
// ---------------------------------------------------------------------------

/// Who owns the active inference provider credentials for this runtime.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InferenceProvisioningMode {
    /// AEQI hosts the provider credentials and meters usage against an
    /// allowance attached to the account/runtime.
    AeqiManaged,
    /// The runtime operator supplies a provider endpoint/key.
    BringYourOwn,
    /// The runtime points at local/self-hosted inference and AEQI does not
    /// meter provider usage.
    SelfHosted,
}

/// Which party is financially responsible for provider usage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InferenceBillingOwner {
    /// AEQI pays the upstream provider and bills/meters the account.
    Aeqi,
    /// The runtime operator pays the provider directly.
    Runtime,
    /// No external provider billing applies.
    None,
}

/// Active provider surface exposed to the runtime/UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InferenceProviderStatus {
    pub provider: String,
    pub model_scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    pub operator_configurable: bool,
}

/// Monetary allowance for AEQI-managed inference.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InferenceAllowanceStatus {
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_cents: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_cents: Option<i64>,
    pub metered: bool,
    pub hard_limit: bool,
}

/// Stable runtime contract for hosted and self-hosted inference provisioning.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InferenceProvisioningStatus {
    pub mode: InferenceProvisioningMode,
    pub billing_owner: InferenceBillingOwner,
    pub provider: InferenceProviderStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowance: Option<InferenceAllowanceStatus>,
    pub custom_provider_allowed: bool,
    pub self_host_supported: bool,
}

impl InferenceProvisioningStatus {
    /// Default for standalone/self-host runtimes: AEQI does not own provider
    /// billing, but the runtime can still use the same OpenAI-compatible
    /// surface with operator-supplied providers.
    pub fn bring_your_own(provider: impl Into<String>) -> Self {
        Self {
            mode: InferenceProvisioningMode::BringYourOwn,
            billing_owner: InferenceBillingOwner::Runtime,
            provider: InferenceProviderStatus {
                provider: provider.into(),
                model_scope: "provider_agnostic".to_string(),
                endpoint: None,
                operator_configurable: true,
            },
            allowance: None,
            custom_provider_allowed: true,
            self_host_supported: true,
        }
    }

    /// Hosted AEQI mode: AEQI owns upstream credentials and meters usage
    /// against an allowance. The concrete balance may be filled per request.
    pub fn aeqi_managed(provider: impl Into<String>) -> Self {
        Self {
            mode: InferenceProvisioningMode::AeqiManaged,
            billing_owner: InferenceBillingOwner::Aeqi,
            provider: InferenceProviderStatus {
                provider: provider.into(),
                model_scope: "aeqi_managed".to_string(),
                endpoint: None,
                operator_configurable: false,
            },
            allowance: Some(InferenceAllowanceStatus {
                currency: "usd".to_string(),
                monthly_cents: None,
                remaining_cents: None,
                metered: true,
                hard_limit: true,
            }),
            custom_provider_allowed: false,
            self_host_supported: true,
        }
    }

    /// Local inference mode: no external provider billing applies.
    pub fn self_hosted(provider: impl Into<String>, endpoint: Option<String>) -> Self {
        Self {
            mode: InferenceProvisioningMode::SelfHosted,
            billing_owner: InferenceBillingOwner::None,
            provider: InferenceProviderStatus {
                provider: provider.into(),
                model_scope: "local".to_string(),
                endpoint,
                operator_configurable: true,
            },
            allowance: None,
            custom_provider_allowed: true,
            self_host_supported: true,
        }
    }

    pub fn with_remaining_cents(mut self, remaining_cents: i64) -> Self {
        if let Some(allowance) = self.allowance.as_mut() {
            allowance.remaining_cents = Some(remaining_cents);
        }
        self
    }
}

impl Default for InferenceProvisioningStatus {
    fn default() -> Self {
        Self::bring_your_own("runtime_configured")
    }
}
