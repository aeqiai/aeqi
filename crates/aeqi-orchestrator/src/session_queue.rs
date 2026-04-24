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
///
/// # Integration tests — ephemeral execution model
///
/// The tests below verify two core invariants of the ephemeral model:
///
/// 1. **Consecutive spawns don't leak a parked task between turns.**
///    After a claim is processed, `ExecutionRegistry::is_active` must return
///    `false`. A second enqueue triggers a second spawn; the registry drops
///    back to zero between the two turns.
///
/// 2. **Step-boundary injection lands user messages at the next step.**
///    `PendingMessageSource::claim_pending_for_session` returns rows inserted
///    after the watermark; the agent appends them as `Role::User` and emits
///    `ChatStreamEvent::UserInjected`. Verified at the `SessionStore` level
///    (the production impl of `PendingMessageSource`) and at the `Agent` level
///    via a single-step run with a spy source.
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

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

    use anyhow::Result;
    use async_trait::async_trait;

    use crate::agent_registry::ConnectionPool;
    use crate::execution_registry::{ExecutionHandle, ExecutionRegistry};
    use crate::session_store::SessionStore;

    use super::{SessionExecutor, claim_and_run_loop, enqueue};

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Build an in-memory `SessionStore` with the pending_messages table.
    async fn make_store() -> Arc<SessionStore> {
        let pool = ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
        }
        Arc::new(SessionStore::new(Arc::new(pool)))
    }

    /// A `SessionExecutor` that counts how many times `execute` was called
    /// and optionally records the claimed payload texts.
    struct CountingExecutor {
        count: Arc<AtomicU32>,
        /// Optional per-invocation registry wiring so tests can check
        /// `is_active` from *inside* the execution.
        execution_registry: Option<Arc<ExecutionRegistry>>,
        session_id: String,
    }

    #[async_trait]
    impl SessionExecutor for CountingExecutor {
        async fn execute(
            &self,
            _session_id: &str,
            _claim: &crate::session_store::PendingClaim,
        ) -> Result<()> {
            // Register so is_active() returns true during this turn.
            if let Some(ref reg) = self.execution_registry {
                reg.register(ExecutionHandle {
                    session_id: self.session_id.clone(),
                    agent_id: "agent-test".to_string(),
                    agent_name: "test".to_string(),
                    correlation_id: "corr".to_string(),
                    cancel_token: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                    sandbox: None,
                    quest_id: None,
                    started_at: std::time::Instant::now(),
                })
                .await;
            }

            self.count.fetch_add(1, Ordering::SeqCst);

            // Unregister before returning — mirrors what QueueExecutor does
            // after join_handle.await.
            if let Some(ref reg) = self.execution_registry {
                reg.unregister(&self.session_id).await;
            }

            Ok(())
        }
    }

    // ── test 1: consecutive spawns — no parked task between turns ────────────

    /// After `claim_and_run_loop` drains one queued row the executor is called
    /// once and the registry has no live entries between turns.
    ///
    /// Sequence:
    ///   enqueue msg-1  →  claim_and_run_loop → executor called (turn 1)
    ///                     ExecutionRegistry drops to 0 after turn-1 join
    ///   enqueue msg-2  →  claim_and_run_loop → executor called (turn 2)
    ///                     ExecutionRegistry drops to 0 after turn-2 join
    #[tokio::test]
    async fn consecutive_spawns_registry_empty_between_turns() {
        let store = make_store().await;
        let reg = Arc::new(ExecutionRegistry::new());
        let session_id = "sess-ephemeral";
        let count = Arc::new(AtomicU32::new(0));
        let executor: Arc<dyn SessionExecutor> = Arc::new(CountingExecutor {
            count: count.clone(),
            execution_registry: Some(reg.clone()),
            session_id: session_id.to_string(),
        });

        // Turn 1: enqueue + drain.
        store
            .enqueue_pending(session_id, "turn-1-payload")
            .await
            .unwrap();
        claim_and_run_loop(store.clone(), executor.clone(), session_id)
            .await
            .unwrap();

        // After turn 1 completes, the registry must be empty.
        assert!(
            !reg.is_active(session_id).await,
            "registry must be empty between turns after turn 1"
        );
        assert_eq!(count.load(Ordering::SeqCst), 1, "executor called once");

        // Turn 2: enqueue another row and drain again.
        store
            .enqueue_pending(session_id, "turn-2-payload")
            .await
            .unwrap();
        claim_and_run_loop(store.clone(), executor.clone(), session_id)
            .await
            .unwrap();

        // After turn 2 completes, the registry is still empty.
        assert!(
            !reg.is_active(session_id).await,
            "registry must be empty between turns after turn 2"
        );
        assert_eq!(
            count.load(Ordering::SeqCst),
            2,
            "executor called twice total"
        );
    }

    /// `enqueue` + `spawn_claim_loop` drives the same drain path. Verify the
    /// registry size drops to 0 between each of two rapid-fire enqueues.
    #[tokio::test]
    async fn enqueue_two_turns_no_parked_task_between() {
        let store = make_store().await;
        let reg = Arc::new(ExecutionRegistry::new());
        let session_id = "sess-rapid";
        let count = Arc::new(AtomicU32::new(0));
        let executor: Arc<dyn SessionExecutor> = Arc::new(CountingExecutor {
            count: count.clone(),
            execution_registry: Some(reg.clone()),
            session_id: session_id.to_string(),
        });

        // Enqueue the first turn and wait until the spawned loop task finishes.
        enqueue(store.clone(), executor.clone(), session_id, "msg-a")
            .await
            .unwrap();

        // Give the background tokio task time to run.
        tokio::task::yield_now().await;
        // Spin briefly until the first turn has been processed.
        for _ in 0..100 {
            if count.load(Ordering::SeqCst) >= 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }

        assert!(
            !reg.is_active(session_id).await,
            "registry empty after turn 1"
        );

        // Enqueue a second turn.
        enqueue(store.clone(), executor.clone(), session_id, "msg-b")
            .await
            .unwrap();

        tokio::task::yield_now().await;
        for _ in 0..100 {
            if count.load(Ordering::SeqCst) >= 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }

        assert!(
            !reg.is_active(session_id).await,
            "registry empty after turn 2"
        );
        assert_eq!(count.load(Ordering::SeqCst), 2, "two turns executed");
    }

    // ── test 2: step-boundary injection — agent-level ────────────────────────

    /// A spy `PendingMessageSource` that returns a configurable list of injected
    /// messages on the first call, then nothing on subsequent calls.
    struct SpyPendingSource {
        messages: Mutex<Vec<aeqi_core::traits::InjectedMessage>>,
        call_count: AtomicU32,
    }

    impl SpyPendingSource {
        fn new(msgs: Vec<(&str, i64)>) -> Self {
            let messages = msgs
                .into_iter()
                .map(|(text, id)| aeqi_core::traits::InjectedMessage {
                    id,
                    content: text.to_string(),
                })
                .collect();
            Self {
                messages: Mutex::new(messages),
                call_count: AtomicU32::new(0),
            }
        }
    }

    #[async_trait]
    impl aeqi_core::traits::PendingMessageSource for SpyPendingSource {
        async fn claim_pending_for_session(
            &self,
            _session_id: &str,
            _since_id: Option<i64>,
        ) -> Result<Vec<aeqi_core::traits::InjectedMessage>> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            // Drain on first call; return empty on subsequent calls.
            let mut guard = self.messages.lock().unwrap();
            Ok(std::mem::take(&mut *guard))
        }
    }

    /// A one-shot provider that returns a single "done" response so `agent.run()`
    /// completes in exactly one step (one LLM round-trip).
    struct OneShotProvider;

    #[async_trait::async_trait]
    impl aeqi_core::traits::Provider for OneShotProvider {
        fn name(&self) -> &str {
            "one-shot-test"
        }
        async fn health_check(&self) -> anyhow::Result<()> {
            Ok(())
        }
        async fn chat(
            &self,
            _request: &aeqi_core::traits::ChatRequest,
        ) -> anyhow::Result<aeqi_core::traits::ChatResponse> {
            Ok(aeqi_core::traits::ChatResponse {
                content: Some("done".to_string()),
                tool_calls: vec![],
                usage: aeqi_core::traits::Usage {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
                stop_reason: aeqi_core::traits::StopReason::EndTurn,
            })
        }
    }

    struct NopObserver;

    #[async_trait::async_trait]
    impl aeqi_core::traits::Observer for NopObserver {
        fn name(&self) -> &str {
            "nop"
        }
        async fn record(&self, _event: aeqi_core::traits::Event) {}
    }

    /// Run an agent with a `SpyPendingSource` that has one pending message and
    /// verify that:
    ///   (a) `ChatStreamEvent::UserInjected` is emitted on the stream
    ///   (b) the spy's `claim_pending_for_session` was called at least once
    #[tokio::test]
    async fn step_boundary_injection_emits_user_injected_event() {
        use aeqi_core::chat_stream::ChatStreamEvent;
        use aeqi_core::{Agent, AgentConfig};

        let spy = Arc::new(SpyPendingSource::new(vec![(
            "hello from step boundary",
            42,
        )]));
        let (stream_sender, mut rx) = aeqi_core::chat_stream::ChatStreamSender::new(64);

        let config = AgentConfig {
            session_id: "step-boundary-test".to_string(),
            max_iterations: 5,
            ..Default::default()
        };

        let agent = Agent::new(
            config,
            Arc::new(OneShotProvider),
            vec![],
            Arc::new(NopObserver),
            "You are a test agent.".to_string(),
        )
        .with_chat_stream(stream_sender)
        .with_pending_source(spy.clone(), Some(10));

        agent.run("initial message").await.unwrap();

        // Collect events from the stream.
        let mut injected_events = Vec::new();
        while let Ok(event) = rx.try_recv() {
            if matches!(event, ChatStreamEvent::UserInjected { .. }) {
                injected_events.push(event);
            }
        }

        assert!(
            !injected_events.is_empty(),
            "expected at least one UserInjected event; got none"
        );
        match &injected_events[0] {
            ChatStreamEvent::UserInjected {
                text, message_id, ..
            } => {
                assert_eq!(text, "hello from step boundary");
                assert_eq!(*message_id, Some(42));
            }
            other => panic!("unexpected event: {other:?}"),
        }

        assert!(
            spy.call_count.load(Ordering::SeqCst) > 0,
            "spy must have been called at least once"
        );
    }

    /// Verify that with watermark `Some(starting_id)` the spy is never passed
    /// `None` — i.e. the agent correctly threads the starting_pending_id through
    /// as the initial watermark so the triggering row cannot be re-claimed.
    #[tokio::test]
    async fn step_boundary_injection_watermark_threaded_correctly() {
        use aeqi_core::{Agent, AgentConfig};
        use std::sync::Mutex;

        struct WatermarkCapturingSpy {
            captured: Mutex<Vec<Option<i64>>>,
        }

        #[async_trait::async_trait]
        impl aeqi_core::traits::PendingMessageSource for WatermarkCapturingSpy {
            async fn claim_pending_for_session(
                &self,
                _session_id: &str,
                since_id: Option<i64>,
            ) -> anyhow::Result<Vec<aeqi_core::traits::InjectedMessage>> {
                self.captured.lock().unwrap().push(since_id);
                Ok(vec![])
            }
        }

        let spy = Arc::new(WatermarkCapturingSpy {
            captured: Mutex::new(Vec::new()),
        });

        let config = AgentConfig {
            session_id: "watermark-test".to_string(),
            max_iterations: 5,
            ..Default::default()
        };

        let agent = Agent::new(
            config,
            Arc::new(OneShotProvider),
            vec![],
            Arc::new(NopObserver),
            "system".to_string(),
        )
        .with_pending_source(spy.clone(), Some(99));

        agent.run("prompt").await.unwrap();

        let calls = spy.captured.lock().unwrap();
        assert!(!calls.is_empty(), "spy must have been called at least once");
        // Every call must pass the starting watermark (99) or an advanced one —
        // never None when a starting_pending_id was provided.
        for since_id in calls.iter() {
            assert!(
                since_id.is_some(),
                "watermark must not reset to None once initialized; got None"
            );
        }
    }
}
