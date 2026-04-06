//! No-op provider — returns errors. Used when no real provider is configured.

use aeqi_core::traits::{ChatRequest, ChatResponse, Provider};
use async_trait::async_trait;

pub struct NoopProvider;

#[async_trait]
impl Provider for NoopProvider {
    async fn chat(&self, _request: &ChatRequest) -> anyhow::Result<ChatResponse> {
        anyhow::bail!("no LLM provider configured")
    }

    fn name(&self) -> &str {
        "noop"
    }

    async fn health_check(&self) -> anyhow::Result<()> {
        Ok(())
    }
}
