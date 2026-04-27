//! Concrete [`SessionExecutor`] that drains a session's pending queue by
//! calling [`SessionManager::spawn_session`] once per claimed payload.
//!
//! For each claimed row the executor:
//!   1. Deserializes the payload (see [`QueuedMessage`]).
//!   2. Looks up — or creates — the per-session broadcast sender in
//!      [`StreamRegistry`] so IPC subscribers get the events.
//!   3. Calls `spawn_session` to build and launch the agent.
//!   4. Registers an [`ExecutionHandle`] so IPC stop/auto-commit can reach
//!      the running agent.
//!   5. Awaits the agent's `join_handle` directly — no polling.
//!   6. Unregisters the handle and tears down the sandbox.
//!
//! Ownership: the executor owns the sandbox `Arc` for teardown; the registry
//! holds a clone for auto-commit access. Cancel from IPC only flips the
//! cancel token — the executor's `.await` unwinds and runs teardown.
//!
//! Quest runs (`kind == "quest"`) travel this same rail. They enter the queue
//! via [`crate::quest_enqueuer::QuestEnqueuer`] and are distinguished by the
//! presence of `quest_id`. The executor attaches the universal middleware
//! chain via `SpawnOptions::with_quest + with_budget`, then on completion
//! writes quest status, emits the `quest_completed` / `quest_result` events,
//! and (if the spawn carried a `creator_session_id`) re-enqueues the result
//! text into the creator session's queue — the completion semantics the
//! retired scheduler provided, minus the RunningSession orchestration.

use std::sync::Arc;

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use aeqi_core::traits::{IdeaStore, Provider};

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::execution_registry::{ExecutionHandle, ExecutionRegistry};
use crate::failure_analysis::FailureMode;
use crate::failure_classifier::{ClassifyInputs, classify_failure};
use crate::session_manager::{SessionManager, SpawnOptions};
use crate::session_queue::SessionExecutor;
use crate::session_store::{PendingClaim, SessionStore};
use crate::stream_registry::StreamRegistry;

/// Payload persisted in `pending_messages.payload`. Every field required to
/// reconstruct the original `session_send` call is captured here so a claim
/// can be executed even after a daemon restart.
///
/// `kind` distinguishes chat messages (default, omitted in older payloads)
/// from quest runs. Quest payloads set `kind = "quest"` and carry `quest_id`
/// plus the optional `creator_session_id` so completion can re-enqueue the
/// result text to whoever asked for the quest. The extra fields are
/// `#[serde(default)]` so pre-existing rows deserialize unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedMessage {
    /// Agent UUID when known, or a name hint.
    pub agent_hint: String,
    /// User text.
    pub message: String,
    /// Sender identity (resolved via `session_store::resolve_sender`).
    pub sender_id: Option<String>,
    /// Originating transport: "web", "telegram", "ipc", etc.
    pub transport: Option<String>,
    /// Payload kind — `None` or `"chat"` for the legacy path, `"quest"` for
    /// quest runs scheduled by `QuestEnqueuer`.
    #[serde(default)]
    pub kind: Option<String>,
    /// Quest id — set when `kind == "quest"`.
    #[serde(default)]
    pub quest_id: Option<String>,
    /// Session that originally created the quest. When set, the executor
    /// re-enqueues the quest result into that session's pending queue so
    /// `session:quest_result` events can fire there.
    #[serde(default)]
    pub creator_session_id: Option<String>,
    /// Per-run budget ceiling in USD. Forwarded into `SpawnOptions` for
    /// quest runs so the universal middleware chain's `CostTrackingMiddleware`
    /// enforces the cap.
    #[serde(default)]
    pub budget_usd: Option<f64>,
    /// The enqueuer already persisted the initial user-message row (with
    /// channel-specific metadata it has but the session manager doesn't —
    /// e.g. WhatsApp's `{jid, message_id, from_me, participant}`). When
    /// set, `QueueExecutor::execute` tells `spawn_session` to skip its
    /// own user-message write so the row isn't duplicated. Legacy rows
    /// without this flag default to `false`, preserving existing behavior
    /// for web chat and quest runs.
    #[serde(default)]
    pub initial_message_recorded: bool,
    /// Director-inbox attribution: the user id that authored a `user_reply`
    /// payload. Optional and `#[serde(default)]` so legacy rows deserialize
    /// untouched. Audit-only today; future role checks read it.
    #[serde(default)]
    pub source_user_id: Option<String>,
}

impl QueuedMessage {
    /// Chat-style payload — the shape used for every non-quest enqueue path
    /// (web IPC, telegram gateway, executor→creator injection). Quest fields
    /// default to `None`.
    pub fn chat(
        agent_hint: impl Into<String>,
        message: impl Into<String>,
        sender_id: Option<String>,
        transport: Option<String>,
    ) -> Self {
        Self {
            agent_hint: agent_hint.into(),
            message: message.into(),
            sender_id,
            transport,
            kind: None,
            quest_id: None,
            creator_session_id: None,
            budget_usd: None,
            initial_message_recorded: false,
            source_user_id: None,
        }
    }

    /// Mark the initial message as already persisted by the enqueuer.
    /// Used by channel gateways (WhatsApp, Telegram) that pre-record the
    /// inbound message with channel-specific metadata before enqueueing.
    pub fn with_initial_message_recorded(mut self) -> Self {
        self.initial_message_recorded = true;
        self
    }

    /// Quest-run payload — enqueued by [`crate::quest_enqueuer::QuestEnqueuer`]
    /// when a ready quest needs a worker. `budget_usd` is forwarded into
    /// `SpawnOptions` so the middleware chain's cost tracker enforces it.
    pub fn quest(
        agent_hint: impl Into<String>,
        message: impl Into<String>,
        quest_id: impl Into<String>,
        creator_session_id: Option<String>,
        budget_usd: Option<f64>,
    ) -> Self {
        Self {
            agent_hint: agent_hint.into(),
            message: message.into(),
            sender_id: None,
            transport: Some("quest".to_string()),
            kind: Some("quest".to_string()),
            quest_id: Some(quest_id.into()),
            creator_session_id,
            budget_usd,
            initial_message_recorded: false,
            source_user_id: None,
        }
    }

    /// Director-inbox reply payload. Built when a user answers a `question.ask`
    /// from the home-page inbox: the answer body is the user's text; the
    /// `transport` is `"inbox"` so downstream activity emits the right channel
    /// label; the `source_user_id` carries the answering director for audit.
    /// Routing is identical to a chat reply — the executor's existing path
    /// re-enters `spawn_session`, the agent reads the message at the next
    /// step boundary as a normal user message.
    pub fn user_reply(
        agent_hint: impl Into<String>,
        message: impl Into<String>,
        source_user_id: Option<String>,
    ) -> Self {
        Self {
            agent_hint: agent_hint.into(),
            message: message.into(),
            sender_id: source_user_id.clone(),
            transport: Some("inbox".to_string()),
            kind: Some("user_reply".to_string()),
            quest_id: None,
            creator_session_id: None,
            budget_usd: None,
            initial_message_recorded: false,
            source_user_id,
        }
    }

    pub fn to_payload(&self) -> Result<String> {
        serde_json::to_string(self).context("serializing QueuedMessage payload")
    }

    pub fn from_payload(s: &str) -> Result<Self> {
        serde_json::from_str(s).context("deserializing QueuedMessage payload")
    }

    pub fn is_quest(&self) -> bool {
        self.kind.as_deref() == Some("quest") && self.quest_id.is_some()
    }

    pub fn is_user_reply(&self) -> bool {
        self.kind.as_deref() == Some("user_reply")
    }
}

/// Executor used by [`session_queue::claim_and_run_loop`].
pub struct QueueExecutor {
    pub session_manager: Arc<SessionManager>,
    pub agent_registry: Arc<AgentRegistry>,
    pub stream_registry: Arc<StreamRegistry>,
    pub execution_registry: Arc<ExecutionRegistry>,
    pub provider: Arc<dyn Provider>,
    /// Used to emit `quest_completed` / `quest_result` events on quest runs.
    pub activity_log: Option<Arc<ActivityLog>>,
    /// Raw session store — needed to re-enqueue a quest result into the
    /// creator session without round-tripping through a second executor Arc.
    pub session_store: Option<Arc<SessionStore>>,
    /// Shared idea store — used by `session:quest_result` assembly.
    pub idea_store: Option<Arc<dyn IdeaStore>>,
    /// When true, run `classify_failure` against the provider before deciding
    /// the terminal status on a failed quest run. The classifier can escalate
    /// a retry to Blocked (`ExternalBlocker`, `BudgetExhausted`) and enrich
    /// the quest description with context for the next attempt.
    pub adaptive_retry: bool,
    /// Model used for failure classification. Empty disables the classifier
    /// even when `adaptive_retry` is true.
    pub failure_analysis_model: String,
    /// Channel-specific tools injected by gateway spawners (e.g. whatsapp_reply,
    /// telegram_react). These are forwarded into `SpawnOptions::extra_tools` so
    /// only sessions driven by this executor's channel receive them.
    pub extra_tools: Vec<Arc<dyn aeqi_core::traits::Tool>>,
    /// Daemon-level pattern dispatcher used to fire `session:quest_end` when
    /// the autonomous worker finalizes a quest as `Done`. Without this, the
    /// queue-driven completion path is a third dead end for the reflection
    /// loop — `finalize_quest` only flips the row state, no event chain runs.
    /// `None` degrades silently (no dispatch, just a warn-log).
    pub pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
}

#[async_trait]
impl SessionExecutor for QueueExecutor {
    async fn execute(&self, session_id: &str, claim: &PendingClaim) -> Result<()> {
        let queued = QueuedMessage::from_payload(&claim.payload)?;

        // The same sender the IPC subscriber is listening on. Created-or-reused
        // so a late executor still publishes to the right bus.
        let stream_sender = self.stream_registry.get_or_create(session_id).await;

        // auto_close=false matches the old `interactive()` SpawnOptions for web.
        // spawn_session records the initial user-message row itself for web
        // chat and quest runs, so the `event_fired` rows for session:start /
        // session:execution_start sort BEFORE the user message in the
        // timeline. Channel gateways (WhatsApp, Telegram) pre-record the
        // inbound message with channel metadata before enqueueing, and set
        // `initial_message_recorded` so we skip spawn_session's write and
        // avoid a duplicate row.
        let mut opts = SpawnOptions::interactive()
            .with_session_id(session_id.to_string())
            .with_stream_sender(stream_sender)
            .with_extra_tools(self.extra_tools.clone())
            // Pass the claim id as the step-boundary injection watermark.
            // The agent loop will only inject pending rows with id > this value,
            // so it never re-claims the row that triggered this very turn.
            .with_starting_pending_id(claim.id);
        if queued.initial_message_recorded {
            opts = opts.without_initial_message_record();
        }
        if let Some(ref s) = queued.sender_id {
            opts = opts.with_sender_id(s.clone());
        }
        if let Some(ref t) = queued.transport {
            opts = opts.with_transport(t.clone());
        }
        // Quest branch: attach the universal middleware chain and the budget.
        // `with_quest` makes spawn_session treat this session as a quest run,
        // which pulls in the sandbox worktree, the middleware chain, and the
        // quest_id linkage on the DB row.
        if queued.is_quest() {
            if let Some(ref qid) = queued.quest_id {
                opts = opts.with_quest(qid.clone());
            }
            if let Some(b) = queued.budget_usd {
                opts = opts.with_budget(b);
            }
        }

        let spawned = self
            .session_manager
            .spawn_session(
                &queued.agent_hint,
                &queued.message,
                self.provider.clone(),
                opts,
            )
            .await
            .context("queue executor: spawn_session failed")?;

        // Forward any events that fired during session assembly onto the live
        // wire. Their broadcast channel had no subscribers when they fired,
        // so a direct send at emit time would have been lost.
        for event in spawned.initial_events {
            spawned.stream_sender.send(event);
        }

        // Register the execution so IPC stop / auto-commit can reach it.
        let sandbox = spawned.sandbox.clone();
        self.execution_registry
            .register(ExecutionHandle {
                session_id: spawned.session_id.clone(),
                agent_id: spawned.agent_id.clone(),
                agent_name: spawned.agent_name.clone(),
                correlation_id: spawned.correlation_id.clone(),
                cancel_token: spawned.cancel_token.clone(),
                sandbox: sandbox.clone(),
                quest_id: queued.quest_id.clone(),
                started_at: std::time::Instant::now(),
            })
            .await;

        // Block until the agent task finishes. A `JoinError` (panic / cancel)
        // propagates via `context`; an agent error propagates as `Err`.
        let run_result = spawned
            .join_handle
            .await
            .context("queue executor: agent task panicked or was cancelled");

        // Always unregister — whether the run succeeded, errored, or panicked.
        self.execution_registry
            .unregister(&spawned.session_id)
            .await;

        // Persist the final assistant message for non-web transports.
        //
        // `SpawnOptions::interactive()` above makes `spawn_session` skip its
        // own persistence branch — the assumption being that a live IPC
        // stream subscriber will drain `StepComplete` / `Complete` events
        // into `session_messages` instead. That's true for web chat, but
        // quest runs and other headless transports have no subscriber, so
        // without this write the sub-agent output vanishes entirely
        // (observable empty transcripts on the agent detail page).
        //
        // Scoped to `transport != Some("web")` so web chat isn't
        // double-persisted by this path and the IPC reader in parallel.
        if queued.transport.as_deref() != Some("web")
            && let (Ok(Ok(result)), Some(ss)) = (&run_result, self.session_store.as_ref())
            && !result.text.is_empty()
        {
            let agent_sender = ss
                .resolve_sender(
                    "agent",
                    &spawned.agent_id,
                    &spawned.agent_name,
                    None,
                    None,
                    None,
                )
                .await
                .ok();
            let sender_id = agent_sender.as_ref().map(|s| s.id.as_str());
            let transport = queued.transport.as_deref().unwrap_or("internal");
            if let Err(e) = ss
                .record_event_by_session_with_sender(
                    &spawned.session_id,
                    "message",
                    "assistant",
                    &result.text,
                    Some("session"),
                    None,
                    sender_id,
                    Some(transport),
                )
                .await
            {
                warn!(session = %spawned.session_id, error = %e, "failed to persist assistant message");
            }
        }

        // Quest-specific completion writes: update quest status, emit
        // `quest_completed` + `quest_result` events, re-enqueue the result
        // into the creator session so `session:quest_result` can fire there,
        // auto-commit the worktree, and tear down on terminal outcomes.
        // spawn_session already wired the middleware chain and sandbox.
        if queued.is_quest() {
            let quest_id = queued
                .quest_id
                .as_deref()
                .expect("is_quest() guaranteed quest_id.is_some()");
            let (outcome_status, final_text) = match &run_result {
                Ok(Ok(r)) => {
                    let s = match &r.stop_reason {
                        aeqi_core::agent::AgentStopReason::EndTurn => "done",
                        aeqi_core::agent::AgentStopReason::FallbackActivated => "done",
                        aeqi_core::agent::AgentStopReason::MaxIterations => "retry",
                        aeqi_core::agent::AgentStopReason::Halted(_) => "retry",
                        aeqi_core::agent::AgentStopReason::ContextExhausted => "retry",
                        aeqi_core::agent::AgentStopReason::ApiError(_) => "error",
                        aeqi_core::agent::AgentStopReason::Cancelled => "error",
                    };
                    (s, r.text.clone())
                }
                Ok(Err(e)) => ("error", format!("agent error: {e}")),
                Err(e) => ("error", format!("task error: {e}")),
            };

            let mut terminal_status = match outcome_status {
                "done" => aeqi_quests::QuestStatus::Done,
                "blocked" => aeqi_quests::QuestStatus::Blocked,
                "retry" => aeqi_quests::QuestStatus::Pending,
                _ => aeqi_quests::QuestStatus::Pending,
            };

            // Adaptive retry: on failure, ask the classifier to label the
            // mode and enrich the quest description so the next worker sees
            // the analysis instead of starting blind. External blockers and
            // budget exhaustion escalate straight to Blocked.
            if self.adaptive_retry
                && !self.failure_analysis_model.is_empty()
                && terminal_status == aeqi_quests::QuestStatus::Pending
                && outcome_status != "done"
                && let Some(ref al) = self.activity_log
            {
                let quest_for_subject = self.agent_registry.get_task(quest_id).await.ok().flatten();
                let subject = match (&quest_for_subject, self.idea_store.as_ref()) {
                    (Some(q), Some(store)) if q.idea_id.is_some() => {
                        let id = q.idea_id.as_ref().unwrap();
                        store
                            .get_by_ids(std::slice::from_ref(id))
                            .await
                            .ok()
                            .and_then(|mut v| v.pop())
                            .map(|i| i.name)
                            .unwrap_or_default()
                    }
                    _ => String::new(),
                };
                let classification = classify_failure(
                    &self.provider,
                    &self.failure_analysis_model,
                    al,
                    ClassifyInputs {
                        subject: &subject,
                        description: &final_text,
                        error_text: &final_text,
                        quest_id,
                        agent_name: &spawned.agent_name,
                        worker_name: &spawned.agent_name,
                    },
                )
                .await;
                if let Some((enrichment, mode)) = classification {
                    if matches!(
                        mode,
                        FailureMode::ExternalBlocker | FailureMode::BudgetExhausted
                    ) {
                        terminal_status = aeqi_quests::QuestStatus::Blocked;
                    }
                    // Append enrichment to the linked idea body so the
                    // editorial surface reflects the failure context (the
                    // canonical place post-WS-8).
                    let enrich_target = self
                        .agent_registry
                        .get_task(quest_id)
                        .await
                        .ok()
                        .flatten()
                        .and_then(|q| q.idea_id);
                    if let (Some(id), Some(store)) = (enrich_target, self.idea_store.as_ref())
                        && let Ok(mut ideas) = store.get_by_ids(std::slice::from_ref(&id)).await
                        && let Some(existing) = ideas.pop()
                    {
                        let new_content = format!("{}{}", existing.content, enrichment);
                        if let Err(e) = store.update(&id, None, Some(&new_content), None).await {
                            warn!(task = %quest_id, error = %e, "failed to enrich quest idea body");
                        }
                    }
                }
            }

            // Single transaction: status flip + retry bump + closed_at stamp.
            // `bump_retry` only fires on the Pending path, so
            // `max_task_retries` eventually halts the cycle.
            let bump_retry = terminal_status == aeqi_quests::QuestStatus::Pending;
            let finalize_ok = match self
                .agent_registry
                .finalize_quest(quest_id, terminal_status, bump_retry)
                .await
            {
                Ok(_) => true,
                Err(e) => {
                    warn!(task = %quest_id, error = %e, "failed to finalize quest {terminal_status:?}");
                    false
                }
            };

            // Fire `session:quest_end` through the daemon-level pattern
            // dispatcher when the autonomous worker finalizes a quest as
            // `Done`, so the seeded reflect-after-quest chain (session.spawn
            // → ideas.store_many) runs from this third completion path too.
            // Mirrors the IPC and LLM tool-close paths.
            if finalize_ok && terminal_status == aeqi_quests::QuestStatus::Done {
                let quest_after = self.agent_registry.get_task(quest_id).await.ok().flatten();
                dispatch_quest_end_for_queue_finalize(
                    self.pattern_dispatcher.as_ref(),
                    quest_id,
                    &final_text,
                    quest_after.as_ref(),
                    &spawned.session_id,
                    &spawned.agent_id,
                )
                .await;
            }

            // Emit quest_completed on the shared ActivityLog so the daemon's
            // event dispatch re-runs scheduling (event-driven fanout).
            if let Some(ref al) = self.activity_log {
                let _ = al
                    .emit(
                        "quest_completed",
                        Some(&spawned.agent_id),
                        Some(&spawned.session_id),
                        Some(quest_id),
                        &serde_json::json!({
                            "agent_name": spawned.agent_name,
                            "outcome": outcome_status,
                        }),
                    )
                    .await;
            }

            // Creator-session fanout: if the quest was scheduled with a
            // creator_session_id, re-enqueue the result text into that
            // session's pending queue so `session:quest_result` can fire.
            if let (Some(creator), Some(ss)) = (
                queued.creator_session_id.as_deref(),
                self.session_store.as_ref(),
            ) {
                let base = format!(
                    "Quest {} completed ({}): {} — {}",
                    quest_id, outcome_status, spawned.agent_name, final_text,
                );
                let creator_payload = QueuedMessage::chat(
                    spawned.agent_id.clone(),
                    base,
                    None,
                    Some("scheduler".to_string()),
                );
                match creator_payload.to_payload() {
                    Ok(p) => {
                        let self_executor: Arc<dyn SessionExecutor> = Arc::new(Self {
                            session_manager: self.session_manager.clone(),
                            agent_registry: self.agent_registry.clone(),
                            stream_registry: self.stream_registry.clone(),
                            execution_registry: self.execution_registry.clone(),
                            provider: self.provider.clone(),
                            activity_log: self.activity_log.clone(),
                            session_store: self.session_store.clone(),
                            idea_store: self.idea_store.clone(),
                            adaptive_retry: self.adaptive_retry,
                            failure_analysis_model: self.failure_analysis_model.clone(),
                            extra_tools: Vec::new(),
                            pattern_dispatcher: self.pattern_dispatcher.clone(),
                        });
                        if let Err(e) =
                            crate::session_queue::enqueue(ss.clone(), self_executor, creator, &p)
                                .await
                        {
                            warn!(task = %quest_id, creator = %creator, error = %e, "quest_result enqueue failed");
                        } else {
                            debug!(task = %quest_id, creator = %creator, "quest_result enqueued for creator session");
                        }
                    }
                    Err(e) => {
                        warn!(task = %quest_id, error = %e, "quest_result payload serialize failed");
                    }
                }
            }

            // Sandbox lifecycle: auto-commit and tear down on terminal outcomes.
            if let Some(ref sb) = sandbox {
                let _ = sb.auto_commit(0).await;
                match outcome_status {
                    "done" | "error" => {
                        if let Err(e) = sb.teardown().await {
                            warn!(task = %quest_id, error = %e, "failed to tear down sandbox");
                        }
                    }
                    _ => {
                        debug!(task = %quest_id, outcome = %outcome_status, "preserving sandbox for retry");
                    }
                }
            }
        }

        // Release the sandbox Arc. Quest worktrees persist across retries and
        // are finalized explicitly via the quest IPC; ephemeral worktrees are
        // reaped by `prune_stale_worktrees` on next daemon start.
        drop(sandbox);

        // Surface the agent outcome as the executor's result.
        match run_result {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => Err(e.context("agent run failed")),
            Err(e) => Err(e),
        }
    }
}

/// Fire `session:quest_end` from the queue-driven worker's terminal-status
/// path through the daemon's `PatternDispatcher` so the seeded
/// reflect-after-quest chain (`session.spawn(meta:reflector-template)` →
/// `ideas.store_many`) runs when an autonomous worker completes a quest.
///
/// Mirrors `dispatch_quest_end_for_ipc_close` in `ipc/quests.rs` and
/// `dispatch_quest_end_for_llm_close` in `tools/quests.rs`. Extracted as a
/// free function so it can be unit-tested without standing up the full
/// QueueExecutor (which requires `SessionManager`, `AgentRegistry`, ...).
///
/// `quest`: the post-finalize quest row, used to populate `outcome` /
/// `transcript_preview` in the trigger args. `None` is tolerated — the
/// dispatch still runs with a minimal payload — because losing the row
/// shouldn't block reflection.
async fn dispatch_quest_end_for_queue_finalize(
    dispatcher: Option<&Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
    quest_id: &str,
    final_text: &str,
    quest: Option<&aeqi_quests::Quest>,
    session_id: &str,
    agent_id: &str,
) {
    let Some(dispatcher) = dispatcher else {
        warn!(
            quest_id,
            "session:quest_end not dispatched from queue finalize: no pattern_dispatcher wired"
        );
        return;
    };

    let subject = quest.map(|q| q.title().to_string()).unwrap_or_default();
    let outcome = quest.and_then(|q| q.quest_outcome());

    let trigger_args = serde_json::json!({
        "session_id": session_id,
        "agent_id": agent_id,
        "quest_id": quest_id,
        "reason": final_text,
        "outcome": outcome,
        "transcript_preview": format!(
            "Quest {quest_id} ({subject}) finalized by worker: {final_text}",
        ),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let exec_ctx = aeqi_core::tool_registry::ExecutionContext {
        session_id: session_id.to_string(),
        agent_id: agent_id.to_string(),
        ..Default::default()
    };
    let handled = dispatcher
        .dispatch("session:quest_end", &exec_ctx, &trigger_args)
        .await;
    if handled {
        tracing::info!(
            quest_id,
            session = %session_id,
            "session:quest_end dispatched (queue finalize → reflect-after-quest)"
        );
    } else {
        debug!(
            quest_id,
            "session:quest_end dispatch returned false (no matching event configured)"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::tool_registry::{ExecutionContext, PatternDispatcher};
    use std::sync::Mutex;

    /// Recording dispatcher: captures every `dispatch` call so tests can
    /// assert which patterns fired and what trigger_args they carried.
    #[derive(Default)]
    struct RecordingDispatcher {
        calls: Mutex<Vec<(String, String, serde_json::Value)>>,
    }

    impl PatternDispatcher for RecordingDispatcher {
        fn dispatch<'a>(
            &'a self,
            pattern: &'a str,
            ctx: &'a ExecutionContext,
            trigger_args: &'a serde_json::Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
            let pattern = pattern.to_string();
            let session_id = ctx.session_id.clone();
            let trigger_args = trigger_args.clone();
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((pattern, session_id, trigger_args));
                true
            })
        }
    }

    fn stub_quest(id: &str, agent_id: Option<&str>) -> aeqi_quests::Quest {
        aeqi_quests::Quest {
            id: aeqi_quests::QuestId(id.to_string()),
            idea_id: Some(format!("idea-{id}")),
            idea: None,
            status: aeqi_quests::QuestStatus::Done,
            priority: Default::default(),
            agent_id: agent_id.map(str::to_string),
            scope: aeqi_core::Scope::SelfScope,
            depends_on: Vec::new(),
            retry_count: 0,
            checkpoints: Vec::new(),
            metadata: serde_json::Value::Null,
            created_at: chrono::Utc::now(),
            updated_at: Some(chrono::Utc::now()),
            closed_at: Some(chrono::Utc::now()),
            outcome: None,
            worktree_branch: None,
            worktree_path: None,
            creator_session_id: None,
        }
    }

    /// Regression lock: when the autonomous worker finalizes a quest as
    /// `Done`, the queue executor must fire `session:quest_end` through
    /// the wired `PatternDispatcher`. Before this fix, every quest closed
    /// by `finalize_quest` was a third dead end for the reflection loop
    /// — the row flipped to Done, no event chain ever ran.
    #[tokio::test]
    async fn queue_finalize_dispatches_session_quest_end_via_pattern_dispatcher() {
        let recorder = Arc::new(RecordingDispatcher::default());
        let dispatcher: Arc<dyn PatternDispatcher> = recorder.clone();

        let quest = stub_quest("q-queue", Some("agent-w"));
        dispatch_quest_end_for_queue_finalize(
            Some(&dispatcher),
            &quest.id.0,
            "all green",
            Some(&quest),
            "sess-worker-7",
            "agent-w",
        )
        .await;

        let calls = recorder.calls.lock().unwrap();
        assert_eq!(calls.len(), 1, "must dispatch exactly once");
        let (pattern, session_id, trigger_args) = &calls[0];
        assert_eq!(pattern, "session:quest_end");
        assert_eq!(
            session_id, "sess-worker-7",
            "real worker session_id propagates as parent_session"
        );
        assert_eq!(
            trigger_args.get("quest_id").and_then(|v| v.as_str()),
            Some("q-queue"),
        );
        assert_eq!(
            trigger_args.get("agent_id").and_then(|v| v.as_str()),
            Some("agent-w"),
        );
        assert_eq!(
            trigger_args.get("reason").and_then(|v| v.as_str()),
            Some("all green"),
        );
        assert!(
            trigger_args
                .get("transcript_preview")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s.contains("q-queue")),
            "transcript_preview must reference the closing quest"
        );
    }

    /// When no dispatcher is wired (older daemon builds, embedded tests),
    /// the finalize path must degrade silently — never panic, never return
    /// an error — so the quest still completes normally.
    #[tokio::test]
    async fn queue_finalize_without_dispatcher_is_a_no_op() {
        dispatch_quest_end_for_queue_finalize(
            None,
            "q-nop",
            "no dispatcher",
            None,
            "sess-x",
            "agent-x",
        )
        .await;
    }
}
