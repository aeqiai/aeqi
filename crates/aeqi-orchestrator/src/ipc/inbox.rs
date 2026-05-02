//! Director-inbox IPC handlers.
//!
//! `handle_inbox` returns the list of sessions currently awaiting a human
//! reply, joined with agent name and root agent id. The HTTP `/api/inbox`
//! route proxies through here and returns the items array.
//!
//! `handle_answer_inbox` is the atomic answer-from-inbox path. It clears
//! `awaiting_at` and inserts a `user_reply` pending message in a single
//! transaction (race-safe across multi-director concurrency), then triggers
//! the existing `claim_and_run_loop` so the agent re-spawns and reads the
//! answer as a normal user message.
//!
//! Tenancy is enforced via the existing helpers — read-side via
//! `tenancy::allowed_agent_ids`, write-side via `tenancy::check_agent_access`.
//! Both work in platform mode (allowed_roots is `Some`) and runtime mode
//! (allowed_roots is `None`, which `allowed_agent_ids` interprets as "no
//! filter, return everything to the local operator").

use serde_json::{Value, json};

use super::tenancy;
use crate::queue_executor::QueuedMessage;
use crate::session_store::AwaitingSessionRow;

/// `inbox` command: list awaiting sessions.
///
/// Returns `{ ok: true, items: [InboxItem] }` where each item is enriched
/// with the agent name and the root agent id (walked via the agent registry
/// because the raw query in `SessionStore::list_awaiting` only knows the
/// session-level fields).
pub async fn handle_inbox(
    ctx: &super::CommandContext,
    _request: &Value,
    allowed: &Option<Vec<String>>,
) -> Value {
    let Some(ss) = &ctx.session_store else {
        return json!({"ok": false, "error": "session store unavailable"});
    };
    let agent_filter = tenancy::allowed_agent_ids(&ctx.agent_registry, allowed).await;
    let raw_rows = match ss.list_awaiting(agent_filter.as_ref()).await {
        Ok(items) => items,
        Err(e) => return json!({"ok": false, "error": format!("inbox query failed: {e}")}),
    };

    let mut items: Vec<Value> = Vec::with_capacity(raw_rows.len());
    for row in raw_rows {
        items.push(enrich_row(&ctx.agent_registry, row).await);
    }
    json!({"ok": true, "items": items})
}

/// Enrich the awaiting-session row with agent name and owning entity_id.
/// The entity is the canonical tenancy anchor — walking the position DAG
/// adds nothing the inbox UI uses today (it just wants "which company is
/// this from").
async fn enrich_row(
    agent_registry: &crate::agent_registry::AgentRegistry,
    row: AwaitingSessionRow,
) -> Value {
    let agent_id = row.agent_id.clone();
    let mut agent_name: Option<String> = None;
    let mut entity_id: Option<String> = None;
    if let Some(ref id) = agent_id
        && let Ok(Some(agent)) = agent_registry.get(id).await
    {
        agent_name = Some(agent.name.clone());
        entity_id = agent.entity_id.clone();
    }
    json!({
        "session_id": row.session_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "entity_id": entity_id,
        "session_name": row.session_name,
        "awaiting_subject": row.awaiting_subject,
        "awaiting_at": row.awaiting_at,
        "last_agent_message": row.last_agent_message,
    })
}

/// `answer_inbox` command: a director answers a pending question.
///
/// Request shape: `{ session_id: String, answer: String, sender_user_id?: String }`.
/// `sender_user_id` is optional and used for audit attribution.
///
/// Atomic flow (owned by `SessionStore::answer_awaiting`):
///   1. Tenancy gate — the requesting user must have access to the session's
///      agent (walking up the parent chain).
///   2. Build a `QueuedMessage::user_reply` payload.
///   3. Call `answer_awaiting` which, in a single transaction, clears
///      `awaiting_at` IFF non-null and INSERTs the pending row. Returns
///      `false` if someone else won the race.
///   4. On success, spawn the existing claim loop so the new pending row
///      gets picked up immediately (no waiting on the next periodic tick).
pub async fn handle_answer_inbox(
    ctx: &super::CommandContext,
    request: &Value,
    allowed: &Option<Vec<String>>,
) -> Value {
    let session_id = match request.get("session_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return json!({"ok": false, "error": "missing or empty session_id"}),
    };
    let answer = match request.get("answer").and_then(|v| v.as_str()) {
        Some(a) if !a.trim().is_empty() => a.to_string(),
        _ => return json!({"ok": false, "error": "missing or empty answer"}),
    };
    let sender_user_id = request
        .get("sender_user_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let Some(ss) = ctx.session_store.clone() else {
        return json!({"ok": false, "error": "session store unavailable"});
    };

    // Look up the session to discover its agent_id; the session row owns
    // the binding, not the request. Tenancy is enforced against the agent.
    let session = match ss.get_session(&session_id).await {
        Ok(Some(s)) => s,
        Ok(None) => return json!({"ok": false, "error": "session not found"}),
        Err(e) => return json!({"ok": false, "error": format!("session lookup failed: {e}")}),
    };
    let Some(agent_id) = session.agent_id.clone() else {
        return json!({"ok": false, "error": "session has no agent binding"});
    };
    if !tenancy::check_agent_access(&ctx.agent_registry, allowed, &agent_id).await {
        return json!({"ok": false, "error": "access denied"});
    }

    // Build the typed payload. The agent_hint uses the agent_id directly so
    // the executor's resolution path doesn't have to disambiguate names.
    let qm = QueuedMessage::user_reply(agent_id, answer, sender_user_id);
    let payload = match qm.to_payload() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": format!("payload encode failed: {e}")}),
    };

    let won = match ss.answer_awaiting(&session_id, &payload).await {
        Ok(b) => b,
        Err(e) => return json!({"ok": false, "error": format!("answer failed: {e}")}),
    };
    if !won {
        return json!({"ok": false, "error": "already answered"});
    }

    // Trigger the existing claim loop so the new pending row is picked up
    // without waiting for an external tick. We assemble the same
    // QueueExecutor shape every other IPC handler does (web chat, etc.) so
    // the inbox-answer path executes against the identical machinery as a
    // user typing in the session view.
    if let Some(provider) = ctx.default_provider.clone() {
        let executor: std::sync::Arc<dyn crate::session_queue::SessionExecutor> =
            std::sync::Arc::new(crate::queue_executor::QueueExecutor {
                session_manager: ctx.session_manager.clone(),
                agent_registry: ctx.agent_registry.clone(),
                stream_registry: ctx.stream_registry.clone(),
                execution_registry: ctx.execution_registry.clone(),
                provider,
                activity_log: Some(ctx.activity_log.clone()),
                session_store: ctx.session_store.clone(),
                idea_store: ctx.idea_store.clone(),
                adaptive_retry: ctx.dispatcher.config.adaptive_retry,
                failure_analysis_model: ctx.dispatcher.config.failure_analysis_model.clone(),
                extra_tools: Vec::new(),
                pattern_dispatcher: ctx.pattern_dispatcher.clone(),
            });
        crate::session_queue::spawn_claim_loop(ss, executor, session_id.clone());
    } else {
        // No provider configured — the daemon is in a degraded state. The
        // pending row is persisted; whatever crash-recovery boot path runs
        // next will pick it up.
        tracing::warn!(
            session_id = %session_id,
            "answer_inbox: no default_provider; pending row persisted, claim loop deferred"
        );
    }

    json!({"ok": true, "session_id": session_id})
}

/// `dismiss_inbox` command: archive a pending question without queueing a reply.
///
/// Request shape: `{ session_id: String }`.
///
/// Clears `awaiting_at` and `awaiting_subject` atomically. Returns
/// `{ ok: true, dismissed: bool }` where `dismissed` is `true` only when the
/// row was actually awaiting (i.e. the caller won the race). Does NOT insert
/// a pending message — the agent stays silent until something else triggers it.
pub async fn handle_dismiss_inbox(
    ctx: &super::CommandContext,
    request: &Value,
    allowed: &Option<Vec<String>>,
) -> Value {
    let session_id = match request.get("session_id").and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return json!({"ok": false, "error": "missing or empty session_id"}),
    };

    let Some(ss) = ctx.session_store.clone() else {
        return json!({"ok": false, "error": "session store unavailable"});
    };

    // Tenancy: look up the session's agent and verify scope access.
    let session = match ss.get_session(&session_id).await {
        Ok(Some(s)) => s,
        Ok(None) => return json!({"ok": false, "error": "session not found"}),
        Err(e) => return json!({"ok": false, "error": format!("session lookup failed: {e}")}),
    };
    let Some(agent_id) = session.agent_id.clone() else {
        return json!({"ok": false, "error": "session has no agent binding"});
    };
    if !tenancy::check_agent_access(&ctx.agent_registry, allowed, &agent_id).await {
        return json!({"ok": false, "error": "access denied"});
    }

    let dismissed = match ss.dismiss_awaiting(&session_id).await {
        Ok(b) => b,
        Err(e) => return json!({"ok": false, "error": format!("dismiss failed: {e}")}),
    };

    json!({"ok": true, "session_id": session_id, "dismissed": dismissed})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::CommandContext;
    use std::sync::Arc;

    async fn test_ctx() -> (
        CommandContext,
        Arc<crate::session_store::SessionStore>,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let registry = Arc::new(crate::agent_registry::AgentRegistry::open(dir.path()).unwrap());
        let sessions_pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = sessions_pool.lock().await;
            crate::session_store::SessionStore::create_tables(&conn).unwrap();
        }
        let ss = Arc::new(crate::session_store::SessionStore::new(Arc::new(
            sessions_pool,
        )));
        let ideas: Arc<dyn aeqi_core::traits::IdeaStore> =
            Arc::new(aeqi_ideas::SqliteIdeas::open(&dir.path().join("aeqi.db"), 30.0).unwrap());
        let ctx = build_test_ctx(Arc::clone(&registry), Arc::clone(&ss), ideas);
        (ctx, ss, dir)
    }

    fn build_test_ctx(
        registry: Arc<crate::agent_registry::AgentRegistry>,
        ss: Arc<crate::session_store::SessionStore>,
        idea_store: Arc<dyn aeqi_core::traits::IdeaStore>,
    ) -> CommandContext {
        use crate::dispatch::{DispatchConfig, Dispatcher};
        use crate::ipc::ActivityBuffer;
        use tokio::sync::Mutex;

        let (embed_queue, _rx) = aeqi_ideas::embed_worker::EmbedQueue::channel(8);

        CommandContext {
            metrics: Arc::new(crate::metrics::AEQIMetrics::new()),
            activity_log: Arc::new(crate::activity_log::ActivityLog::new(registry.db())),
            session_store: Some(ss),
            event_handler_store: None,
            agent_registry: registry.clone(),
            entity_registry: Arc::new(crate::entity_registry::EntityRegistry::open(registry.db())),
            position_registry: Arc::new(crate::position_registry::PositionRegistry::open(
                registry.db(),
            )),
            idea_store: Some(idea_store),
            message_router: None,
            activity_buffer: Arc::new(Mutex::new(ActivityBuffer::default())),
            default_provider: None,
            default_model: "test".to_string(),
            session_manager: Arc::new(crate::session_manager::SessionManager::new()),
            dispatcher: Arc::new(Dispatcher::new(DispatchConfig::default())),
            daily_budget_usd: 0.0,
            skill_loader: None,
            execution_registry: Arc::new(crate::execution_registry::ExecutionRegistry::new()),
            stream_registry: Arc::new(crate::stream_registry::StreamRegistry::new()),
            channel_spawner: None,
            tag_policy_cache: Arc::new(aeqi_ideas::tag_policy::TagPolicyCache::new(60)),
            embed_queue: Arc::new(embed_queue),
            embedder: None,
            recall_cache: Arc::new(aeqi_ideas::RecallCache::default()),
            pattern_dispatcher: None,
            credentials: None,
        }
    }

    #[tokio::test]
    async fn dismiss_inbox_clears_awaiting_and_returns_dismissed_true() {
        let (ctx, ss, _dir) = test_ctx().await;

        // Spawn an agent so tenancy resolves.
        let agent = ctx
            .agent_registry
            .spawn("test-agent", None, None)
            .await
            .unwrap();

        let session_id = ss
            .create_session(&agent.id, "thread", "test-session", None, None)
            .await
            .unwrap();

        // Mark the session as awaiting.
        ss.set_awaiting(&session_id, "test question")
            .await
            .unwrap();

        let req = serde_json::json!({"session_id": session_id});
        let resp = handle_dismiss_inbox(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["dismissed"], true);

        // Verify awaiting_at is cleared (session should no longer appear in inbox).
        let awaiting = ss.list_awaiting(None).await.unwrap();
        assert!(
            awaiting.iter().all(|r| r.session_id != session_id),
            "session must not appear in inbox after dismiss"
        );
    }

    #[tokio::test]
    async fn dismiss_inbox_returns_dismissed_false_when_not_awaiting() {
        let (ctx, ss, _dir) = test_ctx().await;

        let agent = ctx
            .agent_registry
            .spawn("test-agent-b", None, None)
            .await
            .unwrap();

        let session_id = ss
            .create_session(&agent.id, "thread", "test-session-2", None, None)
            .await
            .unwrap();

        // Session is not awaiting — dismiss should return dismissed=false.
        let req = serde_json::json!({"session_id": session_id});
        let resp = handle_dismiss_inbox(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["dismissed"], false);
    }

    #[tokio::test]
    async fn dismiss_inbox_missing_session_id_returns_error() {
        let (ctx, _ss, _dir) = test_ctx().await;
        let resp = handle_dismiss_inbox(&ctx, &serde_json::json!({}), &None).await;
        assert_eq!(resp["ok"], false);
        assert!(resp["error"].as_str().unwrap().contains("session_id"));
    }
}
