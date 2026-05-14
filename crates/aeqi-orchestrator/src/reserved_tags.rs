//! Reserved-tag registry.
//!
//! A small set of tag strings are load-bearing across the runtime —
//! renaming or misspelling any of them silently breaks persona
//! assembly, event-driven context, and dashboard surfaces. Until 2026-05-14
//! they were scattered as bare literals across `tools/mod.rs`,
//! `ipc/agents.rs`, `ipc/ideas.rs`, `ipc/blueprints.rs`, and
//! `event_handler.rs`. This module is the one place those strings live.
//!
//! When adding a new load-bearing tag, add a constant here, document what
//! it does, and update `docs/concepts/ideas.md` "Reserved tags" — the
//! check-mcp-docs guard in aeqi-docs treats the doc table as authoritative.

/// Marks an agent's persona / system-prompt content. Injected at
/// `session:start` by the runtime's tag-policy-driven assembly path.
pub const IDENTITY: &str = "identity";

/// Marks an idea as long-lived. Skipped by TTL sweeps. Identity ideas
/// always carry this alongside [`IDENTITY`].
pub const EVERGREEN: &str = "evergreen";

/// Written by event handlers that record "this happened" memory
/// (procedural learning). The runtime's session:start tag policy weights
/// these higher than ad-hoc notes.
pub const PROCEDURE: &str = "procedure";

/// Agent / team charter content. Used by the Executive Assistant pattern
/// for explicit "I serve the C-suite collectively, not any one of them."
/// statements.
pub const CHARTER: &str = "charter";

/// Marker for quest-idea backfills (legacy quests that had no `idea_id`
/// pre-Phase 3). Safe to filter out of search results — the content is
/// derived metadata, not user-authored memory.
pub const AEQI_BACKFILL: &str = "aeqi:backfill";

/// Per-persona deterministic handle: `personality:<agent_id>`. The
/// dashboard's Personality tab resolves an agent's persona idea by this
/// tag rather than by name prefix.
pub fn personality(agent_id: &str) -> String {
    format!("personality:{agent_id}")
}

/// Static tags appended to every persona idea (identity + evergreen).
/// The dynamic `personality:<agent_id>` tag is composed via
/// [`persona_idea_tags`].
pub const PERSONA_STATIC_TAGS: &[&str] = &[IDENTITY, EVERGREEN];

/// Build the full tag list for an agent's persona idea: the static tags
/// plus the per-agent `personality:<id>` handle. The personality tag is
/// the deterministic lookup key the UI's Personality tab reads from.
pub fn persona_idea_tags(agent_id: &str) -> Vec<String> {
    let mut tags: Vec<String> = PERSONA_STATIC_TAGS.iter().map(|s| s.to_string()).collect();
    tags.insert(0, personality(agent_id));
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn personality_handle_is_stable() {
        assert_eq!(personality("a-1"), "personality:a-1");
    }

    #[test]
    fn persona_tags_order_is_personality_then_static() {
        let tags = persona_idea_tags("agent-42");
        assert_eq!(tags[0], "personality:agent-42");
        assert_eq!(tags[1], IDENTITY);
        assert_eq!(tags[2], EVERGREEN);
        assert_eq!(tags.len(), 3);
    }

    #[test]
    fn reserved_constants_match_doc_table() {
        // Tripwire: if any of these change, docs/concepts/ideas.md's
        // "Reserved tags" table needs to change in lockstep.
        assert_eq!(IDENTITY, "identity");
        assert_eq!(EVERGREEN, "evergreen");
        assert_eq!(PROCEDURE, "procedure");
        assert_eq!(CHARTER, "charter");
        assert_eq!(AEQI_BACKFILL, "aeqi:backfill");
    }
}
