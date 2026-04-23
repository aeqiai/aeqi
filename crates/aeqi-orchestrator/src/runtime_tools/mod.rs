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
pub mod session_spawn;
pub mod session_status;
pub mod transcript_inject;
pub mod transcript_replace_middle;

pub use ideas_assemble::IdeasAssembleTool;
pub use ideas_search::IdeasSearchTool;
pub use session_spawn::{SessionSpawnTool, SpawnFn, SpawnRequest};
pub use session_status::SessionStatusTool;
pub use transcript_inject::TranscriptInjectTool;
pub use transcript_replace_middle::TranscriptReplaceMiddleTool;

use std::collections::HashMap;
use std::sync::Arc;

use aeqi_core::tool_registry::{CallerKind, ToolRegistry};
use aeqi_core::traits::{IdeaStore, Tool, ToolSpec};

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
    let spawn_tool: Arc<dyn Tool> = match spawn_fn {
        Some(f) => Arc::new(SessionSpawnTool::new(f, can_self_delegate)),
        None => Arc::new(SessionSpawnTool::stub()),
    };
    let tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(IdeasAssembleTool::new(idea_store.clone())),
        Arc::new(IdeasSearchTool::new(idea_store)),
        Arc::new(TranscriptInjectTool::new(session_store.clone())),
        Arc::new(TranscriptReplaceMiddleTool::new(session_store)),
        Arc::new(SessionStatusTool),
        spawn_tool,
    ];

    let mut reg = ToolRegistry::new(tools);

    // ideas.assemble: event-only — fetches by name and injects context.
    // Allowing the LLM to call this directly would let it inject arbitrary ideas.
    reg.set_event_only("ideas.assemble");

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
