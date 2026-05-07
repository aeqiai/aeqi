//! AEQI Architect — meta-agent that turns a free-text brief into a deployable
//! [`Blueprint`].
//!
//! # Generators
//!
//! Two generators ship side by side:
//!
//! - [`generate`](generator::generate) — deterministic stub. Hard-coded
//!   foundation-shaped blueprint with the brief interpolated into the
//!   identity idea, description, and kickoff quest. No network. Used as
//!   the IPC fallback when the LLM path errors so the user always gets
//!   a draft.
//! - [`generate_via_llm`](llm::generate_via_llm) — Phase 2. Calls an LLM
//!   through the [`LlmCaller`](llm::LlmCaller) trait (production: an
//!   `aeqi_inference::InferenceRouter` wired to a `DeepInfraProvider`).
//!   The model picks template / agents / roles / ideas from the brief
//!   itself.
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
pub mod llm;
pub mod types;

pub use generator::{ArchitectError, generate, refine};
pub use llm::{
    LlmCaller, LlmGenerationOptions, OpenRouterLlm, build_default_llm, generate_via_llm,
    refine_via_llm,
};
pub use types::{Brief, GeneratedBlueprint};
