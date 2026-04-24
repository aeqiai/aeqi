//! Build a real [`aeqi_orchestrator::ipc::CommandContext`] for IPC-level
//! integration tests.
//!
//! # Why this exists
//!
//! `CommandContext` pulls in ~18 coupled dependencies (`AgentRegistry`,
//! `SessionManager`, `Dispatcher`, embed queue, tag-policy cache, …). Every
//! tests file in `crates/aeqi-orchestrator/tests/` used to open-code these
//! by hand — or more often, *didn't*, and instead asserted on the store
//! layer underneath the IPC boundary. That left a visible gap: handler-level
//! behaviour (cross-agent rejection, atomic supersede, threshold dispatch)
//! was only exercised indirectly.
//!
//! [`TestHarness`] wires every dependency as an in-memory / fake-but-
//! functional implementation:
//!
//! - `AgentRegistry` against a `TempDir` (which also houses the ideas
//!   table — in production both live in `aeqi.db` at the same path)
//! - `SqliteIdeas` pointed at that same `aeqi.db` so scope-visibility
//!   queries on the registry agree with the idea store's view
//! - `AEQIMetrics`, `ActivityLog`, `SessionStore`, `EventHandlerStore`
//!   wired through the registry's connection pools
//! - `SessionManager`, `Dispatcher`, `StreamRegistry`, `ExecutionRegistry`
//!   constructed via their public `new()` / `Default::default()` entry
//! - `EmbedQueue` drained by a sink task so the store path can enqueue
//!   without backpressure; no embedder is configured (BM25-only)
//! - `TagPolicyCache` and `RecallCache` with production TTLs
//! - Optional `PatternDispatcher` — see [`TestHarness::with_pattern_dispatcher`]
//!
//! # Usage
//!
//! ```no_run
//! use aeqi_test_support::TestHarness;
//!
//! # async fn _doc() -> anyhow::Result<()> {
//! let h = TestHarness::build().await?;
//! let ctx = h.ctx();
//! let id = h.add_idea("my-idea", "body", &["fact"], None).await?;
//! let resp = aeqi_orchestrator::ipc::ideas::handle_feedback_idea(
//!     &ctx,
//!     &serde_json::json!({"id": id, "signal": "used"}),
//!     &None,
//! )
//! .await;
//! assert_eq!(resp["ok"], serde_json::json!(true));
//! # Ok(())
//! # }
//! ```
//!
//! Each [`TestHarness::build`] spins a fresh `TempDir` + fresh in-memory
//! state — no cross-test pollution. Construction is on the order of a few
//! tens of milliseconds (dominated by SQLite pragma setup + schema install).

use std::path::PathBuf;
use std::sync::Arc;

use aeqi_core::tool_registry::PatternDispatcher;
use aeqi_core::traits::{FeedbackMeta, IdeaStore, StoreFull};
use aeqi_ideas::RecallCache;
use aeqi_ideas::SqliteIdeas;
use aeqi_ideas::embed_worker::EmbedQueue;
use aeqi_ideas::tag_policy::TagPolicyCache;
use aeqi_orchestrator::activity_log::ActivityLog;
use aeqi_orchestrator::agent_registry::AgentRegistry;
use aeqi_orchestrator::dispatch::{DispatchConfig, Dispatcher};
use aeqi_orchestrator::event_handler::EventHandlerStore;
use aeqi_orchestrator::execution_registry::ExecutionRegistry;
use aeqi_orchestrator::ipc::CommandContext;
use aeqi_orchestrator::metrics::AEQIMetrics;
use aeqi_orchestrator::session_manager::SessionManager;
use aeqi_orchestrator::session_store::SessionStore;
use aeqi_orchestrator::stream_registry::StreamRegistry;
use tempfile::TempDir;
use tokio::sync::Mutex;

/// End-to-end harness that owns every dependency of
/// [`aeqi_orchestrator::ipc::CommandContext`]. Call [`TestHarness::build`],
/// then [`TestHarness::ctx`] each time you need a fresh `CommandContext`
/// (the `Arc`s are cheap to clone).
///
/// Drop the harness to release the backing `TempDir`. The embed-queue drain
/// task exits when its sender goes out of scope.
pub struct TestHarness {
    // Ownership of the tempdir + all Arc<>s. Tests interact via the
    // getters below; direct field access is intentionally not exposed.
    tempdir: TempDir,
    metrics: Arc<AEQIMetrics>,
    activity_log: Arc<ActivityLog>,
    session_store: Arc<SessionStore>,
    event_handler_store: Arc<EventHandlerStore>,
    agent_registry: Arc<AgentRegistry>,
    idea_store: Arc<dyn IdeaStore>,
    session_manager: Arc<SessionManager>,
    dispatcher: Arc<Dispatcher>,
    execution_registry: Arc<ExecutionRegistry>,
    stream_registry: Arc<StreamRegistry>,
    embed_queue: Arc<EmbedQueue>,
    tag_policy_cache: Arc<TagPolicyCache>,
    recall_cache: Arc<RecallCache>,
    activity_buffer: Arc<Mutex<aeqi_orchestrator::daemon::ActivityBuffer>>,
    pattern_dispatcher: Option<Arc<dyn PatternDispatcher>>,
}

impl TestHarness {
    /// Build a fresh harness. Every call creates its own `TempDir`, so
    /// tests can run in parallel without shared state.
    pub async fn build() -> anyhow::Result<Self> {
        let tempdir = TempDir::new()?;
        let data_dir: PathBuf = tempdir.path().to_path_buf();

        // AgentRegistry opens `aeqi.db` + `sessions.db` inside data_dir and
        // installs the ideas/events/quests schemas.
        let agent_registry = Arc::new(AgentRegistry::open(&data_dir)?);

        // SqliteIdeas points at the SAME `aeqi.db` so scope-visibility
        // queries on the registry agree with what the store sees. This
        // mirrors `aeqi-cli/src/helpers.rs::open_ideas_with_embedder`.
        let ideas_db = data_dir.join("aeqi.db");
        let idea_store_impl = SqliteIdeas::open(&ideas_db, 30.0)?;
        let idea_store: Arc<dyn IdeaStore> = Arc::new(idea_store_impl);

        // `AgentRegistry::list_ideas_visible_to` reads `inheritance`,
        // `tool_allow`, `tool_deny` on the ideas table. These were columns
        // on pre-v3 schemas; v3 dropped them from the baseline. On long-
        // lived production DBs the columns survive because `ALTER TABLE
        // DROP COLUMN` was never issued — only the `CREATE TABLE` body
        // changed. Fresh DBs (like the one we just opened) lack them, so
        // the visibility query 500s with "no such column: inheritance".
        // Add them here as a shim so IPC handlers that consult the
        // visibility list (feedback, link, add_idea_edge, graph, profile)
        // work against a fresh harness DB. These are the same defaults
        // the `Idea` hydration in `list_ideas_visible_to` falls back to.
        {
            let pool = agent_registry.db();
            let conn = pool.lock().await;
            let existing: Vec<String> = {
                let mut stmt = conn.prepare("PRAGMA table_info(ideas)")?;
                stmt.query_map([], |row| row.get::<_, String>(1))?
                    .filter_map(|r| r.ok())
                    .collect()
            };
            for (col, ddl) in [
                ("inheritance", "TEXT NOT NULL DEFAULT 'self'"),
                ("tool_allow", "TEXT"),
                ("tool_deny", "TEXT"),
            ] {
                if !existing.iter().any(|c| c == col) {
                    conn.execute_batch(&format!("ALTER TABLE ideas ADD COLUMN {col} {ddl};"))?;
                }
            }
        }

        // Infra with trivial constructors.
        let metrics = Arc::new(AEQIMetrics::new());
        let activity_log = Arc::new(ActivityLog::new(agent_registry.db()));
        let session_store = Arc::new(SessionStore::new(agent_registry.db()));
        let event_handler_store = Arc::new(EventHandlerStore::new(agent_registry.db()));
        let session_manager = Arc::new(SessionManager::new());
        let dispatcher = Arc::new(Dispatcher::new(DispatchConfig::default()));
        let execution_registry = Arc::new(ExecutionRegistry::new());
        let stream_registry = Arc::new(StreamRegistry::new());
        let activity_buffer = Arc::new(Mutex::new(Default::default()));

        // Embed queue: a small channel with a sink task that drains and
        // discards. The write path enqueues `(id, content)` unconditionally;
        // without a drainer the bounded channel fills up and subsequent
        // enqueues log WARN. With a drainer, the write path stays silent.
        let (embed_queue_impl, embed_rx) = EmbedQueue::channel(1024);
        let embed_queue = Arc::new(embed_queue_impl);
        tokio::spawn(aeqi_ideas::embed_worker::run_no_op(embed_rx));

        // Tag-policy cache with production-ish TTL; resolves to defaults
        // when no `meta:tag-policy` ideas are seeded.
        let tag_policy_cache = Arc::new(TagPolicyCache::new(60));
        let recall_cache = Arc::new(RecallCache::new(128, 300));

        Ok(Self {
            tempdir,
            metrics,
            activity_log,
            session_store,
            event_handler_store,
            agent_registry,
            idea_store,
            session_manager,
            dispatcher,
            execution_registry,
            stream_registry,
            embed_queue,
            tag_policy_cache,
            recall_cache,
            activity_buffer,
            pattern_dispatcher: None,
        })
    }

    /// Install a pattern dispatcher (e.g. an `EventPatternDispatcher` with
    /// a canned `session.spawn`). Builder-style: chain before calling
    /// [`Self::ctx`].
    pub fn with_pattern_dispatcher(mut self, dispatcher: Arc<dyn PatternDispatcher>) -> Self {
        self.pattern_dispatcher = Some(dispatcher);
        self
    }

    /// Construct a fresh [`CommandContext`]. Every call clones the inner
    /// `Arc`s; tests that want two independent contexts for the same
    /// backing state can call this twice.
    pub fn ctx(&self) -> CommandContext {
        CommandContext {
            metrics: self.metrics.clone(),
            activity_log: self.activity_log.clone(),
            session_store: Some(self.session_store.clone()),
            event_handler_store: Some(self.event_handler_store.clone()),
            agent_registry: self.agent_registry.clone(),
            idea_store: Some(self.idea_store.clone()),
            message_router: None,
            activity_buffer: self.activity_buffer.clone(),
            default_provider: None,
            default_model: "test-model".to_string(),
            session_manager: self.session_manager.clone(),
            dispatcher: self.dispatcher.clone(),
            daily_budget_usd: f64::INFINITY,
            skill_loader: None,
            execution_registry: self.execution_registry.clone(),
            stream_registry: self.stream_registry.clone(),
            channel_spawner: None,
            tag_policy_cache: self.tag_policy_cache.clone(),
            embed_queue: self.embed_queue.clone(),
            embedder: None,
            recall_cache: self.recall_cache.clone(),
            pattern_dispatcher: self.pattern_dispatcher.clone(),
        }
    }

    /// Direct handle on the registry so tests can `spawn` agents.
    pub fn registry(&self) -> &Arc<AgentRegistry> {
        &self.agent_registry
    }

    /// Direct handle on the ideas store so tests can assert on the raw row
    /// after an IPC roundtrip.
    pub fn idea_store(&self) -> &Arc<dyn IdeaStore> {
        &self.idea_store
    }

    /// Path to the backing `aeqi.db` — useful for `rusqlite::Connection::open`
    /// when a test wants to assert on a column the trait doesn't expose.
    pub fn db_path(&self) -> PathBuf {
        self.tempdir.path().join("aeqi.db")
    }

    /// Direct handle on the event handler store (Round 6 consolidation
    /// tests seed events through this).
    pub fn event_store(&self) -> &Arc<EventHandlerStore> {
        &self.event_handler_store
    }

    /// Spawn an agent in the registry. Returns its UUID.
    pub async fn spawn_agent(&self, name: &str) -> anyhow::Result<String> {
        let agent = self.agent_registry.spawn(name, None, None).await?;
        Ok(agent.id)
    }

    /// Convenience: insert an idea directly via `store_full`. Bypasses the
    /// IPC dedup pipeline — use for seeding fixtures. Returns the new id.
    pub async fn add_idea(
        &self,
        name: &str,
        content: &str,
        tags: &[&str],
        agent_id: Option<&str>,
    ) -> anyhow::Result<String> {
        let scope = if agent_id.is_some() {
            aeqi_core::Scope::SelfScope
        } else {
            aeqi_core::Scope::Global
        };
        let input = StoreFull {
            name: name.to_string(),
            content: content.to_string(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            agent_id: agent_id.map(str::to_string),
            scope,
            authored_by: agent_id.map(str::to_string),
            confidence: 1.0,
            expires_at: None,
            valid_from: None,
            valid_until: None,
            time_context: "timeless".into(),
            status: "active".into(),
        };
        self.idea_store.store_full(input).await
    }

    /// Convenience: record feedback bypassing the IPC handler.
    pub async fn record_feedback(
        &self,
        id: &str,
        signal: &str,
        weight: f32,
        meta: FeedbackMeta,
    ) -> anyhow::Result<()> {
        self.idea_store
            .record_feedback(id, signal, weight, meta)
            .await
    }
}
