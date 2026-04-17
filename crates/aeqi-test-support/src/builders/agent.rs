//! Minimal builder for shapes that tests construct by hand.
//!
//! Most production code uses `AgentRegistry::spawn` to create agents, which
//! gives a real UUID and persists to SQLite. Tests that want a spawned agent
//! should do the same via the registry. This builder is for the cases where
//! you need a plain `Agent` struct as input to a pure function.
//!
//! The actual `Agent` type lives in `aeqi-orchestrator` and carries fields
//! that `aeqi-core` doesn't know about, so this builder is intentionally
//! minimal. Richer builders can be added as the need arises, but beware of
//! making this crate depend on `aeqi-orchestrator` — that would create a
//! circular-ish dependency (orchestrator tests would pull in test-support
//! which would pull in orchestrator). Keep it to `aeqi-core` types only.

/// Placeholder — kept so the public re-export in `lib.rs` compiles and the
/// module is discoverable. Remove this stub if/when real builders land.
pub struct AgentBuilder;
