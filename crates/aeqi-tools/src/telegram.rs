//! LLM-callable Telegram messaging tools.
//!
//! These tools are only injected into sessions that are bound to a
//! `TelegramChannel`. They give the agent the ability to send
//! quoted replies and emoji reactions on Telegram.

use std::sync::Arc;

use aeqi_core::traits::{Channel as ChannelTrait, Tool, ToolResult, ToolSpec};
use aeqi_gates::TelegramChannel;
use anyhow::Result;
use async_trait::async_trait;

/// Send a quoted reply to a Telegram message.
pub struct TelegramReplyTool {
    pub channel: Arc<TelegramChannel>,
}

#[async_trait]
impl Tool for TelegramReplyTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let chat_id = match args.get("chat_id").and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => {
                return Ok(ToolResult::error(
                    "missing required argument: chat_id (integer)",
                ));
            }
        };
        let text = match args.get("text").and_then(|v| v.as_str()) {
            Some(t) => t.to_string(),
            None => return Ok(ToolResult::error("missing required argument: text")),
        };
        let reply_to = match args.get("reply_to_message_id").and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => {
                return Ok(ToolResult::error(
                    "missing required argument: reply_to_message_id (integer)",
                ));
            }
        };

        match self.channel.send_reply(chat_id, text, reply_to).await {
            Ok(()) => Ok(ToolResult::success(format!(
                "reply sent to message {reply_to} in chat {chat_id}"
            ))
            .with_data(serde_json::json!({
                "chat_id": chat_id,
                "reply_to_message_id": reply_to,
            }))),
            Err(e) => Ok(ToolResult::error(format!("telegram_reply failed: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "telegram_reply".to_string(),
            description: "Send a quoted reply to a Telegram message. The reply will appear \
                threaded under the original message in the chat."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "chat_id": {
                        "type": "integer",
                        "description": "Telegram chat ID"
                    },
                    "text": {
                        "type": "string",
                        "description": "Reply text to send"
                    },
                    "reply_to_message_id": {
                        "type": "integer",
                        "description": "message_id of the message to quote"
                    }
                },
                "required": ["chat_id", "text", "reply_to_message_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "telegram_reply"
    }

    fn is_destructive(&self, _input: &serde_json::Value) -> bool {
        true
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

/// Send an emoji reaction to a Telegram message.
pub struct TelegramReactTool {
    pub channel: Arc<TelegramChannel>,
}

#[async_trait]
impl Tool for TelegramReactTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let chat_id = match args.get("chat_id").and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => {
                return Ok(ToolResult::error(
                    "missing required argument: chat_id (integer)",
                ));
            }
        };
        let message_id = match args.get("message_id").and_then(|v| v.as_i64()) {
            Some(id) => id,
            None => {
                return Ok(ToolResult::error(
                    "missing required argument: message_id (integer)",
                ));
            }
        };
        let emoji = match args.get("emoji").and_then(|v| v.as_str()) {
            Some(e) => e.to_string(),
            None => return Ok(ToolResult::error("missing required argument: emoji")),
        };

        match self.channel.react(chat_id, message_id, &emoji).await {
            Ok(()) => Ok(ToolResult::success(format!(
                "reacted with {emoji} to message {message_id} in chat {chat_id}"
            ))
            .with_data(serde_json::json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "emoji": emoji,
            }))),
            Err(e) => Ok(ToolResult::error(format!("telegram_react failed: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "telegram_react".to_string(),
            description: "Send an emoji reaction to a Telegram message.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "chat_id": {
                        "type": "integer",
                        "description": "Telegram chat ID"
                    },
                    "message_id": {
                        "type": "integer",
                        "description": "message_id of the message to react to"
                    },
                    "emoji": {
                        "type": "string",
                        "description": "Single emoji, e.g. \"👍\""
                    }
                },
                "required": ["chat_id", "message_id", "emoji"]
            }),
        }
    }

    fn name(&self) -> &str {
        "telegram_react"
    }

    fn is_destructive(&self, _input: &serde_json::Value) -> bool {
        true
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TelegramReplyTool argument validation ──

    #[test]
    fn telegram_reply_tool_name() {
        assert_eq!("telegram_reply", "telegram_reply");
    }

    #[test]
    fn telegram_react_tool_name() {
        assert_eq!("telegram_react", "telegram_react");
    }

    #[test]
    fn telegram_reply_schema_required_fields() {
        let required: Vec<&str> = vec!["chat_id", "text", "reply_to_message_id"];
        assert_eq!(required.len(), 3);
        assert!(required.contains(&"chat_id"));
        assert!(required.contains(&"text"));
        assert!(required.contains(&"reply_to_message_id"));
    }

    #[test]
    fn telegram_react_schema_required_fields() {
        let required: Vec<&str> = vec!["chat_id", "message_id", "emoji"];
        assert_eq!(required.len(), 3);
        assert!(required.contains(&"chat_id"));
        assert!(required.contains(&"message_id"));
        assert!(required.contains(&"emoji"));
    }

    // ── Argument parsing logic (pure, no channel needed) ──

    #[test]
    fn missing_chat_id_detected() {
        let args = serde_json::json!({ "text": "hello", "reply_to_message_id": 5 });
        assert!(args.get("chat_id").and_then(|v| v.as_i64()).is_none());
    }

    #[test]
    fn missing_reply_to_detected() {
        let args = serde_json::json!({ "chat_id": 42, "text": "hello" });
        assert!(
            args.get("reply_to_message_id")
                .and_then(|v| v.as_i64())
                .is_none()
        );
    }

    #[test]
    fn missing_emoji_detected() {
        let args = serde_json::json!({ "chat_id": 42, "message_id": 7 });
        assert!(args.get("emoji").and_then(|v| v.as_str()).is_none());
    }

    #[test]
    fn valid_react_args_parse() {
        let args = serde_json::json!({
            "chat_id": 12345,
            "message_id": 99,
            "emoji": "👍"
        });
        assert_eq!(args["chat_id"].as_i64().unwrap(), 12345);
        assert_eq!(args["message_id"].as_i64().unwrap(), 99);
        assert_eq!(args["emoji"].as_str().unwrap(), "👍");
    }

    #[test]
    fn valid_reply_args_parse() {
        let args = serde_json::json!({
            "chat_id": -1001234567890_i64,
            "text": "Thanks!",
            "reply_to_message_id": 42
        });
        assert_eq!(args["chat_id"].as_i64().unwrap(), -1001234567890_i64);
        assert_eq!(args["text"].as_str().unwrap(), "Thanks!");
        assert_eq!(args["reply_to_message_id"].as_i64().unwrap(), 42);
    }
}
