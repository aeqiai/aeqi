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
        }
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
}

#[async_trait]
impl SessionExecutor for QueueExecutor {
    async fn execute(&self, session_id: &str, claim: &PendingClaim) -> Result<()> {
        let queued = QueuedMessage::from_payload(&claim.payload)?;

        // The same sender the IPC subscriber is listening on. Created-or-reused
        // so a late executor still publishes to the right bus.
        let stream_sender = self.stream_registry.get_or_create(session_id).await;

        // auto_close=false matches the old `interactive()` SpawnOptions for web.
        // spawn_session records the initial user-message row itself, so the
        // `event_fired` rows for session:start / session:execution_start sort
        // BEFORE the user message in the timeline.
        let mut opts = SpawnOptions::interactive()
            .with_session_id(session_id.to_string())
            .with_stream_sender(stream_sender);
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
                let subject = self
                    .agent_registry
                    .get_task(quest_id)
                    .await
                    .ok()
                    .flatten()
                    .map(|q| q.name)
                    .unwrap_or_default();
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
                    if let Err(e) = self
                        .agent_registry
                        .update_task(quest_id, |q| {
                            q.description.push_str(&enrichment);
                        })
                        .await
                    {
                        warn!(task = %quest_id, error = %e, "failed to enrich quest description");
                    }
                }
            }

            // Single transaction: status flip + retry bump + closed_at stamp.
            // `bump_retry` only fires on the Pending path, so
            // `max_task_retries` eventually halts the cycle.
            let bump_retry = terminal_status == aeqi_quests::QuestStatus::Pending;
            if let Err(e) = self
                .agent_registry
                .finalize_quest(quest_id, terminal_status, bump_retry)
                .await
            {
                warn!(task = %quest_id, error = %e, "failed to finalize quest {terminal_status:?}");
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
