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

pub mod context_compress;
pub mod ideas_assemble;
pub mod ideas_search;
pub mod session_spawn;
pub mod session_status;
pub mod transcript_inject;

pub use context_compress::ContextCompressTool;
pub use ideas_assemble::IdeasAssembleTool;
pub use ideas_search::IdeasSearchTool;
pub use session_spawn::SessionSpawnTool;
pub use session_status::SessionStatusTool;
pub use transcript_inject::TranscriptInjectTool;

use std::sync::Arc;

use aeqi_core::tool_registry::{CallerKind, ToolRegistry};
use aeqi_core::traits::{IdeaStore, Tool};

use crate::session_store::SessionStore;

/// Build a ToolRegistry containing all runtime tools with their correct ACLs.
///
/// Tools marked `event_only` can only be fired by event tool_calls, not by the LLM.
/// Tools not restricted are callable by both LLM and events.
///
/// `idea_store`: must be provided for ideas.assemble and ideas.search to work.
/// `session_store`: must be provided for transcript.inject to work.
pub fn build_runtime_registry(
    idea_store: Option<Arc<dyn IdeaStore>>,
    session_store: Option<Arc<SessionStore>>,
) -> ToolRegistry {
    let tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(IdeasAssembleTool::new(idea_store.clone())),
        Arc::new(IdeasSearchTool::new(idea_store)),
        Arc::new(TranscriptInjectTool::new(session_store)),
        Arc::new(SessionStatusTool),
        Arc::new(SessionSpawnTool),
        Arc::new(ContextCompressTool),
    ];

    let mut reg = ToolRegistry::new(tools);

    // ideas.assemble: event-only — fetches by name and injects context.
    // Allowing the LLM to call this directly would let it inject arbitrary ideas.
    reg.set_event_only("ideas.assemble");

    // transcript.inject: event-only — adds messages directly to the transcript.
    // Allowing the LLM to call this would be a self-injection attack surface.
    reg.set_event_only("transcript.inject");

    // ideas.search: open — LLM and events can both run semantic searches.
    // session.status: open — anyone can emit a status message.
    // session.spawn: LLM can spawn sessions (for delegation); events can too.
    // context.compress: open — the LLM or events can request compaction.

    reg
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
