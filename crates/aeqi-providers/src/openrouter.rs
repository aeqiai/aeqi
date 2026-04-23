//! OpenRouter API provider implementation for AEQI.
//!
//! This module provides a [`Provider`] implementation for the OpenRouter API,
//! which acts as a proxy to multiple LLM providers (OpenAI, Anthropic, Google, etc.).
//! It supports tool use, streaming, image generation, and configurable base URLs.
//!
//! # Features
//! - Multi-provider routing through OpenRouter
//! - Image generation support via modalities
//! - Configurable base URL for self-hosted proxies
//! - Cost estimation via OpenRouter's pricing API
//!
//! # Example
//! ```no_run
//! use aeqi_providers::OpenRouterProvider;
//! use aeqi_core::traits::Provider;
//!
//! let provider = OpenRouterProvider::new("api-key".to_string(), "openai/gpt-4o".to_string()).unwrap();
//! // Can be configured with custom base URL: provider.with_base_url("http://localhost:8080")
//! ```

use aeqi_core::traits::{
    ChatRequest, ChatResponse, Provider, StopReason, ToolCall, ToolSpec, Usage,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::Engine as _;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::debug;

const DEFAULT_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// OpenRouter LLM provider (also used as generic OpenAI-compatible proxy).
pub struct OpenRouterProvider {
    client: Client,
    api_key: String,
    default_model: String,
    base_url: Option<String>,
}

impl OpenRouterProvider {
    pub fn new(api_key: String, default_model: String) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .context("failed to build HTTP client")?;

        Ok(Self {
            client,
            api_key,
            default_model,
            base_url: None,
        })
    }

    pub fn with_base_url(mut self, url: String) -> Self {
        if !url.is_empty() {
            self.base_url = Some(url.trim_end_matches('/').to_string());
        }
        self
    }

    fn api_url(&self) -> String {
        match &self.base_url {
            Some(base) => format!("{base}/chat/completions"),
            None => DEFAULT_API_URL.to_string(),
        }
    }

    pub fn default_model(&self) -> &str {
        &self.default_model
    }

    /// Generate an image via OpenRouter using `modalities: ["image"]`.
    /// Returns raw PNG bytes decoded from the base64 response.
    pub async fn generate_image(&self, prompt: &str, model: &str) -> Result<Vec<u8>> {
        let api_request = ApiRequest {
            model: model.to_string(),
            messages: vec![serde_json::json!({
                "role": "user",
                "content": prompt,
            })],
            tools: vec![],
            max_tokens: 4096,
            temperature: 1.0,
            provider: Some(ProviderRouting {
                allow_fallbacks: Some(false),
            }),
            modalities: Some(vec!["image".to_string(), "text".to_string()]),
        };

        debug!(
            provider = "openrouter",
            model = model,
            "sending image generation request"
        );

        let response = self
            .client
            .post(self.api_url())
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("HTTP-Referer", "https://github.com/USER/aeqi")
            .header("X-Title", "AEQI")
            .json(&api_request)
            .send()
            .await
            .context("failed to send image generation request to OpenRouter")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read image response body")?;

        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<ApiError>(&body) {
                anyhow::bail!(
                    "OpenRouter image API error ({}): {}",
                    err.error.code.unwrap_or_default(),
                    err.error.message
                );
            }
            anyhow::bail!("OpenRouter image API error ({}): {}", status, body);
        }

        let api_response: ApiResponse =
            serde_json::from_str(&body).context("failed to parse OpenRouter image response")?;

        let choice = api_response
            .choices
            .into_iter()
            .next()
            .context("no choices in image response")?;

        // Images come in the `images` array as data URLs.
        let data_url = if let Some(images) = choice.message.images {
            images
                .into_iter()
                .next()
                .map(|img| img.image_url.url)
                .context("images array is empty")?
        } else if let Some(content) = choice.message.content {
            // Fallback: some models return base64 directly in content.
            content
        } else {
            anyhow::bail!("no images or content in image response");
        };

        // Strip data URL prefix if present.
        let b64_data = data_url
            .strip_prefix("data:image/png;base64,")
            .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
            .or_else(|| data_url.strip_prefix("data:image/webp;base64,"))
            .unwrap_or(&data_url);

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64_data)
            .context("failed to decode base64 image data")?;

        Ok(bytes)
    }
}

// --- OpenRouter API types ---

#[derive(Debug, Serialize)]
struct ApiRequest {
    model: String,
    messages: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<serde_json::Value>,
    max_tokens: u32,
    temperature: f32,
    /// OpenRouter provider routing options.
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<ProviderRouting>,
    /// Output modalities (e.g. `["image"]` for image generation).
    #[serde(skip_serializing_if = "Option::is_none")]
    modalities: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct ProviderRouting {
    /// Disable fallback to alternative providers on the OpenRouter side.
    #[serde(skip_serializing_if = "Option::is_none")]
    allow_fallbacks: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ApiToolCall {
    id: String,
    r#type: String,
    function: ApiToolCallFunction,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ApiToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    choices: Vec<ApiChoice>,
    #[serde(default)]
    usage: Option<ApiUsage>,
}

#[derive(Debug, Deserialize)]
struct ApiChoice {
    message: ApiChoiceMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiChoiceMessage {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ApiToolCall>>,
    #[serde(default)]
    images: Option<Vec<ApiImage>>,
}

#[derive(Debug, Deserialize)]
struct ApiImage {
    image_url: ApiImageUrl,
}

#[derive(Debug, Deserialize)]
struct ApiImageUrl {
    url: String,
}

#[derive(Debug, Deserialize)]
struct ApiUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct ApiError {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: String,
    #[serde(default)]
    code: Option<String>,
}

// --- Conversion helpers ---

fn convert_messages(messages: &[aeqi_core::traits::Message]) -> Vec<serde_json::Value> {
    use aeqi_core::traits::{ContentPart, MessageContent, Role};

    let mut api_messages: Vec<serde_json::Value> = Vec::new();
    // Track indices of non-system messages for cache_control marking.
    let mut non_system_indices: Vec<usize> = Vec::new();

    for msg in messages {
        match &msg.role {
            Role::System => {
                let text = match &msg.content {
                    MessageContent::Text(t) => t.clone(),
                    MessageContent::Parts(parts) => parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join(""),
                };
                // System message with cache_control on its content block.
                api_messages.push(serde_json::json!({
                    "role": "system",
                    "content": [{
                        "type": "text",
                        "text": text,
                        "cache_control": {"type": "ephemeral"}
                    }]
                }));
            }
            Role::User => {
                let text = match &msg.content {
                    MessageContent::Text(t) => t.clone(),
                    MessageContent::Parts(parts) => parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::Text { text } => Some(text.as_str()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join(""),
                };
                let idx = api_messages.len();
                api_messages.push(serde_json::json!({
                    "role": "user",
                    "content": text,
                }));
                non_system_indices.push(idx);
            }
            Role::Assistant => match &msg.content {
                MessageContent::Text(t) => {
                    let idx = api_messages.len();
                    api_messages.push(serde_json::json!({
                        "role": "assistant",
                        "content": t,
                    }));
                    non_system_indices.push(idx);
                }
                MessageContent::Parts(parts) => {
                    let text: Option<String> = {
                        let texts: Vec<&str> = parts
                            .iter()
                            .filter_map(|p| match p {
                                ContentPart::Text { text } => Some(text.as_str()),
                                _ => None,
                            })
                            .collect();
                        if texts.is_empty() {
                            None
                        } else {
                            Some(texts.join(""))
                        }
                    };

                    let tool_calls: Vec<serde_json::Value> = parts
                        .iter()
                        .filter_map(|p| match p {
                            ContentPart::ToolUse { id, name, input } => Some(serde_json::json!({
                                "id": id,
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": serde_json::to_string(input).unwrap_or_default(),
                                }
                            })),
                            _ => None,
                        })
                        .collect();

                    let mut obj = serde_json::json!({
                        "role": "assistant",
                    });
                    if let Some(t) = text {
                        obj["content"] = serde_json::Value::String(t);
                    }
                    if !tool_calls.is_empty() {
                        obj["tool_calls"] = serde_json::Value::Array(tool_calls);
                    }
                    let idx = api_messages.len();
                    api_messages.push(obj);
                    non_system_indices.push(idx);
                }
            },
            Role::Tool => {
                // Tool results: each ToolResult part becomes a separate message.
                if let MessageContent::Parts(parts) = &msg.content {
                    for part in parts {
                        if let ContentPart::ToolResult {
                            tool_use_id,
                            content,
                            ..
                        } = part
                        {
                            let idx = api_messages.len();
                            api_messages.push(serde_json::json!({
                                "role": "tool",
                                "content": content,
                                "tool_call_id": tool_use_id,
                            }));
                            non_system_indices.push(idx);
                        }
                    }
                }
            }
        }
    }

    // Mark last 3 non-system messages with cache_control breakpoints.
    let cache_count = non_system_indices.len().min(3);
    for &idx in non_system_indices.iter().rev().take(cache_count) {
        if let Some(obj) = api_messages[idx].as_object_mut() {
            match obj.get("content") {
                Some(serde_json::Value::String(text)) => {
                    // Convert plain string content to content block array with cache_control.
                    let block = serde_json::json!([{
                        "type": "text",
                        "text": text.clone(),
                        "cache_control": {"type": "ephemeral"}
                    }]);
                    obj.insert("content".to_string(), block);
                }
                Some(serde_json::Value::Array(_)) => {
                    // Content is already an array of blocks — add cache_control to the last block.
                    if let Some(serde_json::Value::Array(blocks)) = obj.get_mut("content")
                        && let Some(last_block) = blocks.last_mut()
                        && let Some(block_obj) = last_block.as_object_mut()
                    {
                        block_obj.insert(
                            "cache_control".to_string(),
                            serde_json::json!({"type": "ephemeral"}),
                        );
                    }
                }
                _ => {
                    // No content (e.g., assistant with only tool_calls) — skip cache marking.
                }
            }
        }
    }

    api_messages
}

fn convert_tools(tools: &[ToolSpec]) -> Vec<serde_json::Value> {
    let mut converted: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                }
            })
        })
        .collect();
    // Cache the last tool definition — tools are stable across turns.
    if let Some(last) = converted.last_mut()
        && let Some(func) = last.get_mut("function")
        && let Some(func_obj) = func.as_object_mut()
    {
        func_obj.insert(
            "cache_control".to_string(),
            serde_json::json!({"type": "ephemeral"}),
        );
    }
    converted
}

#[async_trait]
impl Provider for OpenRouterProvider {
    async fn chat(&self, request: &ChatRequest) -> Result<ChatResponse> {
        let model = if request.model.is_empty() {
            self.default_model.clone()
        } else {
            request.model.clone()
        };

        let api_request = ApiRequest {
            model,
            messages: convert_messages(&request.messages),
            tools: convert_tools(&request.tools),
            max_tokens: request.max_tokens,
            temperature: request.temperature,
            provider: Some(ProviderRouting {
                allow_fallbacks: Some(false),
            }),
            modalities: None,
        };

        debug!(
            provider = "openrouter",
            model = %api_request.model,
            messages = api_request.messages.len(),
            tools = api_request.tools.len(),
            "sending request"
        );

        let response = self
            .client
            .post(self.api_url())
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("HTTP-Referer", "https://aeqi.dev")
            .header("X-Title", "System Agent")
            .json(&api_request)
            .send()
            .await
            .context("failed to send request to OpenRouter")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read response body")?;

        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<ApiError>(&body) {
                anyhow::bail!(
                    "OpenRouter API error ({}): {}",
                    err.error.code.unwrap_or_default(),
                    err.error.message
                );
            }
            anyhow::bail!("OpenRouter API error ({}): {}", status, body);
        }

        let api_response: ApiResponse =
            serde_json::from_str(&body).context("failed to parse OpenRouter response")?;

        let choice = api_response
            .choices
            .into_iter()
            .next()
            .context("no choices in OpenRouter response")?;

        let tool_calls: Vec<ToolCall> = choice
            .message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|tc| {
                let arguments: serde_json::Value =
                    serde_json::from_str(&tc.function.arguments).unwrap_or(serde_json::Value::Null);
                ToolCall {
                    id: tc.id,
                    name: tc.function.name,
                    arguments,
                }
            })
            .collect();

        let stop_reason = match choice.finish_reason.as_deref() {
            Some("stop") => StopReason::EndTurn,
            Some("tool_calls") => StopReason::ToolUse,
            Some("length") => StopReason::MaxTokens,
            Some(other) => StopReason::Unknown(other.to_string()),
            None => {
                if tool_calls.is_empty() {
                    StopReason::EndTurn
                } else {
                    StopReason::ToolUse
                }
            }
        };

        let usage = api_response
            .usage
            .map(|u| Usage {
                prompt_tokens: u.prompt_tokens,
                completion_tokens: u.completion_tokens,
                ..Default::default()
            })
            .unwrap_or_default();

        Ok(ChatResponse {
            content: choice.message.content,
            tool_calls,
            usage,
            stop_reason,
        })
    }

    fn name(&self) -> &str {
        "openrouter"
    }

    async fn health_check(&self) -> Result<()> {
        let response = self
            .client
            .get("https://openrouter.ai/api/v1/models")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await
            .context("failed to reach OpenRouter")?;

        if response.status().is_success() {
            Ok(())
        } else {
            anyhow::bail!("OpenRouter health check failed: {}", response.status())
        }
    }
}
