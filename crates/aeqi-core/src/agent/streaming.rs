//! Streaming-with-tools LLM call path.
//!
//! Tools begin executing as their input JSON completes (on `ToolUseComplete`
//! stream events), overlapping tool latency with LLM generation latency.

use std::time::Duration;

use tokio::sync::mpsc;
use tracing::warn;

use crate::traits::{ChatRequest, ChatResponse, ContentPart, LoopAction, ToolResult};

use super::Agent;
use super::compaction::{is_context_length_error, is_retryable_error};
use super::tool_result::ToolExecResult;

// ---------------------------------------------------------------------------
// Streaming outcome type
// ---------------------------------------------------------------------------

/// Outcome of streaming tool execution from `call_streaming_with_tools`.
pub(crate) enum StreamingToolOutcome {
    /// No tools in the LLM response.
    NoTools,
    /// Tools were executed during streaming — results ready for processing.
    Executed(Vec<ToolExecResult>),
    /// A before_tool hook halted during streaming.
    Halted {
        reason: String,
        tool_result_parts: Vec<ContentPart>,
    },
}

// ---------------------------------------------------------------------------
// Agent streaming methods
// ---------------------------------------------------------------------------

impl Agent {
    /// Call the provider using streaming and start tool execution during the stream.
    ///
    /// Tools begin executing as their input JSON completes (on `ToolUseComplete`
    /// stream events), overlapping tool latency with LLM generation latency.
    /// Each tool runs through `before_tool` before starting. If a hook halts,
    /// remaining tools are discarded and the halt is propagated.
    ///
    /// Includes retry logic for transient errors (exponential backoff).
    pub(super) async fn call_streaming_with_tools(
        &self,
        request: &ChatRequest,
    ) -> anyhow::Result<(ChatResponse, StreamingToolOutcome)> {
        let mut last_error = None;

        for attempt in 0..=self.config.max_retries {
            match self.try_streaming_with_tools(request).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    let err_str = e.to_string();
                    if is_context_length_error(&err_str) {
                        return Err(e);
                    }
                    if !is_retryable_error(&err_str) {
                        return Err(e);
                    }
                    if attempt < self.config.max_retries {
                        let delay = self.config.retry_base_delay_ms * 2u64.pow(attempt);
                        warn!(
                            agent = %self.config.name,
                            attempt = attempt + 1,
                            max = self.config.max_retries,
                            delay_ms = delay,
                            error = %err_str,
                            "streaming: retrying after transient error"
                        );
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    }
                    last_error = Some(e);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("all retries exhausted")))
    }

    /// Single streaming attempt — spawns the provider stream, processes events,
    /// and starts tool execution concurrently during the stream.
    async fn try_streaming_with_tools(
        &self,
        request: &ChatRequest,
    ) -> anyhow::Result<(ChatResponse, StreamingToolOutcome)> {
        use crate::streaming_executor::StreamingToolExecutor;
        use crate::traits::StreamEvent;

        let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
        let provider = self.provider.clone();
        let req = request.clone();

        // Spawn the streaming call — events flow through the channel while we
        // process them and start tools concurrently.
        let stream_handle = tokio::spawn(async move { provider.chat_stream(&req, tx).await });

        let mut executor = StreamingToolExecutor::new(self.tools.clone());
        let mut response: Option<ChatResponse> = None;
        let mut halt_reason: Option<(String, Vec<ContentPart>)> = None;
        let mut tools_started = 0u32;

        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::TextDelta(text) => {
                    self.emit(crate::chat_stream::ChatStreamEvent::TextDelta { text });
                }
                StreamEvent::ToolUseStart { ref id, ref name } => {
                    self.emit(crate::chat_stream::ChatStreamEvent::ToolStart {
                        tool_use_id: id.clone(),
                        tool_name: name.clone(),
                    });
                }
                StreamEvent::ToolUseComplete {
                    id,
                    name,
                    arguments,
                } => {
                    if halt_reason.is_none() {
                        match self.observer.before_tool(&name, &arguments).await {
                            LoopAction::Halt(reason) => {
                                let parts = vec![ContentPart::ToolResult {
                                    tool_use_id: id,
                                    content: format!("Blocked by middleware: {reason}"),
                                    is_error: true,
                                }];
                                executor.discard();
                                halt_reason = Some((reason, parts));
                            }
                            LoopAction::Inject(_) | LoopAction::Continue => {
                                // Emit DelegateStart for agents(action=delegate) calls so
                                // the frontend can track subagent activity.
                                if name == "agents" {
                                    let worker = arguments
                                        .get("to")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("subagent")
                                        .to_string();
                                    let subject = arguments
                                        .get("prompt")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.chars().take(120).collect::<String>())
                                        .unwrap_or_else(|| "delegated task".to_string());
                                    self.emit(crate::chat_stream::ChatStreamEvent::DelegateStart {
                                        worker_name: worker,
                                        task_subject: subject,
                                    });
                                }
                                executor.add_tool(id, name, arguments).await;
                                tools_started += 1;
                            }
                        }
                    }
                }
                StreamEvent::ToolUseInput(_) | StreamEvent::Usage(_) => {}
                StreamEvent::MessageComplete(resp) => {
                    response = Some(resp);
                }
            }
        }

        // Wait for the streaming task to complete.
        match stream_handle.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                executor.discard();
                return Err(e);
            }
            Err(join_err) => {
                executor.discard();
                return Err(anyhow::anyhow!("streaming task panicked: {join_err}"));
            }
        }

        let response = response
            .ok_or_else(|| anyhow::anyhow!("streaming: no MessageComplete event received"))?;

        if let Some((reason, parts)) = halt_reason {
            return Ok((
                response,
                StreamingToolOutcome::Halted {
                    reason,
                    tool_result_parts: parts,
                },
            ));
        }

        if tools_started == 0 {
            return Ok((response, StreamingToolOutcome::NoTools));
        }

        // Await all tool executions that started during streaming.
        let completed = executor.finish_all().await;
        let all_results = completed
            .into_iter()
            .map(|c| {
                let result: Result<ToolResult, anyhow::Error> = Ok(if c.result.is_error {
                    ToolResult::error(c.result.output)
                } else {
                    ToolResult::success(c.result.output)
                });
                (c.id, c.name, c.input, result, c.duration_ms)
            })
            .collect();

        Ok((response, StreamingToolOutcome::Executed(all_results)))
    }
}
