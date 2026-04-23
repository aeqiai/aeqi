use anyhow::Result;
use async_trait::async_trait;

/// A single user message injected at a step boundary.
///
/// Returned by [`PendingMessageSource::claim_pending_for_session`]. The `id`
/// is the `pending_messages` row id and is used to advance `last_pending_id`
/// so subsequent boundaries do not re-claim the same rows.
#[derive(Debug, Clone)]
pub struct InjectedMessage {
    /// `pending_messages.id` — used to advance the watermark.
    pub id: i64,
    /// Raw message text.
    pub content: String,
}

/// Source of user messages that can be injected at agent step boundaries.
///
/// Implemented by `SessionStore` in `aeqi-orchestrator`. Declared here so
/// `aeqi-core` can use it without creating a circular dependency.
///
/// The contract: return all `queued` rows for `session_id` whose `id` is
/// greater than `since_id` (or all queued rows when `since_id` is `None`).
/// Each returned row must be atomically consumed so the main drain loop
/// cannot also claim it for the next turn.
#[async_trait]
pub trait PendingMessageSource: Send + Sync {
    async fn claim_pending_for_session(
        &self,
        session_id: &str,
        since_id: Option<i64>,
    ) -> Result<Vec<InjectedMessage>>;
}
