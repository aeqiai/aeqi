//! IPC handlers for the three address verbs:
//!   - `message_to`     — append a message to a session, idea, agent, user, or role target
//!   - `add_participant` — add an identity to a session's participant roster
//!
//! Wave 1 implements the `session` and `idea` targets for `message_to`.
//! Wave 3 (role routing) implements `target_kind="role"`.
//! Wave 3 (agent tool) implements `target_kind="agent"` and `target_kind="user"`.

use super::request_field;

/// Handle a `message_to` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "target_kind":  "session" | "idea" | "agent" | "user" | "role",
///   "target_id":    "<id>",
///   "body":         "<message text>",
///   "from_kind":    "user" | "agent" | "system",
///   "from_id":      "<identity id>",
///   "payload_kind": null | "<discriminator>"
/// }
/// ```
///
/// For `target_kind="idea"`: if `ideas.session_id` is null, a new standalone
/// session is created and the idea row is updated to point at it before
/// appending the message.
///
/// For `target_kind="role"`: the role's current occupant is resolved;
/// a vacant role returns an error. A role-anchored session is
/// created on first use and reused on subsequent calls. The occupant is
/// added as a participant automatically.
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
                    // Auto-subscribe any @-mentioned identities. The message
                    // itself is the notification; no separate system message.
                    wire_at_mentions_in_message(ctx, ss, &target_id, &body).await;
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
                    // Auto-subscribe @-mentioned identities.
                    wire_at_mentions_in_message(ctx, ss, &session_id, &body).await;
                    serde_json::json!({
                        "ok": true,
                        "session_id": session_id,
                        "message_id": msg_id,
                    })
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }

        "role" => {
            // 1. Look up the role.
            let role = match ctx.role_registry.get(&target_id).await {
                Ok(Some(r)) => r,
                Ok(None) => {
                    return serde_json::json!({
                        "ok": false,
                        "error": "role not found",
                    });
                }
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            };

            // 2. Reject vacant roles — nowhere to deliver the message.
            if matches!(
                role.occupant_kind,
                crate::role_registry::OccupantKind::Vacant
            ) || role.occupant_id.is_none()
            {
                return serde_json::json!({
                    "ok": false,
                    "error": "role has no occupant",
                });
            }
            let occupant_kind = role.occupant_kind;
            let occupant_id = role.occupant_id.as_deref().unwrap_or("");

            // 3. Resolve or create the role-anchored session.
            //    The session is shared across all callers targeting this role;
            //    we key on (role_id, calling_agent from_id) to find an
            //    existing session where the caller is already a participant.
            let caller_agent_id = from_id.as_deref().unwrap_or("");
            let session_id = if !caller_agent_id.is_empty() {
                match ss.find_role_session(&target_id, caller_agent_id).await {
                    Ok(Some(sid)) => sid,
                    Ok(None) => {
                        // First addressing — create a fresh role-anchored session.
                        let title = format!("role:{}", target_id);
                        let sid = match ss.create_role_session(&target_id, &title).await {
                            Ok(s) => s,
                            Err(e) => {
                                return serde_json::json!({"ok": false, "error": e.to_string()});
                            }
                        };
                        // Add the calling agent as a participant.
                        let _ = ss
                            .add_session_participant(&sid, "agent", caller_agent_id, None)
                            .await;
                        sid
                    }
                    Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
                }
            } else {
                // No caller identity — still need a session. Create one.
                let title = format!("role:{}", target_id);
                match ss.create_role_session(&target_id, &title).await {
                    Ok(s) => s,
                    Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
                }
            };

            // 4. Ensure the role's current occupant is a participant.
            let occupant_kind_str = match occupant_kind {
                crate::role_registry::OccupantKind::Human => "user",
                crate::role_registry::OccupantKind::Agent => "agent",
                crate::role_registry::OccupantKind::Company => "company",
                crate::role_registry::OccupantKind::Vacant => unreachable!(),
            };
            let _ = ss
                .add_session_participant(&session_id, occupant_kind_str, occupant_id, None)
                .await;

            // 5. Append the message.
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

        "agent" => {
            // Find or create a 1:1 agent↔agent DM session.
            let dm_name = format!(
                "dm:agent:{}:agent:{}",
                from_id.as_deref().unwrap_or("unknown"),
                target_id
            );
            match ss
                .find_or_create_dm_session(
                    "agent_agent_dm",
                    &dm_name,
                    "agent",
                    from_id.as_deref().unwrap_or(""),
                    "agent",
                    &target_id,
                )
                .await
            {
                Ok((session_id, _created)) => {
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
                            // Auto-subscribe @-mentioned identities.
                            wire_at_mentions_in_message(ctx, ss, &session_id, &body).await;
                            serde_json::json!({
                                "ok": true,
                                "session_id": session_id,
                                "message_id": msg_id,
                            })
                        }
                        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                    }
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }

        "user" => {
            // Find or create a 1:1 agent↔user DM session.
            let dm_name = format!(
                "dm:agent:{}:user:{}",
                from_id.as_deref().unwrap_or("unknown"),
                target_id
            );
            match ss
                .find_or_create_dm_session(
                    "agent_user_dm",
                    &dm_name,
                    "agent",
                    from_id.as_deref().unwrap_or(""),
                    "user",
                    &target_id,
                )
                .await
            {
                Ok((session_id, _created)) => {
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
                            // Auto-subscribe @-mentioned identities.
                            wire_at_mentions_in_message(ctx, ss, &session_id, &body).await;
                            serde_json::json!({
                                "ok": true,
                                "session_id": session_id,
                                "message_id": msg_id,
                            })
                        }
                        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                    }
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
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

// ── @-mention wiring for messages ────────────────────────────────────────────

/// Parse `@<token>` mentions from a message body, auto-subscribe each
/// resolved identity as a `session_participant` (`joined_by = "mention"`),
/// and — for agent mentions — enqueue a spawn so the mentioned agent reads
/// the message and replies. Parity with the Telegram mention-gate: the
/// front door to the in-app channel surface.
///
/// Order is participant-add → enqueue (subscribe-then-send), so a
/// non-participant agent is silently auto-added BEFORE its spawn fires.
///
/// No separate system message is emitted — the message itself is the
/// notification (Linear / Notion behaviour).
///
/// Fuzzy mentions (bare `@name`) resolve via agent-name lookup only.
/// Unresolved mentions are skipped silently. Non-agent mentions
/// (`@user:`, `@position:`) subscribe but do not spawn — those identities
/// are humans or organizational pointers, not agents you can call.
async fn wire_at_mentions_in_message(
    ctx: &super::CommandContext,
    ss: &std::sync::Arc<crate::session_store::SessionStore>,
    session_id: &str,
    body: &str,
) {
    let mentions = crate::mentions::parse_mentions(body);
    if mentions.is_empty() {
        return;
    }

    for m in &mentions {
        let (resolved_kind, resolved_id): (&str, String) = match m.kind.as_str() {
            crate::mentions::KIND_AGENT => (crate::mentions::KIND_AGENT, m.id.clone()),
            crate::mentions::KIND_USER => (crate::mentions::KIND_USER, m.id.clone()),
            crate::mentions::KIND_POSITION => (crate::mentions::KIND_POSITION, m.id.clone()),
            crate::mentions::KIND_FUZZY => {
                match ctx.agent_registry.get_active_by_name(&m.id).await {
                    Ok(Some(agent)) => (crate::mentions::KIND_AGENT, agent.id),
                    _ => {
                        tracing::debug!(name = %m.id, "wire_at_mentions_in_message: unresolved fuzzy mention");
                        continue;
                    }
                }
            }
            _ => continue,
        };

        // Idempotent subscribe — no system message (the message itself notifies).
        // Auto-adds non-participant agents silently per Linear/Notion behaviour.
        let _ = ss
            .add_session_participant(session_id, resolved_kind, &resolved_id, Some("mention"))
            .await;

        // Spawn enqueue: only agent mentions trigger an agent run. Users and
        // roles get participant rows for visibility but no spawn (humans
        // aren't callable, role-routing is its own target_kind path).
        if resolved_kind == crate::mentions::KIND_AGENT {
            enqueue_mention_spawn(ctx, ss.clone(), session_id, &resolved_id, body).await;
        }
    }
}

/// Build a `chat`-shaped `QueuedMessage` for a mentioned agent and push it
/// onto the per-session pending queue. The original message body has
/// already been recorded by `append_message_from`; we mark
/// `initial_message_recorded` so `spawn_session` doesn't write it twice.
///
/// Degrades silently when `default_provider` is None — the daemon hasn't
/// finished bootstrapping. The participant subscription persists; a
/// future trigger picks the agent up.
async fn enqueue_mention_spawn(
    ctx: &super::CommandContext,
    ss: std::sync::Arc<crate::session_store::SessionStore>,
    session_id: &str,
    agent_id: &str,
    body: &str,
) {
    let Some(provider) = ctx.default_provider.clone() else {
        tracing::warn!(
            session_id,
            agent_id,
            "mention spawn: no default_provider; participant added but spawn deferred"
        );
        return;
    };

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

    let qm = crate::queue_executor::QueuedMessage::chat(
        agent_id.to_string(),
        body.to_string(),
        None,
        Some("mention".to_string()),
    )
    .with_initial_message_recorded();

    let payload = match qm.to_payload() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                session_id,
                agent_id,
                error = %e,
                "mention spawn: payload encode failed"
            );
            return;
        }
    };

    if let Err(e) = crate::session_queue::enqueue(ss, executor, session_id, &payload).await {
        tracing::warn!(
            session_id,
            agent_id,
            error = %e,
            "mention spawn: enqueue failed"
        );
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
            role_registry: Arc::new(crate::role_registry::RoleRegistry::open(registry.db())),
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
        let before = idea_store
            .get_by_ids(std::slice::from_ref(&idea_id))
            .await
            .unwrap();
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
        let after = idea_store
            .get_by_ids(std::slice::from_ref(&idea_id))
            .await
            .unwrap();
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

    // ── Wave 3: position target tests ────────────────────────────────────────

    /// Build a ctx + occupied role for role-routing tests.
    async fn setup_role_ctx() -> (
        CommandContext,
        Arc<crate::session_store::SessionStore>,
        String, // role_id of an agent-occupied role
        String, // occupant agent_id
        tempfile::TempDir,
    ) {
        let (ctx, ss, _, dir) = test_ctx_with_ideas().await;

        // Create an entity + position occupied by an agent.
        let entity = ctx
            .entity_registry
            .create_new(
                "Test Co",
                "testco",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .unwrap();

        let agent_id = "agent-occupant-001".to_string();
        let pos = ctx
            .role_registry
            .create(
                &entity.id,
                "CEO",
                crate::role_registry::OccupantKind::Agent,
                Some(&agent_id),
            )
            .await
            .unwrap();

        (ctx, ss, pos.id, agent_id, dir)
    }

    #[tokio::test]
    async fn message_to_role_creates_session_and_adds_occupant() {
        let (ctx, ss, pos_id, agent_id, _dir) = setup_role_ctx().await;

        let req = serde_json::json!({
            "target_kind": "role",
            "target_id": pos_id,
            "body": "hello from calling agent",
            "from_kind": "agent",
            "from_id": "agent-caller-001",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        let session_id = resp["session_id"].as_str().unwrap().to_string();
        assert!(!session_id.is_empty());

        // Occupant must be a participant.
        let participants = {
            let pool = ss.db();
            let db = pool.lock().await;
            let mut stmt = db
                .prepare(
                    "SELECT identity_kind, identity_id FROM session_participants \
                     WHERE session_id = ?1",
                )
                .unwrap();
            stmt.query_map(rusqlite::params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
        };
        assert!(
            participants
                .iter()
                .any(|(k, id)| k == "agent" && id == &agent_id),
            "occupant agent must be a participant; got {participants:?}"
        );

        // target_role_id must be set on the session.
        let session = ss.get_session(&session_id).await.unwrap().unwrap();
        // We can't read target_role_id via Session struct yet; verify via raw SQL.
        let stored_pos_id: String = {
            let pool = ss.db();
            let db = pool.lock().await;
            db.query_row(
                "SELECT target_role_id FROM sessions WHERE id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .unwrap()
        };
        assert_eq!(stored_pos_id, pos_id);
        // Status must be active.
        assert_eq!(session.status, "active");
    }

    #[tokio::test]
    async fn message_to_vacant_role_returns_error() {
        let (ctx, _ss, _pos_id, _agent_id, _dir) = setup_role_ctx().await;

        // Create a separate vacant position.
        let entity = ctx
            .entity_registry
            .create_new(
                "Vacant Co",
                "vacantco",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .unwrap();
        let vacant_role = ctx
            .role_registry
            .create(
                &entity.id,
                "CFO",
                crate::role_registry::OccupantKind::Vacant,
                None,
            )
            .await
            .unwrap();

        let req = serde_json::json!({
            "target_kind": "role",
            "target_id": vacant_role.id,
            "body": "message to nobody",
            "from_kind": "agent",
            "from_id": "agent-caller-001",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], false, "vacant role must return error");
        let err = resp["error"].as_str().unwrap_or("");
        assert!(
            err.contains("no occupant"),
            "error must mention no occupant; got: {err}"
        );
    }

    #[tokio::test]
    async fn message_to_role_reuses_session_after_second_call() {
        let (ctx, _ss, pos_id, _agent_id, _dir) = setup_role_ctx().await;

        let req = serde_json::json!({
            "target_kind": "role",
            "target_id": pos_id,
            "body": "first message",
            "from_kind": "agent",
            "from_id": "agent-caller-001",
        });

        let resp1 = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp1["ok"], true);
        let session_id_1 = resp1["session_id"].as_str().unwrap().to_string();

        let req2 = serde_json::json!({
            "target_kind": "role",
            "target_id": pos_id,
            "body": "second message",
            "from_kind": "agent",
            "from_id": "agent-caller-001",
        });

        let resp2 = handle_message_to(&ctx, &req2, &None).await;
        assert_eq!(resp2["ok"], true);
        let session_id_2 = resp2["session_id"].as_str().unwrap().to_string();

        assert_eq!(
            session_id_1, session_id_2,
            "second message_to same role must reuse the same session"
        );
    }

    // ── Wave 3: agent/user DM target tests ───────────────────────────────────

    /// message_to(target=user) creates a 1:1 agent↔user DM session and appends
    /// the message with from_kind=agent, from_id=<calling agent>.
    #[tokio::test]
    async fn message_to_user_target_creates_dm_and_appends() {
        let (ctx, ss, _, _dir) = test_ctx_with_ideas().await;

        let req = serde_json::json!({
            "target_kind": "user",
            "target_id": "user-owner-1",
            "body": "please approve this budget",
            "from_kind": "agent",
            "from_id": "agent-abc",
            "payload_kind": "decision_request",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        let session_id = resp["session_id"].as_str().unwrap().to_string();
        assert!(!session_id.is_empty());
        assert!(resp["message_id"].is_number());

        // Session is a DM of type agent_user_dm.
        let session = ss.get_session(&session_id).await.unwrap().unwrap();
        assert_eq!(session.session_type, "agent_user_dm");

        // Message is recorded with correct content.
        // Use timeline (not history) because payload_kind sets event_type and
        // history_by_session filters for event_type='message' only.
        let msgs = ss.timeline_by_session(&session_id, 10).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "please approve this budget");

        // Second call reuses the same session (idempotent DM creation).
        let req2 = serde_json::json!({
            "target_kind": "user",
            "target_id": "user-owner-1",
            "body": "second message",
            "from_kind": "agent",
            "from_id": "agent-abc",
        });
        let resp2 = handle_message_to(&ctx, &req2, &None).await;
        assert_eq!(resp2["ok"], true, "second call response: {resp2}");
        assert_eq!(
            resp2["session_id"], session_id,
            "second message must land in the same DM session"
        );
    }

    /// message_to(target=agent) creates a 1:1 agent↔agent DM session and appends
    /// the message with from_kind=agent.
    #[tokio::test]
    async fn message_to_agent_target_creates_dm_and_appends() {
        let (ctx, ss, _, _dir) = test_ctx_with_ideas().await;

        let req = serde_json::json!({
            "target_kind": "agent",
            "target_id": "agent-target-1",
            "body": "here is the status update",
            "from_kind": "agent",
            "from_id": "agent-sender-1",
            "payload_kind": "status_update",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        let session_id = resp["session_id"].as_str().unwrap().to_string();
        assert!(!session_id.is_empty());

        // Session is a DM of type agent_agent_dm.
        let session = ss.get_session(&session_id).await.unwrap().unwrap();
        assert_eq!(session.session_type, "agent_agent_dm");

        // Message is recorded. Use timeline (not history) — payload_kind sets
        // event_type and history_by_session only returns event_type='message' rows.
        let msgs = ss.timeline_by_session(&session_id, 10).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "here is the status update");

        // Symmetry check: a reverse message also lands in the SAME session.
        let req_reverse = serde_json::json!({
            "target_kind": "agent",
            "target_id": "agent-sender-1",
            "body": "acknowledged",
            "from_kind": "agent",
            "from_id": "agent-target-1",
        });
        let resp_reverse = handle_message_to(&ctx, &req_reverse, &None).await;
        assert_eq!(resp_reverse["ok"], true, "reverse: {resp_reverse}");
        assert_eq!(
            resp_reverse["session_id"], session_id,
            "reverse message must land in the same DM session"
        );
    }

    // ── @-mention in message body ────────────────────────────────────────

    #[tokio::test]
    async fn message_with_agent_mention_subscribes_participant() {
        let (ctx, ss, _, _dir) = test_ctx_with_ideas().await;

        // Create an agent that can be @-mentioned.
        let agent_id = ctx
            .agent_registry
            .spawn("mention-bot", None, Some("test"))
            .await
            .unwrap()
            .id;

        let session_id = ss
            .create_standalone_session("mention-test-session", "thread")
            .await
            .unwrap();

        let req = serde_json::json!({
            "target_kind": "session",
            "target_id": session_id,
            "body": format!("hey @agent:{agent_id} can you help?"),
            "from_kind": "user",
            "from_id": "user-99",
        });

        let resp = handle_message_to(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");

        // The mentioned agent must now be a participant.
        let participants = ss.list_participants(&session_id).await.unwrap();
        let found = participants
            .iter()
            .any(|p| p.identity_kind == "agent" && p.identity_id == agent_id);
        assert!(
            found,
            "mentioned agent should be subscribed; participants: {participants:?}"
        );

        // No extra system message for message-path mentions.
        let timeline = ss.timeline_by_session(&session_id, 20).await.unwrap();
        let system_msgs: Vec<_> = timeline.iter().filter(|m| m.role == "system").collect();
        assert!(
            system_msgs.is_empty(),
            "message-path mention must not emit a system notification; got: {system_msgs:?}"
        );
    }

    #[tokio::test]
    async fn message_mention_is_idempotent_no_double_subscribe() {
        let (ctx, ss, _, _dir) = test_ctx_with_ideas().await;

        let agent_id = ctx
            .agent_registry
            .spawn("idempotent-bot", None, Some("test"))
            .await
            .unwrap()
            .id;

        let session_id = ss
            .create_standalone_session("idempotent-mention-session", "thread")
            .await
            .unwrap();

        let body = format!("@agent:{agent_id} once");
        let req = serde_json::json!({
            "target_kind": "session",
            "target_id": session_id,
            "body": body,
            "from_kind": "user",
            "from_id": "user-1",
        });

        // Send twice.
        handle_message_to(&ctx, &req, &None).await;
        handle_message_to(&ctx, &req, &None).await;

        // Only one participant row.
        let participants = ss.list_participants(&session_id).await.unwrap();
        let count = participants
            .iter()
            .filter(|p| p.identity_kind == "agent" && p.identity_id == agent_id)
            .count();
        assert_eq!(
            count, 1,
            "duplicate mention must not create duplicate participant"
        );
    }
}
