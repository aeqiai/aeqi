use aeqi_core::traits::{ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use tracing::debug;

use crate::html_utils::{self, USER_AGENT};

const DEFAULT_MAX_RESULTS: usize = 8;

/// Search the web using DuckDuckGo and return results.
pub struct WebSearchTool;

impl Default for WebSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

impl WebSearchTool {
    pub fn new() -> Self {
        Self
    }

    /// Extract text content from an HTML snippet, stripping tags.
    fn strip_tags(html: &str) -> String {
        html_utils::decode_html_entities(&html_utils::strip_html_tags(html))
            .trim()
            .to_string()
    }

    /// Parse DuckDuckGo HTML search results.
    ///
    /// Looks for result entries by finding `class="result__a"` links (title + URL)
    /// and `class="result__snippet"` elements (description).
    fn parse_results(html: &str, max_results: usize) -> Vec<SearchResult> {
        let mut results = Vec::new();

        // Split on result__a anchors to find each result link.
        let parts: Vec<&str> = html.split("class=\"result__a\"").collect();

        // First part is before any results, skip it.
        for part in parts.iter().skip(1) {
            if results.len() >= max_results {
                break;
            }

            // Extract href from the anchor tag.
            // The anchor looks like: href="//duckduckgo.com/l/?uddg=REAL_URL&..."
            // or sometimes href="https://..."
            let href = if let Some(href_start) = part.find("href=\"") {
                let after_href = &part[href_start + 6..];
                if let Some(href_end) = after_href.find('"') {
                    let raw_url = &after_href[..href_end];
                    // DuckDuckGo wraps URLs; extract the actual URL from uddg= param.
                    Self::extract_url(raw_url)
                } else {
                    continue;
                }
            } else {
                continue;
            };

            // Extract title: text between > and </a> after the class attribute.
            let title = if let Some(close_bracket) = part.find('>') {
                let after_bracket = &part[close_bracket + 1..];
                if let Some(end_a) = after_bracket.find("</a>") {
                    Self::strip_tags(&after_bracket[..end_a])
                } else {
                    continue;
                }
            } else {
                continue;
            };

            // Extract snippet: look for result__snippet in this part.
            let snippet = if let Some(snippet_start) = part.find("class=\"result__snippet\"") {
                let after_snippet = &part[snippet_start..];
                if let Some(close_bracket) = after_snippet.find('>') {
                    let content = &after_snippet[close_bracket + 1..];
                    // Find the closing tag (</a> or </td> or similar).
                    if let Some(end) = content.find("</") {
                        Self::strip_tags(&content[..end])
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            if !title.is_empty() && !href.is_empty() {
                results.push(SearchResult {
                    title,
                    url: href,
                    snippet,
                });
            }
        }

        results
    }

    /// Extract the real URL from a DuckDuckGo redirect link.
    fn extract_url(raw: &str) -> String {
        // DDG wraps URLs like: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&...
        if let Some(uddg_pos) = raw.find("uddg=") {
            let after_uddg = &raw[uddg_pos + 5..];
            let encoded = if let Some(amp) = after_uddg.find('&') {
                &after_uddg[..amp]
            } else {
                after_uddg
            };
            // URL-decode the value.
            Self::url_decode(encoded)
        } else if raw.starts_with("//") {
            format!("https:{raw}")
        } else {
            raw.to_string()
        }
    }

    /// Simple percent-encoding for query strings.
    fn url_encode(input: &str) -> String {
        let mut result = String::with_capacity(input.len() * 3);
        for byte in input.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    result.push(byte as char);
                }
                b' ' => result.push('+'),
                _ => {
                    result.push('%');
                    result.push_str(&format!("{byte:02X}"));
                }
            }
        }
        result
    }

    /// Simple percent-decoding for URLs.
    fn url_decode(input: &str) -> String {
        let mut result = String::with_capacity(input.len());
        let mut chars = input.chars();
        while let Some(ch) = chars.next() {
            if ch == '%' {
                let hex: String = chars.by_ref().take(2).collect();
                if hex.len() == 2 {
                    if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                        result.push(byte as char);
                    } else {
                        result.push('%');
                        result.push_str(&hex);
                    }
                } else {
                    result.push('%');
                    result.push_str(&hex);
                }
            } else if ch == '+' {
                result.push(' ');
            } else {
                result.push(ch);
            }
        }
        result
    }
}

struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

#[async_trait]
impl aeqi_core::traits::Tool for WebSearchTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'query' argument"))?;

        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(DEFAULT_MAX_RESULTS);

        debug!(query = %query, max_results = %max_results, "searching web via DuckDuckGo");

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent(USER_AGENT)
            .build()?;

        let encoded_query = Self::url_encode(query);
        let search_url = format!("https://html.duckduckgo.com/html/?q={encoded_query}");

        let response = match client.get(&search_url).send().await {
            Ok(resp) => resp,
            Err(e) => return Ok(ToolResult::error(format!("search request failed: {e}"))),
        };

        if !response.status().is_success() {
            return Ok(ToolResult::error(format!(
                "DuckDuckGo returned HTTP {}",
                response.status()
            )));
        }

        let html = match response.text().await {
            Ok(text) => text,
            Err(e) => {
                return Ok(ToolResult::error(format!(
                    "failed to read search response: {e}"
                )));
            }
        };

        let results = Self::parse_results(&html, max_results);

        if results.is_empty() {
            return Ok(ToolResult::success(format!(
                "No results found for: {query}"
            )));
        }

        let mut output = format!("Search results for: {query}\n\n");
        for (i, result) in results.iter().enumerate() {
            output.push_str(&format!("{}. {}\n", i + 1, result.title));
            output.push_str(&format!("   {}\n", result.url));
            if !result.snippet.is_empty() {
                output.push_str(&format!("   {}\n", result.snippet));
            }
            output.push('\n');
        }

        Ok(ToolResult::success(output))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "web_search".to_string(),
            description: "Search the web using DuckDuckGo and return results. Returns titles, URLs, and snippets for the top results.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum results to return (default: 8)"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "web_search"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}
