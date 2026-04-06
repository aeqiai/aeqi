use aeqi_core::traits::{ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use tracing::debug;

use crate::html_utils::{self, USER_AGENT};

const DEFAULT_MAX_LENGTH: usize = 50_000;

/// Fetch a web page and return its content as readable text.
pub struct WebFetchTool;

impl Default for WebFetchTool {
    fn default() -> Self {
        Self::new()
    }
}

impl WebFetchTool {
    pub fn new() -> Self {
        Self
    }

    /// Strip script and style blocks, then remove all HTML tags, then collapse whitespace.
    fn html_to_text(html: &str) -> String {
        let mut text = html.to_string();

        // Remove script blocks.
        while let Some(start) = text.find("<script") {
            if let Some(end) = text[start..].find("</script>") {
                text.replace_range(start..start + end + "</script>".len(), " ");
            } else {
                // Unclosed script tag — remove to end.
                text.truncate(start);
                break;
            }
        }

        // Remove style blocks.
        while let Some(start) = text.find("<style") {
            if let Some(end) = text[start..].find("</style>") {
                text.replace_range(start..start + end + "</style>".len(), " ");
            } else {
                text.truncate(start);
                break;
            }
        }

        // Strip all remaining HTML tags.
        let result = html_utils::strip_html_tags(&text);

        // Decode common HTML entities.
        let result = html_utils::decode_html_entities(&result);

        // Collapse whitespace: replace runs of whitespace with a single space,
        // but preserve paragraph breaks (double newlines).
        let mut collapsed = String::with_capacity(result.len());
        let mut prev_was_space = false;
        for ch in result.chars() {
            if ch.is_whitespace() {
                if !prev_was_space {
                    collapsed.push(if ch == '\n' { '\n' } else { ' ' });
                    prev_was_space = true;
                }
            } else {
                collapsed.push(ch);
                prev_was_space = false;
            }
        }

        collapsed.trim().to_string()
    }
}

#[async_trait]
impl aeqi_core::traits::Tool for WebFetchTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let url = args
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'url' argument"))?;

        let max_length = args
            .get("max_length")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(DEFAULT_MAX_LENGTH);

        debug!(url = %url, max_length = %max_length, "fetching web page");

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent(USER_AGENT)
            .build()?;

        let response = match client.get(url).send().await {
            Ok(resp) => resp,
            Err(e) => return Ok(ToolResult::error(format!("fetch failed: {e}"))),
        };

        let status = response.status();
        if !status.is_success() {
            return Ok(ToolResult::error(format!("HTTP {status} for {url}")));
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("text/plain")
            .to_string();

        let body = match response.text().await {
            Ok(text) => text,
            Err(e) => {
                return Ok(ToolResult::error(format!(
                    "failed to read response body: {e}"
                )));
            }
        };

        let content = if content_type.contains("text/html") {
            Self::html_to_text(&body)
        } else if content_type.contains("json") {
            // Try to pretty-print JSON.
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(value) => serde_json::to_string_pretty(&value).unwrap_or(body),
                Err(_) => body,
            }
        } else {
            body
        };

        // Truncate to max_length.
        let mut output_body = content;
        if output_body.len() > max_length {
            output_body.truncate(max_length);
            output_body.push_str("\n... (truncated)");
        }

        let output = format!("URL: {url}\nContent-Type: {content_type}\n\n{output_body}");

        Ok(ToolResult::success(output))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "web_fetch".to_string(),
            description: "Fetch a web page and return its content as text. Supports HTML (converted to readable text), JSON, and plain text. Use for reading documentation, APIs, and web resources.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to fetch"
                    },
                    "max_length": {
                        "type": "integer",
                        "description": "Maximum response length in characters (default: 50000)"
                    }
                },
                "required": ["url"]
            }),
        }
    }

    fn name(&self) -> &str {
        "web_fetch"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}
