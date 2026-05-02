// design note: Runtime tools live in this directory, separate from the
// LLM-facing tools in tools.rs. The distinction matters for ACL enforcement:
// several runtime tools are event_only (transcript.inject, ideas.assemble)
// because allowing the LLM to call them directly would let a jailbreak inject
// arbitrary transcript messages or assemble arbitrary ideas without a
// configured event.
//
// The ToolRegistry is built by build_runtime_registry() which applies the
// correct event_only / llm_only flags. Callers that want just the tool vec
// for the LLM-facing executor can call all_tools() on the resulting registry
// and filter by can_call(name, CallerKind::Llm).

pub mod ideas_assemble;
pub mod ideas_search;
pub mod ideas_store;
pub mod ideas_store_many;
pub mod message_to;
pub mod question_ask;
pub mod session_spawn;
pub mod session_status;
pub mod transcript_inject;
pub mod transcript_replace_middle;
pub mod validators;

pub use ideas_assemble::IdeasAssembleTool;
pub use ideas_search::IdeasSearchTool;
pub use ideas_store::IdeasStoreTool;
pub use ideas_store_many::IdeasStoreManyTool;
pub use message_to::{MessageToFn, MessageToRequest, MessageToResult, MessageToTool};
pub use question_ask::{AskFn, AskRequest, QuestionAskTool};
pub use session_spawn::{SessionSpawnTool, SpawnFn, SpawnRequest};
pub use session_status::SessionStatusTool;
pub use transcript_inject::TranscriptInjectTool;
pub use transcript_replace_middle::TranscriptReplaceMiddleTool;

use std::collections::HashMap;
use std::sync::Arc;

use aeqi_core::tool_registry::{CallerKind, ToolRegistry};
use aeqi_core::traits::{IdeaStore, Tool, ToolSpec};
use aeqi_ideas::tag_policy::TagPolicyCache;

use crate::session_store::SessionStore;

/// Build a ToolRegistry containing all runtime tools with their correct ACLs.
///
/// Tools marked `event_only` can only be fired by event tool_calls, not by the LLM.
/// Tools not restricted are callable by both LLM and events.
///
/// `idea_store`: must be provided for ideas.assemble and ideas.search to work.
/// `session_store`: must be provided for transcript.inject to work.
/// `spawn_fn`: when `Some`, wires `session.spawn` so it can actually spawn sessions.
///   When `None`, the tool is present in the registry but returns an error on call
///   (stub mode — safe for contexts where SessionManager is not yet available).
pub fn build_runtime_registry(
    idea_store: Option<Arc<dyn IdeaStore>>,
    session_store: Option<Arc<SessionStore>>,
) -> ToolRegistry {
    build_runtime_registry_with_spawn(idea_store, session_store, None)
}

/// Like `build_runtime_registry` but with an explicit `SpawnFn` for `session.spawn`.
/// Called by `SessionManager::spawn_session` which injects a closure that captures
/// a `Weak<SessionManager>` to break the ownership cycle.
///
/// `can_self_delegate` mirrors the per-agent DB flag: when `false`, `session.spawn`
/// rejects the call with a capability error. Defaults to `false`; transport-bound
/// agents pass `true`.
pub fn build_runtime_registry_with_spawn(
    idea_store: Option<Arc<dyn IdeaStore>>,
    session_store: Option<Arc<SessionStore>>,
    spawn_fn: Option<SpawnFn>,
) -> ToolRegistry {
    build_runtime_registry_with_spawn_and_caps(idea_store, session_store, spawn_fn, false)
}

/// Full constructor — same as `build_runtime_registry_with_spawn` but
/// accepts the `can_self_delegate` capability flag.
pub fn build_runtime_registry_with_spawn_and_caps(
    idea_store: Option<Arc<dyn IdeaStore>>,
    session_store: Option<Arc<SessionStore>>,
    spawn_fn: Option<SpawnFn>,
    can_self_delegate: bool,
) -> ToolRegistry {
    build_runtime_registry_full(idea_store, session_store, spawn_fn, can_self_delegate, None)
}

/// Superset constructor that accepts an optional [`TagPolicyCache`]. Used
/// by the daemon to wire the cache into [`IdeasStoreManyTool`] so it can
/// enforce the T1.1 `max_items_per_call` blast-radius cap. Other call
/// sites (tests, harnesses) keep using the narrower constructors and pass
/// `None` for the cache, preserving the pre-T1.1 unbounded-batch
/// behaviour exactly.
pub fn build_runtime_registry_full(
    idea_store: Option<Arc<dyn IdeaStore>>,
    session_store: Option<Arc<SessionStore>>,
    spawn_fn: Option<SpawnFn>,
    can_self_delegate: bool,
    tag_policy_cache: Option<Arc<TagPolicyCache>>,
) -> ToolRegistry {
    let spawn_tool: Arc<dyn Tool> = match spawn_fn {
        Some(f) => Arc::new(SessionSpawnTool::new(f, can_self_delegate)),
        None => Arc::new(SessionSpawnTool::stub()),
    };
    let tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(IdeasAssembleTool::new(idea_store.clone())),
        Arc::new(IdeasSearchTool::new(idea_store.clone())),
        Arc::new(IdeasStoreTool::new(idea_store.clone())),
        Arc::new(IdeasStoreManyTool::new(idea_store).with_tag_policy_cache(tag_policy_cache)),
        Arc::new(TranscriptInjectTool::new(session_store.clone())),
        Arc::new(TranscriptReplaceMiddleTool::new(session_store)),
        Arc::new(SessionStatusTool),
        Arc::new(QuestionAskTool::stub()),
        Arc::new(MessageToTool::stub()),
        spawn_tool,
    ];

    let mut reg = ToolRegistry::new(tools);
    reg.set_llm_only("question.ask");

    // message_to: LLM-only — agents send outbound messages to targets.
    // Events should not be able to manufacture agent-attributed messages.
    reg.set_llm_only("message_to");

    // ideas.assemble: event-only — fetches by name and injects context.
    // Allowing the LLM to call this directly would let it inject arbitrary ideas.
    reg.set_event_only("ideas.assemble");

    // ideas.store: event-only — persists consolidation / reflection results
    // as ideas. The LLM-facing surface is the MCP `ideas(action='store')`
    // IPC handler (full dedup + tag policies). This internal tool is a
    // focused writer used by events like `ideas:threshold_reached`.
    reg.set_event_only("ideas.store");

    // ideas.store_many: event-only — batch writer that takes a JSON array
    // from a preceding session.spawn tool_call and stores every entry.
    // This is the persistence half of the reflection / consolidation
    // event chain (the sub-agent generates JSON; this tool writes it).
    // Allowing the LLM to call this would be an arbitrary-write surface.
    reg.set_event_only("ideas.store_many");

    // transcript.inject: event-only — adds messages directly to the transcript.
    // Allowing the LLM to call this would be a self-injection attack surface.
    reg.set_event_only("transcript.inject");

    // transcript.replace_middle: event-only — removes middle transcript messages
    // and inserts a replacement. Allowing the LLM to call this would be a
    // self-lobotomy attack surface (model could erase its own history).
    reg.set_event_only("transcript.replace_middle");

    // ideas.search: open — LLM and events can both run semantic searches.
    // session.status: open — anyone can emit a status message.
    // session.spawn: LLM can spawn sessions (for delegation); events can too.
    // question.ask: LLM-only — agents fire to surface a question to a director.

    reg
}

/// Return the `ToolSpec` for every runtime tool, keyed by tool name.
///
/// This is the authoritative source of runtime tool schemas, used by the event
/// editor to validate `tool_calls[].args` at save time. Built from a stub
/// registry (no idea/session/spawn deps) since we only need the specs —
/// execute() is never called.
pub fn runtime_tool_specs() -> HashMap<String, ToolSpec> {
    let reg = build_runtime_registry(None, None);
    reg.all_tools()
        .into_iter()
        .map(|t| (t.name().to_string(), t.spec()))
        .collect()
}

/// Caller ACL check helper used in tool execute() impls to surface clean errors
/// when a tool is called outside its allowed caller set. This is the secondary
/// enforcement (primary is ToolRegistry::invoke); tools can use this to guard
/// their own execute() if called directly.
///
/// In practice ToolRegistry::invoke is always called, not execute() directly,
/// so this is belt-and-suspenders for tests and future direct calls.
pub fn check_caller_allowed(
    tool_name: &str,
    allowed_callers: &[CallerKind],
    caller: CallerKind,
) -> Result<(), String> {
    if allowed_callers.contains(&caller) {
        Ok(())
    } else {
        Err(format!(
            "tool '{tool_name}' cannot be called by {:?}",
            caller
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fix #8: ideas.store must be registered as event_only. The LLM has the
    // MCP `ideas(action='store')` surface; the internal event-only tool is
    // for consolidation / reflection flows. If this assertion regresses,
    // events like `ideas:threshold_reached` will fail at fire time again.
    #[test]
    fn ideas_store_is_registered_event_only() {
        let reg = build_runtime_registry(None, None);
        assert!(
            reg.can_call("ideas.store", CallerKind::Event),
            "events must be able to call ideas.store"
        );
        assert!(
            !reg.can_call("ideas.store", CallerKind::Llm),
            "LLM must NOT be able to call ideas.store — use MCP ideas(action='store')"
        );
        assert!(
            reg.can_call("ideas.store", CallerKind::System),
            "system bypasses ACL"
        );
    }

    /// ideas.store_many must be event-only. The reflection / consolidation
    /// event chain depends on events firing this tool against the output of a
    /// preceding session.spawn. Giving the LLM direct access would be an
    /// arbitrary-write bypass (the LLM-facing surface is the dedup-pipelined
    /// `ideas(action='store')` MCP handler).
    #[test]
    fn ideas_store_many_is_registered_event_only() {
        let reg = build_runtime_registry(None, None);
        assert!(
            reg.can_call("ideas.store_many", CallerKind::Event),
            "events must be able to call ideas.store_many"
        );
        assert!(
            !reg.can_call("ideas.store_many", CallerKind::Llm),
            "LLM must NOT be able to call ideas.store_many"
        );
        assert!(
            reg.can_call("ideas.store_many", CallerKind::System),
            "system bypasses ACL"
        );
    }

    #[test]
    fn ideas_store_many_spec_exposed_to_event_editor() {
        let specs = runtime_tool_specs();
        let spec = specs
            .get("ideas.store_many")
            .expect("ideas.store_many must appear in runtime_tool_specs");
        assert_eq!(spec.name, "ideas.store_many");
        let required = spec
            .input_schema
            .get("required")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            required.iter().any(|v| v.as_str() == Some("from_json")),
            "ideas.store_many must require 'from_json'"
        );
    }

    #[test]
    fn ideas_store_spec_exposed_to_event_editor() {
        let specs = runtime_tool_specs();
        let spec = specs
            .get("ideas.store")
            .expect("ideas.store must appear in runtime_tool_specs for event editor validation");
        assert_eq!(spec.name, "ideas.store");
        // Required: `name`.
        let required = spec
            .input_schema
            .get("required")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            required.iter().any(|v| v.as_str() == Some("name")),
            "ideas.store must require 'name'"
        );
    }

    /// `question.ask` must appear in `runtime_tool_specs` so the event editor
    /// validates against its schema instead of rejecting it as "unknown tool".
    /// The stub is registered in `build_runtime_registry_full` precisely for
    /// this exposure — the wired tool with the real `AskFn` is added in
    /// `session_manager` at session-build time.
    #[test]
    fn question_ask_spec_exposed_to_event_editor() {
        let specs = runtime_tool_specs();
        let spec = specs
            .get("question.ask")
            .expect("question.ask must appear in runtime_tool_specs for event editor validation");
        assert_eq!(spec.name, "question.ask");
    }

    /// `question.ask` is LLM-only — agents fire it to surface a question to a
    /// director. Events must NOT be able to call it directly (the inbox
    /// surface is the only way operators can answer; events shouldn't be able
    /// to forge an awaiting state on a session).
    #[test]
    fn question_ask_is_registered_llm_only() {
        let reg = build_runtime_registry(None, None);
        assert!(
            reg.can_call("question.ask", CallerKind::Llm),
            "LLM must be able to call question.ask"
        );
        assert!(
            !reg.can_call("question.ask", CallerKind::Event),
            "events must NOT be able to call question.ask"
        );
        assert!(
            reg.can_call("question.ask", CallerKind::System),
            "system bypasses ACL"
        );
    }

    /// `message_to` must be registered LLM-only — events must not be able to
    /// manufacture agent-attributed outbound messages.
    #[test]
    fn message_to_is_registered_llm_only() {
        let reg = build_runtime_registry(None, None);
        assert!(
            reg.can_call("message_to", CallerKind::Llm),
            "LLM must be able to call message_to"
        );
        assert!(
            !reg.can_call("message_to", CallerKind::Event),
            "events must NOT be able to call message_to"
        );
        assert!(
            reg.can_call("message_to", CallerKind::System),
            "system bypasses ACL"
        );
    }

    /// `message_to` must appear in `runtime_tool_specs` so the event editor
    /// can validate tool_calls that reference it (e.g. for spec display),
    /// even though it is LLM-only.
    #[test]
    fn message_to_spec_exposed_to_event_editor() {
        let specs = runtime_tool_specs();
        let spec = specs
            .get("message_to")
            .expect("message_to must appear in runtime_tool_specs");
        assert_eq!(spec.name, "message_to");
        // Required fields: target + body.
        let required = spec
            .input_schema
            .get("required")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            required.iter().any(|v| v.as_str() == Some("target")),
            "message_to must require 'target'"
        );
        assert!(
            required.iter().any(|v| v.as_str() == Some("body")),
            "message_to must require 'body'"
        );
    }

    /// question.ask delegates to message_to(target=user, payload_kind=decision_request)
    /// when wired. The AskFn test below verifies the delegation path by wiring
    /// an AskFn that calls message_to internals via session_store directly —
    /// mimicking what session_manager does at spawn time.
    #[tokio::test]
    async fn question_ask_delegates_via_message_to_and_sets_awaiting() {
        use crate::agent_registry::ConnectionPool;
        use crate::session_store::SessionStore;
        use std::sync::Arc;
        use tokio::sync::Mutex;

        // Set up an in-memory session store.
        let pool = ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
        }
        let ss = Arc::new(SessionStore::new(Arc::new(pool)));

        // Wire an AskFn that mirrors what session_manager builds:
        // calls find_or_create_dm_session (agent→user) then set_awaiting on it.
        let agent_id = "test-agent-id".to_string();
        let user_id = "test-user-id".to_string();
        let ss_clone = ss.clone();
        let agent_id_clone = agent_id.clone();
        let user_id_clone = user_id.clone();

        let captured_session: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let captured_clone = captured_session.clone();

        let ask_fn: AskFn = Arc::new(move |req: AskRequest| {
            let ss = ss_clone.clone();
            let agent_id = agent_id_clone.clone();
            let user_id = user_id_clone.clone();
            let captured = captured_clone.clone();
            Box::pin(async move {
                let dm_name = format!("dm:agent:{}:user:{}", agent_id, user_id);
                let (sid, _) = ss
                    .find_or_create_dm_session(
                        "agent_user_dm",
                        &dm_name,
                        "agent",
                        &agent_id,
                        "user",
                        &user_id,
                    )
                    .await?;
                ss.append_message_from(
                    &sid,
                    "assistant",
                    &req.prompt,
                    "agent",
                    Some(&agent_id),
                    Some("decision_request"),
                )
                .await?;
                ss.set_awaiting(&sid, &req.subject).await?;
                *captured.lock().await = Some(sid);
                Ok(())
            })
        });

        let tool = QuestionAskTool::new(ask_fn, true);
        let result = tool
            .execute(serde_json::json!({
                "prompt": "should I deploy tonight?",
                "subject": "deploy approval"
            }))
            .await
            .unwrap();

        assert!(!result.is_error, "unexpected error: {}", result.output);

        // The DM session was created and has awaiting_at set.
        let dm_sid = captured_session
            .lock()
            .await
            .clone()
            .expect("ask_fn must have fired");
        let session = ss
            .get_session(&dm_sid)
            .await
            .unwrap()
            .expect("DM session must exist");
        assert_eq!(session.session_type, "agent_user_dm");

        // The inbox query must find the session (awaiting_at is set).
        let inbox = ss.list_awaiting(None).await.unwrap();
        assert!(
            inbox.iter().any(|row| row.session_id == dm_sid),
            "DM session must appear in the director inbox after question.ask"
        );

        // The message was appended with decision_request payload_kind.
        // Use timeline (not history) because history filters by event_type='message'
        // and payload_kind='decision_request' sets event_type='decision_request'.
        let msgs = ss.timeline_by_session(&dm_sid, 10).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "should I deploy tonight?");
    }
}
