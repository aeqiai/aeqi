//! Per-execution registry — the short-lived companion to `StreamRegistry`.
//!
//! An entry lives for the duration of one `spawn_session` → `agent.run()`
//! execution. The queue executor creates the entry before kicking off the
//! run and removes it after awaiting the join handle. Nothing outside the
//! executor owns these entries, so there is no "dead session" state to
//! reap — when the loop exits, the handle is gone.
//!
//! Exposes only what external callers genuinely need:
//!   - `cancel(session_id)` to flip the cancel token (IPC stop button).
//!   - `auto_commit(session_id, turn)` for per-turn sandbox commits from
//!     the streaming IPC handler.
//!   - `is_active` / `active_ids` / `info` for status endpoints.
//!
//! Sandbox teardown is NOT exposed here — the executor owns that lifecycle
//! and runs it after `agent.run()` returns.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use tokio::sync::Mutex;

use crate::sandbox::QuestSandbox;
use aeqi_core::SessionInput;

/// One live execution's cancel handle, sandbox pointer, and metadata.
#[derive(Clone)]
pub struct ExecutionHandle {
    pub session_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub correlation_id: String,
    pub cancel_token: Arc<AtomicBool>,
    pub input_sender: Option<tokio::sync::mpsc::UnboundedSender<SessionInput>>,
    pub sandbox: Option<Arc<QuestSandbox>>,
    /// Quest id when this execution is a quest run; `None` for chat.
    pub quest_id: Option<String>,
    /// When `register` was called — used by status endpoints for age display.
    pub started_at: Instant,
}

/// Snapshot of an execution's metadata — returned by `info()` so callers
/// don't have to hold the registry lock.
#[derive(Clone, Debug)]
pub struct ExecutionInfo {
    pub agent_id: String,
    pub agent_name: String,
    pub correlation_id: String,
}

/// Thread-safe map from `session_id` to its live `ExecutionHandle`.
#[derive(Default)]
pub struct ExecutionRegistry {
    inner: Mutex<HashMap<String, ExecutionHandle>>,
}

impl ExecutionRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Insert a fresh execution entry. Called by the queue executor right
    /// before it awaits the agent's join handle.
    pub async fn register(&self, handle: ExecutionHandle) {
        let sid = handle.session_id.clone();
        self.inner.lock().await.insert(sid, handle);
    }

    /// Remove the entry. Called by the queue executor once the join handle
    /// has resolved and sandbox teardown is done. Safe to call on an
    /// already-removed entry (returns `None`).
    pub async fn unregister(&self, session_id: &str) -> Option<ExecutionHandle> {
        self.inner.lock().await.remove(session_id)
    }

    /// Whether a session currently has a live execution.
    pub async fn is_active(&self, session_id: &str) -> bool {
        self.inner.lock().await.contains_key(session_id)
    }

    /// Session IDs with live executions. Used by status endpoints.
    pub async fn active_ids(&self) -> Vec<String> {
        self.inner.lock().await.keys().cloned().collect()
    }

    /// Snapshot of all live executions as JSON objects — drives the IPC
    /// `worker_progress` / `status.workers` endpoints.
    pub async fn status_snapshot(&self) -> Vec<serde_json::Value> {
        self.inner
            .lock()
            .await
            .values()
            .map(|h| {
                serde_json::json!({
                    "session_id": h.session_id,
                    "quest_id": h.quest_id,
                    "agent_id": h.agent_id,
                    "agent_name": h.agent_name,
                    "running_secs": h.started_at.elapsed().as_secs(),
                })
            })
            .collect()
    }

    /// Count of live executions grouped by `agent_name`.
    pub async fn agent_counts(&self) -> HashMap<String, u32> {
        let inner = self.inner.lock().await;
        let mut counts = HashMap::new();
        for h in inner.values() {
            *counts.entry(h.agent_name.clone()).or_default() += 1;
        }
        counts
    }

    /// Flip the cancel token on a live execution. Returns true if an entry
    /// was found; agent code observes the token and aborts its loop.
    pub async fn cancel(&self, session_id: &str) -> bool {
        match self.inner.lock().await.get(session_id) {
            Some(h) => {
                h.cancel_token.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    /// Inject a new user turn into a live perpetual execution.
    /// Returns false when the session is not active or does not expose
    /// a perpetual input channel.
    pub async fn inject_input(&self, session_id: &str, input: SessionInput) -> bool {
        let sender = {
            let inner = self.inner.lock().await;
            inner
                .get(session_id)
                .and_then(|h| h.input_sender.as_ref())
                .cloned()
        };

        match sender {
            Some(tx) => tx.send(input).is_ok(),
            None => false,
        }
    }

    /// Clone the sandbox Arc for an active execution, if any.
    pub async fn sandbox(&self, session_id: &str) -> Option<Arc<QuestSandbox>> {
        self.inner
            .lock()
            .await
            .get(session_id)
            .and_then(|h| h.sandbox.clone())
    }

    /// Auto-commit any dirty state in the session's sandbox worktree.
    /// No-op if the session has no live execution or no sandbox.
    pub async fn auto_commit(&self, session_id: &str, turn: u32) {
        if let Some(sb) = self.sandbox(session_id).await {
            sb.auto_commit(turn).await;
        }
    }

    /// How long the live execution has been running. Returns `None` when
    /// the session has no live execution. Used by the subscribe preamble
    /// so a reconnected client can seed `thinking_started_at` honestly.
    pub async fn started_elapsed_ms(&self, session_id: &str) -> Option<u64> {
        self.inner
            .lock()
            .await
            .get(session_id)
            .map(|h| h.started_at.elapsed().as_millis() as u64)
    }

    /// Lightweight metadata snapshot. Returns None if no live execution.
    pub async fn info(&self, session_id: &str) -> Option<ExecutionInfo> {
        self.inner
            .lock()
            .await
            .get(session_id)
            .map(|h| ExecutionInfo {
                agent_id: h.agent_id.clone(),
                agent_name: h.agent_name.clone(),
                correlation_id: h.correlation_id.clone(),
            })
    }
}
