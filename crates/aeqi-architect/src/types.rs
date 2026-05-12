//! Architect public types.
//!
//! These shapes are deliberately decoupled from `aeqi-orchestrator`'s
//! [`Blueprint`] type. The architect emits a JSON blueprint that the
//! orchestrator's existing deserializer consumes — but this crate stays
//! orchestrator-free so it can compile in isolation, be invoked from
//! tests without the full daemon harness, and (in Phase 2) be wired
//! into the LLM tool surface without picking up an orchestrator
//! dependency cycle.

use serde::{Deserialize, Serialize};

/// Free-text brief from the founder. Phase 1 ignores everything except
/// `text` — `target_kind` and `notes` are reserved for Phase 2 so the
/// schema is forward-compatible.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Brief {
    /// The founder's natural-language description of what they want to build.
    /// Soft limit: 2 000 chars. Hard cap: 8 000 chars (enforced by the
    /// orchestrator IPC layer, not here).
    pub text: String,

    /// Caller-supplied hint about the desired output shape. Phase 1
    /// always produces `kind = "single"`.
    #[serde(default)]
    pub target_kind: Option<TargetKind>,

    /// Free-form annotations the caller wants to ferry through (UI
    /// session id, draft id, etc.). Architect does not interpret these.
    #[serde(default)]
    pub notes: Option<serde_json::Value>,
}

/// Founder-supplied hint about the desired output shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetKind {
    /// One Blueprint → one Company.
    Single,
}

/// What the architect returns. The `blueprint` field is a JSON document
/// that must round-trip through `aeqi-orchestrator::ipc::blueprints::Blueprint`
/// — Phase 1 emits it as `serde_json::Value` so this crate doesn't take
/// the orchestrator dependency. The orchestrator IPC handler validates
/// it on the way through.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GeneratedBlueprint {
    /// Discriminator; Phase 1 always `"single"`.
    pub kind: String,

    /// One-paragraph explanation of the design choices. Surfaced in the
    /// Studio UI as the proposal's caption.
    pub rationale: String,

    /// JSON shape conforming to `aeqi-orchestrator::ipc::blueprints::Blueprint`.
    /// Validated downstream — this crate does not re-import the type.
    pub blueprint: serde_json::Value,

    /// Phase-1 provenance metadata so the UI can render "drafted by the
    /// stub generator" while we wait for Phase 2's LLM lane.
    pub generator: GeneratorProvenance,
}

/// Where this blueprint came from. Phase 1 is always
/// `GeneratorProvenance::stub_v1()`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GeneratorProvenance {
    /// Stable identifier for the generator implementation. Lets the UI
    /// distinguish stub output from LLM output without diff'ing the
    /// blueprint shape.
    pub kind: String,
    /// Schema version of this generator's output.
    pub version: String,
}

impl GeneratorProvenance {
    /// Provenance tag for the Phase-1 stub generator.
    pub fn stub_v1() -> Self {
        Self {
            kind: "stub".to_string(),
            version: "phase-1".to_string(),
        }
    }

    /// Provenance tag for the Phase-2 LLM-powered generator. The IPC
    /// layer reads this to surface "drafted by LLM" vs "drafted by stub
    /// fallback" in the Studio UI.
    pub fn llm_v1() -> Self {
        Self {
            kind: "llm".to_string(),
            version: "phase-2".to_string(),
        }
    }
}
