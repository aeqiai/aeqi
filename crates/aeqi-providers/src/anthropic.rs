//! Anthropic API provider implementation for AEQI.
//!
//! This module provides a [`Provider`] implementation for the Anthropic Messages API.
//! It supports Claude models with tool use, streaming, and proper error handling.
//!
//! # Example
//! ```no_run
//! use aeqi_providers::AnthropicProvider;
//! use aeqi_core::traits::Provider;
//!
//! let provider = AnthropicProvider::new("api-key".to_string(), "claude-3-5-sonnet-20241022".to_string());
//! // Use provider.chat() or provider.chat_stream() to interact with Claude
//! ```

use aeqi_core::traits::{
    ChatRequest, ChatResponse, ContentPart, Message, MessageContent, Provider, Role, StopReason,
    StreamEvent, ToolCall, ToolSpec, Usage,
};
use anyhow::{Context, Result};
use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::debug;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const PROMPT_CACHING_BETA: &str = "prompt-caching-2024-07-31";

/// Direct Anthropic API provider (Messages API).
pub struct AnthropicProvider {
    client: Client,
    api_key: String,
    default_model: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, default_model: String) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .context("failed to build HTTP client")?;

        Ok(Self {
            client,
            api_key,
            default_model,
        })
    }
}

// --- Anthropic API types ---

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
    usage: AnthropicUsage,
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum AnthropicContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

#[derive(Deserialize)]
struct AnthropicUsage {
    input_tokens: u32,
    output_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: u32,
    #[serde(default)]
    cache_read_input_tokens: u32,
}

#[derive(Deserialize)]
struct AnthropicError {
    error: AnthropicErrorDetail,
}

#[derive(Deserialize)]
struct AnthropicErrorDetail {
    message: String,
}

fn convert_messages(messages: &[Message]) -> (Option<serde_json::Value>, Vec<AnthropicMessage>) {
    // (T1.11) Each system block carries the text + an explicit
    // "substrate marked this as cache-pinned" bit. The legacy "first system
    // text always gets cache_control" rule is preserved below so that
    // historical callers (which build a single `Role::System` message with
    // `MessageContent::Text`) keep their byte-identical request shape.
    let mut system_blocks: Vec<(String, bool)> = Vec::new();
    let mut converted = Vec::new();

    for msg in messages {
        match msg.role {
            Role::System => match &msg.content {
                MessageContent::Text(text) => {
                    system_blocks.push((text.clone(), false));
                }
                MessageContent::Parts(parts) => {
                    for part in parts {
                        if let ContentPart::Text {
                            text,
                            cache_control,
                        } = part
                        {
                            system_blocks.push((text.clone(), cache_control.is_some()));
                        }
                    }
                }
            },
            Role::User => {
                if let Some(text) = msg.content.as_text() {
                    converted.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: serde_json::Value::String(text.to_string()),
                    });
                }
            }
            Role::Assistant => match &msg.content {
                MessageContent::Text(text) => {
                    converted.push(AnthropicMessage {
                        role: "assistant".to_string(),
                        content: serde_json::Value::String(text.clone()),
                    });
                }
                MessageContent::Parts(parts) => {
                    let mut content_blocks = Vec::new();
                    for part in parts {
                        match part {
                            ContentPart::Text {
                                text,
                                cache_control,
                            } => {
                                let mut block = serde_json::json!({
                                    "type": "text",
                                    "text": text,
                                });
                                if cache_control.is_some()
                                    && let Some(obj) = block.as_object_mut()
                                {
                                    obj.insert(
                                        "cache_control".to_string(),
                                        serde_json::json!({"type": "ephemeral"}),
                                    );
                                }
                                content_blocks.push(block);
                            }
                            ContentPart::ToolUse { id, name, input } => {
                                content_blocks.push(serde_json::json!({
                                    "type": "tool_use",
                                    "id": id,
                                    "name": name,
                                    "input": input,
                                }));
                            }
                            _ => {}
                        }
                    }
                    converted.push(AnthropicMessage {
                        role: "assistant".to_string(),
                        content: serde_json::Value::Array(content_blocks),
                    });
                }
            },
            Role::Tool => {
                if let MessageContent::Parts(parts) = &msg.content {
                    let mut content_blocks = Vec::new();
                    for part in parts {
                        if let ContentPart::ToolResult {
                            tool_use_id,
                            content,
                            is_error,
                        } = part
                        {
                            content_blocks.push(serde_json::json!({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": content,
                                "is_error": is_error,
                            }));
                        }
                    }
                    converted.push(AnthropicMessage {
                        role: "user".to_string(),
                        content: serde_json::Value::Array(content_blocks),
                    });
                }
            }
        }
    }

    // Apply prompt caching to system content.
    //
    // Pre-T1.11 behaviour (preserved): when no substrate-driven cache markers
    // are present, the very first system block gets a `cache_control:
    // ephemeral` annotation (the "stable system prompt" prefix) and any
    // remaining system text is folded into a second block WITHOUT a marker
    // so it doesn't bust the cache on the stable prefix.
    //
    // T1.11 behaviour: when at least one block carries an explicit substrate
    // marker, the per-block markers are honored verbatim and the legacy
    // "always pin the first" fallback is skipped — the substrate has made an
    // intentional decision and we don't second-guess it.
    let system = if system_blocks.is_empty() {
        None
    } else {
        let any_substrate_marked = system_blocks.iter().any(|(_, marked)| *marked);
        let blocks: Vec<serde_json::Value> = if any_substrate_marked {
            system_blocks
                .iter()
                .map(|(text, marked)| {
                    let mut b = serde_json::json!({"type": "text", "text": text});
                    if *marked && let Some(obj) = b.as_object_mut() {
                        obj.insert(
                            "cache_control".to_string(),
                            serde_json::json!({"type": "ephemeral"}),
                        );
                    }
                    b
                })
                .collect()
        } else {
            let mut out = vec![serde_json::json!({
                "type": "text",
                "text": system_blocks[0].0,
                "cache_control": {"type": "ephemeral"}
            })];
            if system_blocks.len() > 1 {
                let tail = system_blocks[1..]
                    .iter()
                    .map(|(t, _)| t.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                out.push(serde_json::json!({
                    "type": "text",
                    "text": tail,
                }));
            }
            out
        };
        Some(serde_json::Value::Array(blocks))
    };

    // Mark last 3 messages with cache_control breakpoints.
    let len = converted.len();
    let cache_start = len.saturating_sub(3);
    for msg in converted[cache_start..].iter_mut() {
        match &mut msg.content {
            serde_json::Value::String(text) => {
                msg.content = serde_json::json!([{
                    "type": "text",
                    "text": text.clone(),
                    "cache_control": {"type": "ephemeral"}
                }]);
            }
            serde_json::Value::Array(blocks) => {
                if let Some(last) = blocks.last_mut()
                    && let Some(obj) = last.as_object_mut()
                {
                    obj.insert(
                        "cache_control".to_string(),
                        serde_json::json!({"type": "ephemeral"}),
                    );
                }
            }
            _ => {}
        }
    }

    (system, converted)
}

fn convert_tools(tools: &[ToolSpec]) -> Vec<serde_json::Value> {
    let mut converted: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema,
            })
        })
        .collect();
    // Cache the last tool definition — tools are stable across turns.
    if let Some(last) = converted.last_mut()
        && let Some(obj) = last.as_object_mut()
    {
        obj.insert(
            "cache_control".to_string(),
            serde_json::json!({"type": "ephemeral"}),
        );
    }
    converted
}

// --- SSE streaming event types ---

/// Wrapper for parsing the top-level `type` field of each SSE event.
#[derive(Deserialize)]
struct SseEvent {
    #[serde(rename = "type")]
    event_type: String,
    // Remaining fields are parsed separately per event type.
}

#[derive(Deserialize)]
struct SseMessageStart {
    message: SseMessageStartMessage,
}

// Full message envelope parsed from the `message_start` SSE frame.
// Fields are read by serde; we currently surface only usage via a wrapper
// but keep the model field parsed for future provider telemetry.
#[derive(Deserialize)]
#[allow(dead_code)]
struct SseMessageStartMessage {
    model: Option<String>,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct SseContentBlockStart {
    index: usize,
    content_block: SseContentBlock,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum SseContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String },
}

#[derive(Deserialize)]
struct SseContentBlockDelta {
    index: usize,
    delta: SseDelta,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum SseDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "input_json_delta")]
    InputJsonDelta { partial_json: String },
}

#[derive(Deserialize)]
struct SseContentBlockStop {
    index: usize,
}

#[derive(Deserialize)]
struct SseMessageDelta {
    delta: SseMessageDeltaInner,
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct SseMessageDeltaInner {
    stop_reason: Option<String>,
}

/// Tracks accumulated state for a single content block during streaming.
#[derive(Debug)]
enum BlockAccum {
    Text(String),
    ToolUse {
        id: String,
        name: String,
        input_json: String,
    },
}

#[async_trait]
impl Provider for AnthropicProvider {
    async fn chat(&self, request: &ChatRequest) -> Result<ChatResponse> {
        let model = if request.model.is_empty() {
            self.default_model.clone()
        } else {
            request.model.clone()
        };

        let (system, messages) = convert_messages(&request.messages);
        let tools = convert_tools(&request.tools);

        let api_request = AnthropicRequest {
            model,
            messages,
            max_tokens: request.max_tokens,
            system,
            temperature: if request.temperature > 0.0 {
                Some(request.temperature)
            } else {
                None
            },
            tools,
            stream: false,
        };

        debug!("sending request to Anthropic API");

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("anthropic-beta", PROMPT_CACHING_BETA)
            .header("content-type", "application/json")
            .json(&api_request)
            .send()
            .await
            .context("failed to send request to Anthropic")?;

        let status = response.status();
        let body = response.text().await?;

        if !status.is_success() {
            if let Ok(err) = serde_json::from_str::<AnthropicError>(&body) {
                anyhow::bail!("Anthropic API error ({}): {}", status, err.error.message);
            }
            anyhow::bail!("Anthropic API error ({}): {}", status, body);
        }

        let api_response: AnthropicResponse =
            serde_json::from_str(&body).context("failed to parse Anthropic response")?;

        let mut content_text = None;
        let mut tool_calls = Vec::new();

        for block in &api_response.content {
            match block {
                AnthropicContent::Text { text } => {
                    content_text = Some(text.clone());
                }
                AnthropicContent::ToolUse { id, name, input } => {
                    tool_calls.push(ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        arguments: input.clone(),
                    });
                }
            }
        }

        let stop_reason = match api_response.stop_reason.as_deref() {
            Some("end_turn") => StopReason::EndTurn,
            Some("tool_use") => StopReason::ToolUse,
            Some("max_tokens") => StopReason::MaxTokens,
            Some(other) => StopReason::Unknown(other.to_string()),
            None => StopReason::EndTurn,
        };

        Ok(ChatResponse {
            content: content_text,
            tool_calls,
            usage: Usage {
                prompt_tokens: api_response.usage.input_tokens,
                completion_tokens: api_response.usage.output_tokens,
                cache_creation_input_tokens: api_response.usage.cache_creation_input_tokens,
                cache_read_input_tokens: api_response.usage.cache_read_input_tokens,
            },
            stop_reason,
        })
    }

    async fn chat_stream(
        &self,
        request: &ChatRequest,
        tx: mpsc::Sender<StreamEvent>,
    ) -> Result<()> {
        let model = if request.model.is_empty() {
            self.default_model.clone()
        } else {
            request.model.clone()
        };

        let (system, messages) = convert_messages(&request.messages);
        let tools = convert_tools(&request.tools);

        let api_request = AnthropicRequest {
            model,
            messages,
            max_tokens: request.max_tokens,
            system,
            temperature: if request.temperature > 0.0 {
                Some(request.temperature)
            } else {
                None
            },
            tools,
            stream: true,
        };

        debug!("sending streaming request to Anthropic API");

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("anthropic-beta", PROMPT_CACHING_BETA)
            .header("content-type", "application/json")
            .json(&api_request)
            .send()
            .await
            .context("failed to send streaming request to Anthropic")?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await?;
            if let Ok(err) = serde_json::from_str::<AnthropicError>(&body) {
                anyhow::bail!("Anthropic API error ({}): {}", status, err.error.message);
            }
            anyhow::bail!("Anthropic API error ({}): {}", status, body);
        }

        // State accumulators for building the final ChatResponse.
        let mut blocks: Vec<BlockAccum> = Vec::new();
        let mut usage = Usage::default();
        let mut stop_reason = StopReason::EndTurn;

        // Read the SSE byte stream and process line by line.
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("error reading streaming response chunk")?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // Process complete lines from the buffer.
            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                buffer.drain(..=newline_pos);

                // Skip empty lines and event type lines.
                if line.is_empty() || line.starts_with("event:") {
                    continue;
                }

                let data = match line.strip_prefix("data: ") {
                    Some(d) => d,
                    None => continue,
                };

                // End of stream signal.
                if data == "[DONE]" {
                    break;
                }

                // Parse the event type first.
                let event: SseEvent = match serde_json::from_str(data) {
                    Ok(e) => e,
                    Err(e) => {
                        debug!("failed to parse SSE event type: {e}, data: {data}");
                        continue;
                    }
                };

                match event.event_type.as_str() {
                    "message_start" => {
                        if let Ok(msg) = serde_json::from_str::<SseMessageStart>(data)
                            && let Some(u) = msg.message.usage
                        {
                            usage.prompt_tokens = u.input_tokens;
                            usage.completion_tokens = u.output_tokens;
                            let _ = tx.send(StreamEvent::Usage(usage.clone())).await;
                        }
                    }

                    "content_block_start" => {
                        if let Ok(cbs) = serde_json::from_str::<SseContentBlockStart>(data) {
                            // Ensure blocks vec is large enough.
                            while blocks.len() <= cbs.index {
                                blocks.push(BlockAccum::Text(String::new()));
                            }
                            match cbs.content_block {
                                SseContentBlock::Text { text } => {
                                    blocks[cbs.index] = BlockAccum::Text(text);
                                }
                                SseContentBlock::ToolUse { id, name } => {
                                    let _ = tx
                                        .send(StreamEvent::ToolUseStart {
                                            id: id.clone(),
                                            name: name.clone(),
                                        })
                                        .await;
                                    blocks[cbs.index] = BlockAccum::ToolUse {
                                        id,
                                        name,
                                        input_json: String::new(),
                                    };
                                }
                            }
                        }
                    }

                    "content_block_delta" => {
                        if let Ok(cbd) = serde_json::from_str::<SseContentBlockDelta>(data) {
                            match cbd.delta {
                                SseDelta::TextDelta { text } => {
                                    let _ = tx.send(StreamEvent::TextDelta(text.clone())).await;
                                    if let Some(BlockAccum::Text(accum)) = blocks.get_mut(cbd.index)
                                    {
                                        accum.push_str(&text);
                                    }
                                }
                                SseDelta::InputJsonDelta { partial_json } => {
                                    let _ = tx
                                        .send(StreamEvent::ToolUseInput(partial_json.clone()))
                                        .await;
                                    if let Some(BlockAccum::ToolUse { input_json, .. }) =
                                        blocks.get_mut(cbd.index)
                                    {
                                        input_json.push_str(&partial_json);
                                    }
                                }
                            }
                        }
                    }

                    "message_delta" => {
                        if let Ok(md) = serde_json::from_str::<SseMessageDelta>(data) {
                            stop_reason = match md.delta.stop_reason.as_deref() {
                                Some("end_turn") => StopReason::EndTurn,
                                Some("tool_use") => StopReason::ToolUse,
                                Some("max_tokens") => StopReason::MaxTokens,
                                Some(other) => StopReason::Unknown(other.to_string()),
                                None => StopReason::EndTurn,
                            };
                            if let Some(u) = md.usage {
                                usage.completion_tokens = u.output_tokens;
                                let _ = tx.send(StreamEvent::Usage(usage.clone())).await;
                            }
                        }
                    }

                    "message_stop" => {
                        // Will assemble and emit MessageComplete below.
                    }

                    "content_block_stop" => {
                        if let Ok(cbs) = serde_json::from_str::<SseContentBlockStop>(data)
                            && let Some(BlockAccum::ToolUse {
                                id,
                                name,
                                input_json,
                            }) = blocks.get(cbs.index)
                        {
                            let arguments: serde_json::Value = serde_json::from_str(input_json)
                                .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                            let _ = tx
                                .send(StreamEvent::ToolUseComplete {
                                    id: id.clone(),
                                    name: name.clone(),
                                    arguments,
                                })
                                .await;
                        }
                    }

                    "ping" => {}

                    other => {
                        debug!("unknown SSE event type: {other}");
                    }
                }
            }
        }

        // Assemble final ChatResponse from accumulated blocks.
        let mut content_text: Option<String> = None;
        let mut tool_calls = Vec::new();

        for block in blocks {
            match block {
                BlockAccum::Text(text) => {
                    if !text.is_empty() {
                        content_text = Some(text);
                    }
                }
                BlockAccum::ToolUse {
                    id,
                    name,
                    input_json,
                } => {
                    let arguments: serde_json::Value = serde_json::from_str(&input_json)
                        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                    tool_calls.push(ToolCall {
                        id,
                        name,
                        arguments,
                    });
                }
            }
        }

        let response = ChatResponse {
            content: content_text,
            tool_calls,
            usage: usage.clone(),
            stop_reason,
        };

        let _ = tx.send(StreamEvent::MessageComplete(response)).await;

        Ok(())
    }

    fn name(&self) -> &str {
        "anthropic"
    }

    async fn health_check(&self) -> Result<()> {
        // Try a minimal request.
        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "model": &self.default_model,
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
            }))
            .send()
            .await?;

        if response.status().is_success() || response.status().as_u16() == 400 {
            Ok(()) // 400 = bad request but API key is valid.
        } else {
            anyhow::bail!("Anthropic health check failed: {}", response.status());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::CacheControl;

    /// (T1.11) When a system message is built from `MessageContent::Parts`
    /// with substrate-level cache markers, the Anthropic provider must
    /// emit per-block `cache_control: {type: "ephemeral"}` annotations
    /// matching the marked parts only — not the legacy
    /// "always pin the first block" fallback.
    #[test]
    fn anthropic_emits_cache_control_per_marked_part() {
        let messages = vec![Message {
            role: Role::System,
            content: MessageContent::Parts(vec![
                ContentPart::text_cached("identity prefix"),
                ContentPart::text("volatile suffix"),
            ]),
        }];

        let (system, _converted) = convert_messages(&messages);
        let system = system.expect("system block produced");
        let arr = system.as_array().expect("system is an array of blocks");
        assert_eq!(arr.len(), 2, "two parts → two blocks");
        // Marked → cache_control present.
        assert_eq!(
            arr[0].get("cache_control"),
            Some(&serde_json::json!({"type": "ephemeral"})),
            "marked part keeps cache_control on the wire"
        );
        // Unmarked → cache_control absent.
        assert!(
            arr[1].get("cache_control").is_none(),
            "unmarked part is sent without cache_control"
        );
        assert_eq!(
            arr[0]["text"].as_str(),
            Some("identity prefix"),
            "marked part's text is preserved verbatim",
        );
        assert_eq!(arr[1]["text"].as_str(), Some("volatile suffix"));
    }

    /// (T1.11) Pre-T1.11 callers that emit a single flat-text system
    /// message must continue to receive the legacy
    /// "first system block always gets cache_control" treatment so the
    /// existing prompt-prefix cache hit rate stays intact.
    #[test]
    fn anthropic_legacy_flat_text_system_keeps_legacy_pin() {
        let messages = vec![Message {
            role: Role::System,
            content: MessageContent::Text("legacy system prompt".to_string()),
        }];
        let (system, _) = convert_messages(&messages);
        let system = system.expect("system block produced");
        let arr = system.as_array().expect("array");
        assert_eq!(arr.len(), 1);
        assert_eq!(
            arr[0].get("cache_control"),
            Some(&serde_json::json!({"type": "ephemeral"})),
            "flat-text system preserves the pre-T1.11 always-pin-first behaviour",
        );
    }

    /// (T1.11) The marker plumbed through `ContentPart::Text { cache_control }`
    /// is honored on assistant content blocks too, not only system. This
    /// keeps the Anthropic provider symmetric across roles.
    #[test]
    fn anthropic_emits_cache_control_on_assistant_text_part() {
        let messages = vec![Message {
            role: Role::Assistant,
            content: MessageContent::Parts(vec![ContentPart::Text {
                text: "stable assistant prefix".to_string(),
                cache_control: Some(CacheControl::Ephemeral),
            }]),
        }];
        let (_, converted) = convert_messages(&messages);
        assert_eq!(converted.len(), 1);
        let blocks = converted[0]
            .content
            .as_array()
            .expect("assistant Parts → array");
        assert_eq!(blocks.len(), 1);
        assert_eq!(
            blocks[0].get("cache_control"),
            Some(&serde_json::json!({"type": "ephemeral"})),
            "assistant text part also carries cache_control on the wire",
        );
    }
}
