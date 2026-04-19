// design note: context.compress is a Phase 2 stub. The full implementation
// requires access to the agent loop's internal message buffer, which is owned
// by the run() task and not accessible from a Tool trait's execute() method.
//
// Phase 3 will resolve this by passing a CompactionFn closure (similar to
// the SessionSpawnTool pattern) that the tool can call to trigger one stage of
// the compaction pipeline. The closure would be built from the agent loop's
// mutable state reference.
//
// The four mode variants map to the existing compaction stages in agent.rs:
//   snip       → snip_old_rounds() (deterministic oldest-round removal)
//   microcompact → microcompact() (clear compactable tool result bodies)
//   collapse   → collapse_context() (structural collapse of stale system msgs)
//   summarize  → summarize_context() (LLM-based full compaction)
//
// The inline stages in agent.rs are kept as fallback; this tool is called by
// events that opt-in to explicit compaction so operators can control the pipeline.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::warn;

/// Runs one stage of the compaction pipeline.
///
/// Args: `{ "mode": "snip" | "microcompact" | "collapse" | "summarize" }`
///
/// ACL: open — callable by LLM and events.
pub struct ContextCompressTool;

#[async_trait]
impl Tool for ContextCompressTool {
    fn name(&self) -> &str {
        "context.compress"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "context.compress".into(),
            description: "Run one stage of the context compaction pipeline. \
                          snip=remove oldest rounds, microcompact=clear tool result bodies, \
                          collapse=structural collapse, summarize=LLM-based full compaction."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["snip", "microcompact", "collapse", "summarize"],
                        "description": "Compaction mode to run."
                    }
                },
                "required": ["mode"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let mode = match args.get("mode").and_then(|v| v.as_str()) {
            Some(m @ ("snip" | "microcompact" | "collapse" | "summarize")) => m.to_string(),
            Some(m) => {
                return Ok(ToolResult::error(format!(
                    "context.compress: invalid mode '{m}', must be snip/microcompact/collapse/summarize"
                )));
            }
            None => {
                return Ok(ToolResult::error(
                    "context.compress: missing required field 'mode'",
                ));
            }
        };

        // Phase 2 stub: args are validated but the actual compaction is not yet wired.
        // Phase 3 will inject a CompactionFn closure and call it here.
        warn!(
            mode = %mode,
            "context.compress: Phase 2 stub — compaction not yet wired (Phase 3 will implement)"
        );

        Ok(ToolResult::success(format!(
            "context.compress: validated (mode={mode}) — \
             compaction wiring deferred to Phase 3"
        )))
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false // compaction modifies agent state, must be exclusive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn valid_mode_returns_stub_ok() {
        let tool = ContextCompressTool;
        for mode in ["snip", "microcompact", "collapse", "summarize"] {
            let result = tool
                .execute(serde_json::json!({ "mode": mode }))
                .await
                .unwrap();
            assert!(!result.is_error, "mode={mode} should succeed");
            assert!(result.output.contains("Phase 3"));
        }
    }

    #[tokio::test]
    async fn invalid_mode_returns_error() {
        let tool = ContextCompressTool;
        let result = tool
            .execute(serde_json::json!({ "mode": "nuke" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("invalid mode"));
    }

    #[tokio::test]
    async fn missing_mode_returns_error() {
        let tool = ContextCompressTool;
        let result = tool.execute(serde_json::json!({})).await.unwrap();
        assert!(result.is_error);
    }
}
