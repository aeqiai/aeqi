//! Per-session execution queue — DB-backed FIFO with atomic-claim lease.
//!
//! Architecture: a session is just persisted state. It is never "kept alive".
//! Each incoming user message INSERTs a row into `pending_messages` and
//! unconditionally spawns a [`claim_and_run_loop`] task. The atomic claim
//! SQL (see [`SessionStore::claim_next_pending`]) guarantees at most one
//! running execution per session at any time: if another loop task already
//! holds the lease, the new spawn returns immediately after one no-op claim.
//!
//! The running row itself IS the per-session lease. When it is DELETEd at
//! the end of an execution, whichever loop-task runs its next claim first
//! wins the next row. Rapid-fire messages, writer races, and post-run
//! "is there more?" checks are all folded into that one SQL statement.
//!
//! There is no in-memory `RunningSession` map, no idle timeout, no
//! keep-alive — the queue table IS the state.
//!
//! Crash recovery: on daemon boot, call [`SessionStore::recover_orphaned_running`]
//! to clear rows left in 'running' state by a crashed daemon (default policy
//! is drop-and-log; agent runs have side effects so replay is usually wrong),
//! then [`SessionStore::sessions_with_queued`] + [`spawn_claim_loop`] per id
//! to resume drain.

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use tracing::{debug, error, info};

use crate::session_store::{PendingClaim, SessionStore};

/// Executes one queued message against a session's state, to completion.
///
/// Implementations must be idempotent w.r.t. the `claim.id`: the same claim
/// is only ever delivered once, but the executor may be invoked concurrently
/// for different sessions. The executor is NOT responsible for deleting the
/// pending row — [`claim_and_run_loop`] handles that after a successful
/// return. On `Err`, the row is still deleted (we do not retry in-queue)
/// but the error is logged; reliability is the caller's concern.
#[async_trait]
pub trait SessionExecutor: Send + Sync {
    async fn execute(&self, session_id: &str, claim: &PendingClaim) -> Result<()>;
}

/// Spawn a claim-and-run loop for `session_id`. This is cheap — if the
/// session already has a running lease held by another loop task, this
/// task exits after one no-op claim (microseconds). Call this from:
///
/// - The enqueue path, every time, after inserting a row.
/// - Startup recovery, once per session with queued rows.
pub fn spawn_claim_loop(
    store: Arc<SessionStore>,
    executor: Arc<dyn SessionExecutor>,
    session_id: String,
) {
    tokio::spawn(async move {
        if let Err(err) = claim_and_run_loop(store, executor, &session_id).await {
            error!(session_id, ?err, "claim_and_run_loop terminated with error");
        }
    });
}

/// Drive the per-session queue to drain: claim → run → delete → loop.
///
/// Exits cleanly when the atomic claim returns `None` (queue empty or
/// another loop task holds the lease).
pub async fn claim_and_run_loop(
    store: Arc<SessionStore>,
    executor: Arc<dyn SessionExecutor>,
    session_id: &str,
) -> Result<()> {
    loop {
        let claim = match store.claim_next_pending(session_id).await? {
            Some(c) => c,
            None => {
                debug!(session_id, "claim loop exiting — no more claimable rows");
                return Ok(());
            }
        };

        debug!(session_id, claim_id = claim.id, "executing claimed message");
        let result = executor.execute(session_id, &claim).await;

        if let Err(err) = store.delete_pending(claim.id).await {
            error!(
                session_id,
                claim_id = claim.id,
                ?err,
                "failed to delete pending row after execution — may re-run on next claim"
            );
            return Err(err);
        }

        if let Err(err) = result {
            error!(
                session_id,
                claim_id = claim.id,
                ?err,
                "executor returned error; row deleted, continuing drain"
            );
        }
    }
}

/// Enqueue a message for a session and spawn a claim loop.
/// Single entry point used by IPC handlers, gateways, and internal callers.
pub async fn enqueue(
    store: Arc<SessionStore>,
    executor: Arc<dyn SessionExecutor>,
    session_id: &str,
    payload: &str,
) -> Result<i64> {
    let id = store.enqueue_pending(session_id, payload).await?;
    spawn_claim_loop(store, executor, session_id.to_string());
    Ok(id)
}

/// Startup recovery: clear crashed-daemon `running` rows, then resume drain
/// for every session with queued work. Call once during daemon boot.
pub async fn recover_on_boot(
    store: Arc<SessionStore>,
    executor: Arc<dyn SessionExecutor>,
) -> Result<()> {
    let dropped = store.recover_orphaned_running().await?;
    if dropped > 0 {
        info!(
            dropped,
            "dropped orphaned 'running' rows from crashed daemon"
        );
    }

    let sessions = store.sessions_with_queued().await?;
    if !sessions.is_empty() {
        info!(
            count = sessions.len(),
            "resuming drain for sessions with queued work"
        );
    }
    for session_id in sessions {
        spawn_claim_loop(store.clone(), executor.clone(), session_id);
    }
    Ok(())
}
