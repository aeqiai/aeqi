//! IPC handlers for the three address verbs:
//!   - `message_to`     — append a message to a session, idea, agent, or user target
//!   - `add_participant` — add an identity to a session's participant roster
//!
//! Wave 1 implements the `session` and `idea` targets for `message_to`.
//! The `agent` and `user` targets are stubbed and return a clear "not yet wired"
//! error rather than silently succeeding or panicking.

use super::request_field;

/// Handle a `message_to` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "target_kind": "session" | "idea" | "agent" | "user",
///   "target_id":   "<id>",
///   "body":        "<message text>",
///   "from_kind":   "user" | "agent" | "position" | "system",
///   "from_id":     "<identity id>",
///   "payload_kind": null | "<discriminator>"
/// }
/// ```
///
/// For `target_kind="idea"`: if `ideas.session_id` is null, a new standalone
/// session is created and the idea row is updated to point at it before
/// appending the message.
pub async fn handle_message_to(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let target_kind = match request_field(request, "target_kind") {
        Some(k) => k,
        None => return serde_json::json!({"ok": false, "error": "target_kind required"}),
    };
    let target_id = match request_field(request, "target_id") {
        Some(id) => id.to_string(),
        None => return serde_json::json!({"ok": false, "error": "target_id required"}),
    };
    let body = match request_field(request, "body") {
        Some(b) => b.to_string(),
        None => return serde_json::json!({"ok": false, "error": "body required"}),
    };
    let from_kind = request_field(request, "from_kind").unwrap_or("user");
    let from_id = request_field(request, "from_id").map(|s| s.to_string());
    let payload_kind = request_field(request, "payload_kind").map(|s| s.to_string());

    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };

    match target_kind {
        "session" => {
            // Append directly to the named session.
            match ss
                .append_message_from(
                    &target_id,
                    role_for_from_kind(from_kind),
                    &body,
                    from_kind,
                    from_id.as_deref(),
                    payload_kind.as_deref(),
                )
                .await
            {
                Ok(msg_id) => {
                    serde_json::json!({"ok": true, "session_id": target_id, "message_id": msg_id})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }

        "idea" => {
            let Some(ref idea_store) = ctx.idea_store else {
                return serde_json::json!({"ok": false, "error": "idea store not available"});
            };

            // Look up the idea's current session_id.
            let idea = match idea_store
                .get_by_ids(std::slice::from_ref(&target_id))
                .await
            {
                Ok(ideas) if !ideas.is_empty() => ideas.into_iter().next().unwrap(),
                Ok(_) => return serde_json::json!({"ok": false, "error": "idea not found"}),
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            };

            // Lazy-create the session when missing.
            let session_id = if let Some(ref sid) = idea.session_id {
                sid.clone()
            } else {
                // Create a standalone session and backfill ideas.session_id.
                let sid = match ss
                    .create_standalone_session(&format!("idea:{}", idea.name), "idea")
                    .await
                {
                    Ok(s) => s,
                    Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
                };

                // Update ideas.session_id via the AgentRegistry's aeqi.db pool.
                // The ideas table lives in aeqi.db, not sessions.db.
                let pool = ctx.agent_registry.db();
                let conn = pool.lock().await;
                match conn.execute(
                    "UPDATE ideas SET session_id = ?1 WHERE id = ?2",
                    rusqlite::params![sid.as_str(), target_id.as_str()],
                ) {
                    Ok(_) => {}
                    Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
                }
                drop(conn);

                sid
            };

            match ss
                .append_message_from(
                    &session_id,
                    role_for_from_kind(from_kind),
                    &body,
                    from_kind,
                    from_id.as_deref(),
                    payload_kind.as_deref(),
                )
                .await
            {
                Ok(msg_id) => {
                    serde_json::json!({
                        "ok": true,
                        "session_id": session_id,
                        "message_id": msg_id,
                    })
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }

        "agent" | "user" => {
            serde_json::json!({
                "ok": false,
                "error": format!("target_kind={target_kind} is not yet wired in Wave 1"),
            })
        }

        other => {
            serde_json::json!({
                "ok": false,
                "error": format!("unknown target_kind: {other}"),
            })
        }
    }
}

/// Handle an `add_participant` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "session_id":    "<uuid>",
///   "identity_kind": "user" | "agent" | "position" | "external",
///   "identity_id":   "<id>",
///   "joined_by":     "<id>" (optional)
/// }
/// ```
///
/// Inserts a row in `session_participants` (idempotent — duplicate silently
/// ignored) and appends a system message `"<identity_kind>:<identity_id> joined"`.
pub async fn handle_add_participant(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let session_id = match request_field(request, "session_id") {
        Some(id) => id.to_string(),
        None => return serde_json::json!({"ok": false, "error": "session_id required"}),
    };
    let identity_kind = match request_field(request, "identity_kind") {
        Some(k) => k.to_string(),
        None => return serde_json::json!({"ok": false, "error": "identity_kind required"}),
    };
    let identity_id = match request_field(request, "identity_id") {
        Some(id) => id.to_string(),
        None => return serde_json::json!({"ok": false, "error": "identity_id required"}),
    };
    let joined_by = request_field(request, "joined_by").map(|s| s.to_string());

    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };

    let inserted = match ss
        .add_session_participant(
            &session_id,
            &identity_kind,
            &identity_id,
            joined_by.as_deref(),
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Append system activity message regardless of whether the row was new —
    // only when the participant was genuinely added (not a duplicate).
    if inserted {
        let join_body = format!("{identity_kind}:{identity_id} joined");
        let _ = ss
            .append_message_from(&session_id, "system", &join_body, "system", None, None)
            .await;
    }

    serde_json::json!({
        "ok": true,
        "session_id": session_id,
        "inserted": inserted,
    })
}

/// Map a `from_kind` to the legacy `role` column so existing queries that
/// filter by `role` continue to work.
fn role_for_from_kind(from_kind: &str) -> &'static str {
    match from_kind {
        "user" => "user",
        "agent" | "position" => "assistant",
        _ => "system",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::CommandContext;
    use std::sync::Arc;

    /// Build a minimal `CommandContext` backed by temp-file databases.
    ///
    /// `AgentRegistry::open` writes aeqi.db + sessions.db into `data_dir`.
    /// `SqliteIdeas` opens aeqi.db independently (WAL mode allows concurrent
    /// readers/writers). Both share the same file so the UPDATE issued by
    /// `message_to(idea)` is visible to the idea_store's next `get_by_ids`.
    async fn test_ctx_with_ideas() -> (
        CommandContext,
        Arc<crate::session_store::SessionStore>,
        Arc<dyn aeqi_core::traits::IdeaStore>,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().unwrap();

        // AgentRegistry::open sets up aeqi.db and sessions.db inside `dir`.
        let registry = Arc::new(crate::agent_registry::AgentRegistry::open(dir.path()).unwrap());

        // sessions.db in-memory for the session store under test.
        let sessions_pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = sessions_pool.lock().await;
            crate::session_store::SessionStore::create_tables(&conn).unwrap();
        }
        let ss = Arc::new(crate::session_store::SessionStore::new(Arc::new(
            sessions_pool,
        )));

        // ideas store on the same aeqi.db file.
        let ideas: Arc<dyn aeqi_core::traits::IdeaStore> =
            Arc::new(aeqi_ideas::SqliteIdeas::open(&dir.path().join("aeqi.db"), 30.0).unwrap());

        let ctx = build_test_ctx(Arc::clone(&registry), Arc::clone(&ss), Arc::clone(&ideas));
        (ctx, ss, ideas, dir)
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
    async fn message_to_session_target_appends_message() {
        let (ctx, ss, _, _dir) = test_ctx_with_ideas().await;

        // Create a session to send to.
        let session_id = ss
            .create_standalone_session("test-session", "thread")
            .await
            .unwrap();

        let req = serde_json::json!({
            "target_kind": "session",
            "target_id": session_id,
            "body": "hello from test",
            "from_kind": "user",
            "from_id": "user-1",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["session_id"], session_id);
        assert!(resp["message_id"].is_number());
    }

    #[tokio::test]
    async fn message_to_idea_creates_session_lazily() {
        let (ctx, ss, idea_store, _dir) = test_ctx_with_ideas().await;

        // Store a minimal idea with no session_id.
        let idea_id = idea_store
            .store("test-idea", "idea body for test", &[], None)
            .await
            .unwrap();

        // Verify no session_id yet.
        let before = idea_store.get_by_ids(&[idea_id.clone()]).await.unwrap();
        assert!(
            before[0].session_id.is_none(),
            "session_id should be null before first message"
        );

        let req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "first comment on this idea",
            "from_kind": "user",
            "from_id": "user-2",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        let session_id = resp["session_id"].as_str().unwrap().to_string();
        assert!(!session_id.is_empty());

        // Verify session_id was backfilled on the idea row.
        let after = idea_store.get_by_ids(&[idea_id.clone()]).await.unwrap();
        assert_eq!(
            after[0].session_id.as_deref(),
            Some(session_id.as_str()),
            "idea.session_id must be updated to the new session"
        );

        // Session should exist and have one message.
        let msgs = ss.history_by_session(&session_id, 10).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "first comment on this idea");

        // Second call must reuse the same session.
        let req2 = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "second comment",
            "from_kind": "user",
            "from_id": "user-2",
        });
        let resp2 = handle_message_to(&ctx, &req2, &None).await;
        assert_eq!(resp2["ok"], true);
        assert_eq!(
            resp2["session_id"], session_id,
            "second message must land in the same session"
        );
    }

    #[tokio::test]
    async fn add_participant_inserts_row_and_emits_system_message() {
        let (ctx, ss, _, _dir) = test_ctx_with_ideas().await;

        let session_id = ss
            .create_standalone_session("test-participants", "thread")
            .await
            .unwrap();

        let req = serde_json::json!({
            "session_id": session_id,
            "identity_kind": "user",
            "identity_id": "user-abc",
        });

        let resp = handle_add_participant(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["inserted"], true);

        // Duplicate call is idempotent — no second row.
        let resp2 = handle_add_participant(&ctx, &req, &None).await;
        assert_eq!(resp2["ok"], true);
        assert_eq!(
            resp2["inserted"], false,
            "second call must not insert again"
        );

        // System message was emitted (timeline includes all event_types/roles).
        let timeline = ss.timeline_by_session(&session_id, 10).await.unwrap();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].content, "user:user-abc joined");
        assert_eq!(timeline[0].role, "system");
    }
}
