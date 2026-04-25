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

/// Walk the agent's parent chain to find the root, and look up the agent
/// name. Both fields are useful row metadata for the inbox UI; doing it
/// here keeps the SessionStore query free of agent-graph awareness.
///
/// Defensive caps: walks at most 16 levels (matches `tenancy::check_agent_access`
/// neighborhood — agent trees are not expected to be deeper than this).
async fn enrich_row(
    agent_registry: &crate::agent_registry::AgentRegistry,
    row: AwaitingSessionRow,
) -> Value {
    let agent_id = row.agent_id.clone();
    let mut agent_name: Option<String> = None;
    let mut root_agent_id: Option<String> = None;
    if let Some(ref id) = agent_id {
        // Look up the immediate agent for the display name.
        if let Ok(Some(agent)) = agent_registry.get(id).await {
            agent_name = Some(agent.name.clone());
            // Walk to the root.
            let mut cursor: Option<String> = Some(agent.id.clone());
            let mut depth = 0;
            while let Some(curr) = cursor {
                if depth > 16 {
                    break;
                }
                match agent_registry.get(&curr).await.ok().flatten() {
                    Some(a) => match a.parent_id {
                        Some(pid) => {
                            cursor = Some(pid);
                            depth += 1;
                        }
                        None => {
                            root_agent_id = Some(a.id);
                            break;
                        }
                    },
                    None => break,
                }
            }
        }
    }
    json!({
        "session_id": row.session_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "root_agent_id": root_agent_id,
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
