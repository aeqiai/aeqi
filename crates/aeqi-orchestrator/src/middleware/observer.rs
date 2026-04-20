//! Observer that bridges the middleware chain into the agent loop.
//!
//! Extracted from `agent_worker` so `spawn_session` (Phase 2+) can attach the
//! same bridge without pulling in worker state. The public entry point is
//! [`MiddlewareObserver::new`].
//!
//! Maintains a per-observer `WorkerContext` under a `tokio::sync::Mutex`. Each
//! `before_tool` stashes the serialized tool input so that the matching
//! `after_tool` can reconstruct the full `ToolCall` (input + output) for
//! middleware — the `Observer` trait's `after_tool` signature doesn't carry
//! the input by itself.

use std::sync::Arc;

use aeqi_core::traits::{Event, LoopAction, Observer};
use async_trait::async_trait;

use super::{
    MiddlewareAction, MiddlewareChain, ToolCall as MwToolCall, ToolResult as MwToolResult,
    WorkerContext,
};

pub struct MiddlewareObserver {
    chain: Arc<MiddlewareChain>,
    ctx: tokio::sync::Mutex<WorkerContext>,
    inner: Arc<dyn Observer>,
    last_tool_input: tokio::sync::Mutex<String>,
}

impl MiddlewareObserver {
    pub fn new(chain: Arc<MiddlewareChain>, ctx: WorkerContext, inner: Arc<dyn Observer>) -> Self {
        Self {
            chain,
            ctx: tokio::sync::Mutex::new(ctx),
            inner,
            last_tool_input: tokio::sync::Mutex::new(String::new()),
        }
    }

    fn map_action(action: MiddlewareAction) -> LoopAction {
        match action {
            MiddlewareAction::Continue | MiddlewareAction::Skip => LoopAction::Continue,
            MiddlewareAction::Halt(reason) => LoopAction::Halt(reason),
        }
    }
}

#[async_trait]
impl Observer for MiddlewareObserver {
    async fn record(&self, event: Event) {
        self.inner.record(event).await;
    }

    fn name(&self) -> &str {
        "middleware-bridge"
    }

    async fn before_model(&self, _iteration: u32) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        Self::map_action(self.chain.run_before_model(&mut ctx).await)
    }

    async fn after_model(
        &self,
        _iteration: u32,
        prompt_tokens: u32,
        completion_tokens: u32,
    ) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        ctx.cost_usd += aeqi_providers::estimate_cost(&ctx.model, prompt_tokens, completion_tokens);
        Self::map_action(self.chain.run_after_model(&mut ctx).await)
    }

    async fn before_tool(&self, tool_name: &str, input: &serde_json::Value) -> LoopAction {
        let input_str = input.to_string();
        *self.last_tool_input.lock().await = input_str.clone();
        let mut ctx = self.ctx.lock().await;
        let call = MwToolCall {
            name: tool_name.to_string(),
            input: input_str,
        };
        Self::map_action(self.chain.run_before_tool(&mut ctx, &call).await)
    }

    async fn after_tool(&self, tool_name: &str, output: &str, is_error: bool) -> LoopAction {
        let input = self.last_tool_input.lock().await.clone();
        let mut ctx = self.ctx.lock().await;
        let call = MwToolCall {
            name: tool_name.to_string(),
            input,
        };
        let result = MwToolResult {
            success: !is_error,
            output: output.chars().take(500).collect(),
        };
        ctx.tool_call_history.push(call.clone());
        Self::map_action(self.chain.run_after_tool(&mut ctx, &call, &result).await)
    }

    async fn on_error(&self, _iteration: u32, error: &str) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        Self::map_action(self.chain.run_on_error(&mut ctx, error).await)
    }

    async fn after_step(
        &self,
        _iteration: u32,
        response_text: &str,
        stop_reason: &str,
    ) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        Self::map_action(
            self.chain
                .run_after_step(&mut ctx, response_text, stop_reason)
                .await,
        )
    }

    async fn collect_attachments(
        &self,
        _iteration: u32,
    ) -> Vec<aeqi_core::traits::ContextAttachment> {
        let mut ctx = self.ctx.lock().await;
        self.chain.run_collect_enrichments(&mut ctx).await
    }
}
