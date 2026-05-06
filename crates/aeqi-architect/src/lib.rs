//! AEQI Architect — meta-agent that turns a free-text brief into a deployable
//! [`Blueprint`].
//!
//! # Phase 1 scope
//!
//! Phase 1 is **scaffolding only**. The [`generate`](generator::generate) entry
//! point currently returns a hard-coded foundation-shaped blueprint with the
//! caller's brief interpolated into its identity ideas. Phase 2 will swap the
//! stub for an LLM-powered generator routed through `aeqi-inference`.
//!
//! The output schema is the canonical [`Blueprint`] type defined in
//! `aeqi-orchestrator::ipc::blueprints`. We do NOT redeclare it here — the
//! Architect produces JSON that the existing provisioner consumes unchanged.
//! The crate exposes its own thin [`GeneratedBlueprint`] envelope so
//! callers (the orchestrator IPC layer, future LLM tools) can ferry the
//! blueprint plus rationale + provenance metadata around without leaking
//! orchestrator types into the architect's surface.
//!
//! See `/home/claudedev/aeqi/.observations/architect-agent-2026-05-08.md` for
//! the design brief that this crate implements.

pub mod generator;
pub mod types;

pub use generator::{ArchitectError, generate, refine};
pub use types::{Brief, GeneratedBlueprint};
