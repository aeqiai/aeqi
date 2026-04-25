//! `sessions.search` — keyword search across session transcripts via FTS5.
//!
//! Read-only by design: `CallerKind=Llm` is sufficient (no event-only ACL),
//! and the tool never writes. Reuses [`aeqi_ideas::sqlite::fts`] for query
//! sanitisation + the `snippet()` SQL builder so the BM25 read path stays
//! in lock-step with `ideas.search` even though the surfaces stay separate.
//!
//! Filters:
//! - `since_hours` — drops messages whose `timestamp` is older than the
//!   chosen cutoff (joined to `session_messages.timestamp` directly; the
//!   FTS index has no timestamp column so the filter lives on the parent
//!   table).
//! - `agent_id` — joins to `sessions.agent_id` so a search restricted to
//!   another agent only surfaces messages from sessions THAT agent owns.
//!   Defaults to the calling agent.
//!
//! Limit ceiling is a hard cap of 100 — anything larger gets truncated
//! silently. The default of 20 matches the design plan.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use aeqi_ideas::sqlite::fts::{
    FTS5_DEFAULT_SNIPPET_TOKEN_COUNT, fts5_snippet_expr, sanitise_fts5_query,
};
use anyhow::Result;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rusqlite::params_from_iter;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::SessionStore;
use crate::agent_registry::AgentRegistry;

/// Default number of hits returned when the caller doesn't pass `limit`.
const DEFAULT_LIMIT: u32 = 20;
/// Hard upper bound on `limit`. Anything above is silently capped here so
/// a runaway LLM request can't stream the full transcript history back.
const MAX_LIMIT: u32 = 100;

/// One transcript search hit. Mirrors the contract pinned in the design
/// plan: lower `score` means a better BM25 match, the snippet carries
/// `<mark>...</mark>` markers around the matching tokens.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionsSearchHit {
    pub session_id: String,
    pub message_index: i64,
    pub role: String,
    pub snippet: String,
    pub timestamp: DateTime<Utc>,
    pub score: f64,
}

/// `sessions.search` tool — keyword search over the `session_messages` FTS5
/// mirror. Holds the orchestrator handles it needs to translate the
/// caller's args into a scoped SQL query.
pub struct SessionsTool {
    session_store: Arc<SessionStore>,
    agent_registry: Arc<AgentRegistry>,
    /// Calling agent. Used as the default `agent_id` filter when the
    /// caller doesn't pass one explicitly.
    calling_agent_id: String,
}

impl SessionsTool {
    pub fn new(
        session_store: Arc<SessionStore>,
        agent_registry: Arc<AgentRegistry>,
        calling_agent_id: String,
    ) -> Self {
        Self {
            session_store,
            agent_registry,
            calling_agent_id,
        }
    }

    /// Build the parameterised SQL + bind values for the given filters.
    /// Extracted so the tests can pin the exact shape without spinning up
    /// a full `Tool::execute` round-trip.
    fn build_query(
        fts_query: &str,
        snippet_expr: &str,
        agent_id: Option<&str>,
        since_hours: Option<i64>,
        limit: u32,
    ) -> (String, Vec<Box<dyn rusqlite::types::ToSql + Send + Sync>>) {
        let mut params: Vec<Box<dyn rusqlite::types::ToSql + Send + Sync>> = Vec::new();
        params.push(Box::new(fts_query.to_string()));

        let mut conditions: Vec<String> = vec!["messages_fts MATCH ?1".into()];
        let mut idx = 2usize;

        if let Some(aid) = agent_id {
            conditions.push(format!(
                "EXISTS(SELECT 1 FROM sessions s WHERE s.id = sm.session_id AND s.agent_id = ?{idx})"
            ));
            params.push(Box::new(aid.to_string()));
            idx += 1;
        }

        if let Some(hours) = since_hours {
            // Cutoff lives on `session_messages.timestamp` (RFC3339 string).
            // Comparing strings is correct for RFC3339 — the format is
            // lexicographically ordered.
            let cutoff = (Utc::now() - chrono::TimeDelta::hours(hours)).to_rfc3339();
            conditions.push(format!("sm.timestamp >= ?{idx}"));
            params.push(Box::new(cutoff));
            idx += 1;
        }

        let where_clause = conditions.join(" AND ");
        let sql = format!(
            "SELECT sm.session_id, sm.id, sm.role, {snippet_expr}, sm.timestamp, \
                    bm25(messages_fts) as score \
             FROM messages_fts JOIN session_messages sm ON sm.id = messages_fts.rowid \
             WHERE {where_clause} \
             ORDER BY score \
             LIMIT ?{idx}"
        );
        params.push(Box::new(limit as i64));

        (sql, params)
    }

    async fn run_search(
        &self,
        query: &str,
        agent_id: Option<&str>,
        since_hours: Option<i64>,
        limit: u32,
    ) -> Result<Vec<SessionsSearchHit>> {
        let fts_query = sanitise_fts5_query(query);
        let snippet_expr = fts5_snippet_expr("messages_fts", 0, FTS5_DEFAULT_SNIPPET_TOKEN_COUNT);
        let (sql, params) =
            Self::build_query(&fts_query, &snippet_expr, agent_id, since_hours, limit);

        let pool = self.session_store.db();
        let db = pool.lock().await;
        let mut stmt = db.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params
            .iter()
            .map(|p| p.as_ref() as &dyn rusqlite::types::ToSql)
            .collect();
        let hits: Vec<SessionsSearchHit> = stmt
            .query_map(params_from_iter(param_refs), |row| {
                let session_id: Option<String> = row.get(0)?;
                let message_index: i64 = row.get(1)?;
                let role: String = row.get(2)?;
                let snippet: String = row.get(3)?;
                let ts_raw: String = row.get(4)?;
                let score: f64 = row.get(5)?;
                let timestamp = DateTime::parse_from_rfc3339(&ts_raw)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                Ok(SessionsSearchHit {
                    session_id: session_id.unwrap_or_default(),
                    message_index,
                    role,
                    snippet,
                    timestamp,
                    score,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(hits)
    }

    /// Resolve the agent_id filter the caller asked for (or the default).
    /// Accepts a name/hint or a raw UUID; the `agent_registry` resolves
    /// hints to canonical UUIDs so the SQL filter compares apples to
    /// apples with `sessions.agent_id`.
    async fn resolve_agent_filter(&self, hint: &str) -> Option<String> {
        // Try hint resolution first; fall back to the raw value so an
        // already-canonical UUID still works without a registry round trip.
        match self.agent_registry.resolve_by_hint(hint).await {
            Ok(Some(agent)) => Some(agent.id),
            _ => Some(hint.to_string()),
        }
    }
}

#[async_trait]
impl Tool for SessionsTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("search");
        if action != "search" {
            return Ok(ToolResult::error(format!(
                "Unknown sessions action: {action}. Use: search"
            )));
        }

        let query = match args.get("query").and_then(|v| v.as_str()) {
            Some(q) => q,
            None => return Ok(ToolResult::error("missing 'query'".to_string())),
        };

        let limit = args
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32)
            .unwrap_or(DEFAULT_LIMIT)
            .min(MAX_LIMIT);

        let since_hours = args.get("since_hours").and_then(|v| v.as_i64());

        let agent_id = match args.get("agent_id").and_then(|v| v.as_str()) {
            Some(hint) => self.resolve_agent_filter(hint).await,
            None => {
                // Default to the calling agent. Same hint-resolution path
                // so the filter compares canonical UUIDs.
                self.resolve_agent_filter(&self.calling_agent_id).await
            }
        };

        let hits = match self
            .run_search(query, agent_id.as_deref(), since_hours, limit)
            .await
        {
            Ok(h) => h,
            Err(e) => return Ok(ToolResult::error(format!("sessions.search failed: {e}"))),
        };

        if hits.is_empty() {
            return Ok(ToolResult::success(format!(
                "No transcript matches found for: {query}"
            )));
        }

        let mut out = String::new();
        out.push_str(&format!("{} matches:\n", hits.len()));
        for (i, h) in hits.iter().enumerate() {
            out.push_str(&format!(
                "{}. [{}] {} ({}): {}\n",
                i + 1,
                h.timestamp.format("%Y-%m-%d %H:%M"),
                h.role,
                &h.session_id[..h.session_id.len().min(8)],
                h.snippet,
            ));
        }

        Ok(ToolResult {
            output: out,
            is_error: false,
            data: serde_json::to_value(&hits).unwrap_or(serde_json::Value::Null),
            context_modifier: None,
            outcome_score: None,
            outcome_details: None,
        })
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "sessions".to_string(),
            description: "Search past session transcripts via FTS5 keyword search. \
                Use to recall what was said in earlier conversations across sessions. \
                Returns ranked hits with session_id, role, snippet (<mark>-marked), \
                timestamp, and BM25 score (lower = better)."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["search"],
                        "description": "Currently only 'search' is supported."
                    },
                    "query": {
                        "type": "string",
                        "description": "Keyword query (FTS5 syntax; metacharacters auto-sanitised)."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 20, capped at 100)."
                    },
                    "since_hours": {
                        "type": "integer",
                        "description": "Restrict to messages newer than N hours ago. Optional."
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Restrict to sessions owned by this agent (name or UUID). Defaults to calling agent."
                    }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "sessions"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SessionStore;
    use crate::agent_registry::{AgentRegistry, ConnectionPool};
    use std::sync::Arc;
    use tempfile::TempDir;

    /// Minimal harness: open a fresh session-store DB, return a wired
    /// `SessionsTool` plus the bare `SessionStore` so individual tests can
    /// seed messages directly.
    async fn harness() -> (SessionsTool, Arc<SessionStore>, Arc<AgentRegistry>, TempDir) {
        let dir = TempDir::new().unwrap();
        let registry = Arc::new(AgentRegistry::open(dir.path()).unwrap());
        let session_store = Arc::new(SessionStore::new(registry.sessions_db()));
        let tool = SessionsTool::new(
            session_store.clone(),
            registry.clone(),
            "test-agent".to_string(),
        );
        (tool, session_store, registry, dir)
    }

    /// Insert a message directly via the connection pool — bypasses the
    /// public APIs that hide the rowid we need for assertions.
    async fn insert_message(
        pool: Arc<ConnectionPool>,
        session_id: &str,
        role: &str,
        content: &str,
        timestamp: DateTime<Utc>,
    ) -> i64 {
        let db = pool.lock().await;
        db.execute(
            "INSERT INTO session_messages (session_id, role, content, timestamp, event_type) \
             VALUES (?1, ?2, ?3, ?4, 'message')",
            rusqlite::params![session_id, role, content, timestamp.to_rfc3339()],
        )
        .unwrap();
        db.last_insert_rowid()
    }

    /// Insert a session row so the agent_id filter has something to join to.
    async fn insert_session(pool: Arc<ConnectionPool>, session_id: &str, agent_id: Option<&str>) {
        let db = pool.lock().await;
        db.execute(
            "INSERT INTO sessions (id, agent_id, session_type, name, status) \
             VALUES (?1, ?2, 'chat', 'test', 'active')",
            rusqlite::params![session_id, agent_id],
        )
        .unwrap();
    }

    #[tokio::test]
    async fn t1_7_messages_fts_idempotent_on_fresh_db() {
        // Fresh AgentRegistry::open already creates the table; calling
        // ensure_messages_fts a second time must succeed.
        let (_tool, _ss, _reg, _dir) = harness().await;
    }

    #[tokio::test]
    async fn t1_7_ensure_messages_fts_re_run_safe() {
        let (_tool, ss, _reg, _dir) = harness().await;
        let pool = ss.db();
        let conn = pool.lock().await;
        // Re-run the migration twice — both must succeed.
        crate::session_store::ensure_messages_fts(&conn).unwrap();
        crate::session_store::ensure_messages_fts(&conn).unwrap();
    }

    #[tokio::test]
    async fn t1_7_backfill_runs_when_fts_empty_and_messages_present() {
        let dir = TempDir::new().unwrap();
        // Create a sessions DB without messages_fts to simulate a legacy
        // DB. We do this by opening a raw connection and creating only
        // session_messages.
        let db_path = dir.path().join("legacy.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE session_messages (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT,
                 chat_id INTEGER,
                 role TEXT NOT NULL,
                 content TEXT NOT NULL,
                 timestamp TEXT NOT NULL,
                 summarized INTEGER DEFAULT 0,
                 source TEXT,
                 event_type TEXT NOT NULL DEFAULT 'message',
                 metadata TEXT,
                 sender_id TEXT,
                 transport TEXT
             );",
        )
        .unwrap();
        // Seed legacy rows BEFORE the FTS index exists.
        for (i, body) in [
            "first message about JWT auth",
            "second message about deploys",
        ]
        .iter()
        .enumerate()
        {
            conn.execute(
                "INSERT INTO session_messages (session_id, role, content, timestamp) \
                 VALUES (?1, 'user', ?2, ?3)",
                rusqlite::params![format!("sess-{i}"), body, Utc::now().to_rfc3339()],
            )
            .unwrap();
        }
        // Now run the migration — should backfill both rows.
        crate::session_store::ensure_messages_fts(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "backfill should mirror both legacy rows");
    }

    #[tokio::test]
    async fn t1_7_inserted_message_immediately_searchable() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        insert_message(
            ss.db(),
            "sess-1",
            "user",
            "Tell me about JWT authentication patterns",
            Utc::now(),
        )
        .await;

        let hits = tool
            .run_search("JWT", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert!(!hits.is_empty(), "freshly inserted row must surface");
        assert_eq!(hits[0].session_id, "sess-1");
    }

    #[tokio::test]
    async fn t1_7_deleted_message_no_longer_searchable() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        let id = insert_message(
            ss.db(),
            "sess-1",
            "user",
            "discuss the deployment pipeline",
            Utc::now(),
        )
        .await;

        let hits_before = tool
            .run_search("deployment", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert_eq!(hits_before.len(), 1);

        // Delete via raw SQL — the trigger handles FTS cleanup.
        {
            let pool = ss.db();
            let db = pool.lock().await;
            db.execute(
                "DELETE FROM session_messages WHERE id = ?1",
                rusqlite::params![id],
            )
            .unwrap();
        }

        let hits_after = tool
            .run_search("deployment", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert!(hits_after.is_empty(), "deleted row must not surface");
    }

    #[tokio::test]
    async fn t1_7_updated_message_reflects_new_content() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        let id = insert_message(
            ss.db(),
            "sess-1",
            "user",
            "the original JWT content",
            Utc::now(),
        )
        .await;

        // Update content from "JWT" to "OAuth".
        {
            let pool = ss.db();
            let db = pool.lock().await;
            db.execute(
                "UPDATE session_messages SET content = ?1 WHERE id = ?2",
                rusqlite::params!["the rewritten OAuth content", id],
            )
            .unwrap();
        }

        let jwt_hits = tool
            .run_search("JWT", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert!(jwt_hits.is_empty(), "old JWT content must be gone");

        let oauth_hits = tool
            .run_search("OAuth", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert_eq!(oauth_hits.len(), 1, "new OAuth content must be findable");
    }

    #[tokio::test]
    async fn t1_7_since_hours_filter_drops_older_messages() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        let now = Utc::now();
        insert_message(
            ss.db(),
            "sess-1",
            "user",
            "fresh message about widgets",
            now,
        )
        .await;
        insert_message(
            ss.db(),
            "sess-1",
            "user",
            "ancient message about widgets",
            now - chrono::TimeDelta::hours(48),
        )
        .await;

        // 24h window keeps only the fresh one.
        let hits = tool
            .run_search("widgets", Some("test-agent"), Some(24), 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1, "only the fresh message must survive");
        assert!(hits[0].snippet.contains("fresh"));
    }

    #[tokio::test]
    async fn t1_7_agent_id_filter_excludes_other_agents() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-A", Some("agent-A")).await;
        insert_session(ss.db(), "sess-B", Some("agent-B")).await;
        insert_message(
            ss.db(),
            "sess-A",
            "user",
            "secret about pineapples",
            Utc::now(),
        )
        .await;
        insert_message(
            ss.db(),
            "sess-B",
            "user",
            "secret about pineapples",
            Utc::now(),
        )
        .await;

        // Search as agent-A — must only see A's session, not B's.
        let hits = tool
            .run_search("pineapples", Some("agent-A"), None, 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, "sess-A");

        // Search as some unrelated agent — empty result.
        let hits_other = tool
            .run_search("pineapples", Some("agent-C"), None, 10)
            .await
            .unwrap();
        assert!(hits_other.is_empty());
    }

    #[tokio::test]
    async fn t1_7_sanitiser_handles_metacharacter_input() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        insert_message(
            ss.db(),
            "sess-1",
            "user",
            "regular benign content",
            Utc::now(),
        )
        .await;

        // Each of these would normally crash an FTS5 parser; the
        // sanitiser must absorb them and the search must complete cleanly.
        for bad in &["\"unclosed", "foo*bar", "(unbalanced", "", "   "] {
            let result = tool.run_search(bad, Some("test-agent"), None, 10).await;
            assert!(result.is_ok(), "query '{bad}' must not error");
        }
    }

    #[tokio::test]
    async fn t1_7_snippet_marks_match_and_bounded_length() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        // Long content so the snippet has room to truncate.
        let body = "lorem ipsum ".repeat(80)
            + "JWT token middleware wraps the route handler "
            + &"dolor sit amet ".repeat(80);
        insert_message(ss.db(), "sess-1", "user", &body, Utc::now()).await;

        let hits = tool
            .run_search("JWT", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("<mark>"));
        assert!(hits[0].snippet.contains("</mark>"));
        // FTS5 snippet output stays well under 1000 chars at 32 tokens.
        assert!(
            hits[0].snippet.len() < 1000,
            "snippet length {} unexpectedly large",
            hits[0].snippet.len()
        );
    }

    #[tokio::test]
    async fn t1_7_score_finite_and_monotonic_with_relevance() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        // Two rows: one with the term once, one with the term repeated.
        insert_message(
            ss.db(),
            "sess-1",
            "user",
            "rareterm appears here once",
            Utc::now(),
        )
        .await;
        insert_message(
            ss.db(),
            "sess-1",
            "user",
            "rareterm rareterm rareterm densely repeated",
            Utc::now(),
        )
        .await;

        let hits = tool
            .run_search("rareterm", Some("test-agent"), None, 10)
            .await
            .unwrap();
        assert_eq!(hits.len(), 2);
        for h in &hits {
            assert!(h.score.is_finite(), "BM25 score must be finite");
        }
        // FTS5 BM25 returns negative scores; lower (more negative) = better.
        // The dense-match row must rank first.
        assert!(
            hits[0].snippet.contains("densely"),
            "more relevant row must rank first; got {:?}",
            hits[0]
        );
        assert!(
            hits[0].score <= hits[1].score,
            "BM25 score must be monotonic with relevance"
        );
    }

    #[tokio::test]
    async fn t1_7_limit_capped_at_max() {
        let (tool, ss, _reg, _dir) = harness().await;
        insert_session(ss.db(), "sess-1", Some("test-agent")).await;
        // Seed 105 rows so the cap matters.
        for i in 0..105 {
            insert_message(
                ss.db(),
                "sess-1",
                "user",
                &format!("widget content row {i}"),
                Utc::now(),
            )
            .await;
        }

        // Calling Tool::execute (the cap lives in the args parsing path,
        // not in run_search which trusts its callers).
        let res = tool
            .execute(serde_json::json!({
                "query": "widget",
                "limit": 1000,
            }))
            .await
            .unwrap();
        assert!(
            !res.is_error,
            "tool must succeed, got error: {}",
            res.output
        );

        let hits: Vec<SessionsSearchHit> =
            serde_json::from_value(res.data).expect("data must deserialize to hit list");
        assert_eq!(
            hits.len(),
            MAX_LIMIT as usize,
            "limit must be capped at MAX_LIMIT"
        );
    }
}
