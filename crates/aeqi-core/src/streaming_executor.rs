//! Streaming tool executor — starts executing tools as they stream in from the provider.
//!
//! Concurrency-safe tools run in parallel during streaming. Non-concurrent tools
//! queue behind the parallel batch. Results are buffered and emitted in tool-order
//! (not completion order) for deterministic API message construction.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::task::JoinHandle;
use tracing::debug;

use crate::tool_registry::{ExecutionContext, execute_tool_with_context};
use crate::traits::{Tool, ToolResult};

/// Status of a tracked tool in the executor queue.
#[derive(Debug, Clone, PartialEq)]
enum ToolStatus {
    /// Tool has been queued but not started.
    Queued,
    /// Tool is executing.
    Executing,
    /// Tool has completed (result available).
    Completed,
    /// Tool was cancelled (sibling error or user abort).
    Cancelled,
}

/// A tool tracked by the streaming executor.
struct TrackedTool {
    id: String,
    name: String,
    input: serde_json::Value,
    status: ToolStatus,
    is_concurrent_safe: bool,
    /// Whether errors from this tool should cancel sibling tools.
    /// Only shell/bash tools set this to true.
    cascades_error: bool,
    result: Option<ToolResult>,
    started_at: Option<std::time::Instant>,
    join_handle: Option<JoinHandle<Result<ToolResult, String>>>,
}

/// Result from a completed tool, in order.
#[derive(Debug)]
pub struct CompletedTool {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
    pub result: ToolResult,
    pub duration_ms: u64,
}

/// Executes tools as they stream in with concurrency control.
///
/// - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
/// - Non-concurrent tools must execute alone (exclusive access)
/// - Results are buffered and emitted in the order tools were received
///
/// # Usage
///
/// ```ignore
/// let mut executor = StreamingToolExecutor::new(tools);
/// // During streaming:
/// executor.add_tool("id", "name", input).await;
/// for result in executor.drain_completed() { /* process */ }
/// // After streaming:
/// let remaining = executor.finish_all().await;
/// ```
pub struct StreamingToolExecutor {
    tools_defs: Vec<Arc<dyn Tool>>,
    queue: Vec<TrackedTool>,
    /// Shared flag — set when a tool errors, signals siblings to abort.
    sibling_errored: Arc<AtomicBool>,
    execution_context: Option<ExecutionContext>,
}

impl StreamingToolExecutor {
    pub fn new(tools: Vec<Arc<dyn Tool>>) -> Self {
        Self {
            tools_defs: tools,
            queue: Vec::new(),
            sibling_errored: Arc::new(AtomicBool::new(false)),
            execution_context: None,
        }
    }

    /// Attach runtime context for credential resolution and related tool
    /// execution substrate. Tools that do not declare credentials run exactly
    /// as before.
    pub fn with_execution_context(mut self, ctx: ExecutionContext) -> Self {
        self.execution_context = Some(ctx);
        self
    }

    /// Add a tool to the execution queue. Starts executing immediately if concurrency allows.
    pub async fn add_tool(&mut self, id: String, name: String, input: serde_json::Value) {
        let tool_def = self.tools_defs.iter().find(|t| t.name() == name);
        let is_safe = tool_def
            .map(|t| t.is_concurrent_safe(&input))
            .unwrap_or(false);
        let cascades_error = tool_def
            .map(|t| t.cascades_error_to_siblings())
            .unwrap_or(false);

        self.queue.push(TrackedTool {
            id,
            name,
            input,
            status: ToolStatus::Queued,
            is_concurrent_safe: is_safe,
            cascades_error,
            result: None,
            started_at: None,
            join_handle: None,
        });

        self.try_start_queued().await;
    }

    /// Check if any queued tools can start executing based on current concurrency state.
    async fn try_start_queued(&mut self) {
        let executing_all_safe = {
            let executing: Vec<bool> = self
                .queue
                .iter()
                .filter(|t| t.status == ToolStatus::Executing)
                .map(|t| t.is_concurrent_safe)
                .collect();
            (executing.is_empty(), executing.iter().all(|&s| s))
        };

        // Collect indices of tools to start.
        let mut to_start = Vec::new();
        for (i, tool) in self.queue.iter().enumerate() {
            if tool.status != ToolStatus::Queued {
                continue;
            }
            let can_execute =
                executing_all_safe.0 || (tool.is_concurrent_safe && executing_all_safe.1);
            if can_execute {
                to_start.push(i);
            } else if !tool.is_concurrent_safe {
                break;
            }
        }

        // Start tools by index (no overlapping borrows).
        for i in to_start {
            let tool_def = self
                .tools_defs
                .iter()
                .find(|t| t.name() == self.queue[i].name)
                .cloned();
            let Some(tool_def) = tool_def else {
                self.queue[i].status = ToolStatus::Completed;
                self.queue[i].result = Some(ToolResult::error(format!(
                    "Unknown tool: {}",
                    self.queue[i].name
                )));
                continue;
            };

            let input = self.queue[i].input.clone();
            let sibling_errored = self.sibling_errored.clone();
            let tool_name = self.queue[i].name.clone();
            let cascades = self.queue[i].cascades_error;
            let execution_context = self.execution_context.clone();

            let handle = tokio::spawn(async move {
                if sibling_errored.load(Ordering::Acquire) {
                    return Err("Cancelled: sibling tool errored".to_string());
                }
                let result = if let Some(ctx) = execution_context.as_ref() {
                    execute_tool_with_context(tool_def.as_ref(), &tool_name, input, ctx).await
                } else {
                    tool_def.execute(input).await
                };
                match result {
                    Ok(result) => {
                        if result.is_error && cascades {
                            sibling_errored.store(true, Ordering::Release);
                            debug!(tool = %tool_name, "shell tool errored — signaling siblings");
                        }
                        Ok(result)
                    }
                    Err(e) => {
                        if cascades {
                            sibling_errored.store(true, Ordering::Release);
                        }
                        Err(e.to_string())
                    }
                }
            });

            self.queue[i].status = ToolStatus::Executing;
            self.queue[i].started_at = Some(std::time::Instant::now());
            self.queue[i].join_handle = Some(handle);
        }
    }

    /// Collect completed results without blocking. Returns results in tool-order
    /// for tools at the front of the queue that have finished.
    pub fn drain_completed(&mut self) -> Vec<CompletedTool> {
        let mut results = Vec::new();

        // Only drain from the front — maintain order.
        while let Some(tool) = self.queue.first() {
            match tool.status {
                ToolStatus::Completed | ToolStatus::Cancelled => {
                    let mut tool = self.queue.remove(0);
                    let result = tool
                        .result
                        .take()
                        .unwrap_or_else(|| ToolResult::error("Tool cancelled"));
                    let duration_ms = tool
                        .started_at
                        .map(|s| s.elapsed().as_millis() as u64)
                        .unwrap_or(0);
                    results.push(CompletedTool {
                        id: tool.id,
                        name: tool.name,
                        input: tool.input,
                        result,
                        duration_ms,
                    });
                }
                _ => break, // Not yet complete — stop draining.
            }
        }

        results
    }

    /// Await ALL remaining tools. Called after streaming completes.
    /// Returns results in tool-order.
    pub async fn finish_all(&mut self) -> Vec<CompletedTool> {
        // First, start any remaining queued tools.
        self.try_start_queued().await;

        // Await all executing tools.
        for tool in self.queue.iter_mut() {
            if let Some(handle) = tool.join_handle.take() {
                match handle.await {
                    Ok(Ok(result)) => {
                        tool.result = Some(result);
                        tool.status = ToolStatus::Completed;
                    }
                    Ok(Err(err_msg)) => {
                        tool.result = Some(ToolResult::error(err_msg));
                        tool.status = ToolStatus::Cancelled;
                    }
                    Err(join_err) => {
                        tool.result = Some(ToolResult::error(format!("Tool panicked: {join_err}")));
                        tool.status = ToolStatus::Cancelled;
                    }
                }
            }
        }

        // Start any newly-unblocked tools and await them too (recursive unblock).
        let mut had_queued = true;
        while had_queued {
            had_queued = false;
            self.try_start_queued().await;
            for tool in self.queue.iter_mut() {
                if let Some(handle) = tool.join_handle.take() {
                    had_queued = true;
                    match handle.await {
                        Ok(Ok(result)) => {
                            tool.result = Some(result);
                            tool.status = ToolStatus::Completed;
                        }
                        Ok(Err(err_msg)) => {
                            tool.result = Some(ToolResult::error(err_msg));
                            tool.status = ToolStatus::Cancelled;
                        }
                        Err(join_err) => {
                            tool.result =
                                Some(ToolResult::error(format!("Tool panicked: {join_err}")));
                            tool.status = ToolStatus::Cancelled;
                        }
                    }
                }
            }
        }

        // Drain everything.
        let mut results = Vec::new();
        for tool in self.queue.drain(..) {
            let result = tool
                .result
                .unwrap_or_else(|| ToolResult::error("Tool never completed"));
            let duration_ms = tool
                .started_at
                .map(|s| s.elapsed().as_millis() as u64)
                .unwrap_or(0);
            results.push(CompletedTool {
                id: tool.id,
                name: tool.name,
                input: tool.input,
                result,
                duration_ms,
            });
        }
        results
    }

    /// Discard all pending tools and abort executing ones.
    /// Called on streaming fallback, abort, or before_tool halt.
    pub fn discard(&mut self) {
        for tool in self.queue.iter_mut() {
            if tool.status == ToolStatus::Queued {
                tool.status = ToolStatus::Cancelled;
                tool.result = Some(ToolResult::error("Discarded: streaming fallback"));
            }
            // Abort executing tasks to prevent orphaned background work.
            // (Dropping a JoinHandle only detaches — it does NOT cancel the task.)
            if let Some(handle) = tool.join_handle.take() {
                handle.abort();
            }
        }
    }

    /// Number of tools currently in the queue.
    pub fn queue_len(&self) -> usize {
        self.queue.len()
    }

    /// Number of tools currently executing.
    pub fn executing_count(&self) -> usize {
        self.queue
            .iter()
            .filter(|t| t.status == ToolStatus::Executing)
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::{
        CredentialInsert, CredentialResolver, CredentialStore, ResolutionScope, ScopeHint,
        ScopeKind, lifecycles::StaticSecretLifecycle,
    };
    use crate::tool_registry::ExecutionContext;
    use crate::traits::{ToolResult, ToolSpec};
    use async_trait::async_trait;

    /// Test tool that returns its name as output.
    struct EchoTool {
        tool_name: String,
        concurrent_safe: bool,
        delay_ms: u64,
    }

    #[async_trait]
    impl Tool for EchoTool {
        async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
            if self.delay_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(self.delay_ms)).await;
            }
            Ok(ToolResult::success(format!("echo:{}", self.tool_name)))
        }

        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: self.tool_name.clone(),
                description: "test".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }

        fn name(&self) -> &str {
            &self.tool_name
        }

        fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
            self.concurrent_safe
        }
    }

    /// Test tool that always errors but does NOT cascade to siblings.
    struct ErrorTool;

    #[async_trait]
    impl Tool for ErrorTool {
        async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::error("intentional error"))
        }

        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: "error_tool".into(),
                description: "test".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }

        fn name(&self) -> &str {
            "error_tool"
        }

        fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
            true
        }
    }

    /// Test tool that always errors AND cascades to siblings (like shell tools).
    struct CascadingErrorTool;

    #[async_trait]
    impl Tool for CascadingErrorTool {
        async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::error("cascading error"))
        }

        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: "cascading_error_tool".into(),
                description: "test".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }

        fn name(&self) -> &str {
            "cascading_error_tool"
        }

        fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
            true
        }

        fn cascades_error_to_siblings(&self) -> bool {
            true
        }
    }

    struct CredentialEchoTool;

    #[async_trait]
    impl Tool for CredentialEchoTool {
        async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::error("credential substrate missing"))
        }

        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: "credential_echo".into(),
                description: "test".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }

        fn name(&self) -> &str {
            "credential_echo"
        }

        fn required_credentials(&self) -> Vec<crate::credentials::CredentialNeed> {
            vec![crate::credentials::CredentialNeed::new(
                "test_provider",
                "token",
                ScopeHint::Agent,
            )]
        }

        async fn execute_with_credentials(
            &self,
            _args: serde_json::Value,
            credentials: Vec<Option<crate::credentials::UsableCredential>>,
        ) -> anyhow::Result<ToolResult> {
            let bearer = credentials
                .into_iter()
                .next()
                .flatten()
                .and_then(|cred| cred.bearer)
                .unwrap_or_else(|| "missing".to_string());
            Ok(ToolResult::success(bearer))
        }
    }

    #[tokio::test]
    async fn test_single_tool_execution() {
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool {
            tool_name: "read".into(),
            concurrent_safe: true,
            delay_ms: 0,
        })];

        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool("t1".into(), "read".into(), serde_json::json!({}))
            .await;

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "t1");
        assert_eq!(results[0].result.output, "echo:read");
        assert!(!results[0].result.is_error);
    }

    #[tokio::test]
    async fn credential_tools_resolve_trust_scope_for_streaming_execution() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        CredentialStore::initialize_schema(&conn).unwrap();
        let store = CredentialStore::new(
            Arc::new(std::sync::Mutex::new(conn)),
            crate::credentials::CredentialCipher::ephemeral(),
        );
        store
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Trust,
                scope_id: "trust-1".to_string(),
                provider: "test_provider".to_string(),
                name: "token".to_string(),
                lifecycle_kind: "static_secret".to_string(),
                plaintext_blob: b"secret-from-trust".to_vec(),
                metadata: serde_json::json!({}),
                expires_at: None,
            })
            .await
            .unwrap();

        let resolver = CredentialResolver::new(store, vec![Arc::new(StaticSecretLifecycle)]);
        let ctx = ExecutionContext {
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            credential_resolver: Some(resolver),
            credential_scope: ResolutionScope {
                agent_id: Some("agent-1".to_string()),
                trust_id: Some("trust-1".to_string()),
                ..Default::default()
            },
            ..Default::default()
        };

        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(CredentialEchoTool)];
        let mut executor = StreamingToolExecutor::new(tools).with_execution_context(ctx);
        executor
            .add_tool("t1".into(), "credential_echo".into(), serde_json::json!({}))
            .await;

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 1);
        assert!(!results[0].result.is_error);
        assert_eq!(results[0].result.output, "secret-from-trust");
    }

    #[tokio::test]
    async fn test_concurrent_safe_tools_parallel() {
        let tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(EchoTool {
                tool_name: "read".into(),
                concurrent_safe: true,
                delay_ms: 50,
            }),
            Arc::new(EchoTool {
                tool_name: "grep".into(),
                concurrent_safe: true,
                delay_ms: 50,
            }),
        ];

        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool("t1".into(), "read".into(), serde_json::json!({}))
            .await;
        executor
            .add_tool("t2".into(), "grep".into(), serde_json::json!({}))
            .await;

        // Both should be executing in parallel.
        assert_eq!(executor.executing_count(), 2);

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 2);
        // Results in tool-order (not completion order).
        assert_eq!(results[0].id, "t1");
        assert_eq!(results[1].id, "t2");
    }

    #[tokio::test]
    async fn test_non_concurrent_tool_blocks_queue() {
        let tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(EchoTool {
                tool_name: "read".into(),
                concurrent_safe: true,
                delay_ms: 0,
            }),
            Arc::new(EchoTool {
                tool_name: "edit".into(),
                concurrent_safe: false,
                delay_ms: 0,
            }),
            Arc::new(EchoTool {
                tool_name: "grep".into(),
                concurrent_safe: true,
                delay_ms: 0,
            }),
        ];

        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool("t1".into(), "read".into(), serde_json::json!({}))
            .await;
        executor
            .add_tool("t2".into(), "edit".into(), serde_json::json!({}))
            .await;
        executor
            .add_tool("t3".into(), "grep".into(), serde_json::json!({}))
            .await;

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].name, "read");
        assert_eq!(results[1].name, "edit");
        assert_eq!(results[2].name, "grep");
        assert!(results.iter().all(|r| !r.result.is_error));
    }

    #[tokio::test]
    async fn test_unknown_tool() {
        let tools: Vec<Arc<dyn Tool>> = vec![];
        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool("t1".into(), "nonexistent".into(), serde_json::json!({}))
            .await;

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 1);
        assert!(results[0].result.is_error);
        assert!(results[0].result.output.contains("Unknown tool"));
    }

    #[tokio::test]
    async fn test_cascading_error_cancels_siblings() {
        let tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(CascadingErrorTool),
            Arc::new(EchoTool {
                tool_name: "read".into(),
                concurrent_safe: true,
                delay_ms: 100, // Delayed so cascading error tool finishes first.
            }),
        ];

        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool(
                "t1".into(),
                "cascading_error_tool".into(),
                serde_json::json!({}),
            )
            .await;
        executor
            .add_tool("t2".into(), "read".into(), serde_json::json!({}))
            .await;

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 2);
        assert!(results[0].result.is_error); // cascading error tool errored
        assert!(results[1].result.is_error); // sibling cancelled
    }

    #[tokio::test]
    async fn test_non_cascading_error_does_not_cancel_siblings() {
        let tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(ErrorTool),
            Arc::new(EchoTool {
                tool_name: "read".into(),
                concurrent_safe: true,
                delay_ms: 100,
            }),
        ];

        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool("t1".into(), "error_tool".into(), serde_json::json!({}))
            .await;
        executor
            .add_tool("t2".into(), "read".into(), serde_json::json!({}))
            .await;

        let results = executor.finish_all().await;
        assert_eq!(results.len(), 2);
        assert!(results[0].result.is_error); // error_tool errored
        assert!(!results[1].result.is_error); // sibling NOT cancelled — read succeeded
    }

    #[tokio::test]
    async fn test_discard() {
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool {
            tool_name: "read".into(),
            concurrent_safe: true,
            delay_ms: 1000,
        })];

        let mut executor = StreamingToolExecutor::new(tools);
        executor
            .add_tool("t1".into(), "read".into(), serde_json::json!({}))
            .await;
        executor.discard();

        // Queued tools should be cancelled.
        assert_eq!(executor.queue_len(), 1);
    }
}
