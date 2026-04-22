//! Provider-agnostic model catalog.
//!
//! The UI picker reads this list to render a combobox of model options. Slugs
//! are logical (`family/model-id`), not transport-specific — the orchestrator
//! decides whether a given slug routes through Anthropic direct, OpenRouter,
//! Ollama, or a future own-inference backend based on configured credentials.
//!
//! Selection follows OpenRouter's current tool-use + programming leaderboard
//! (<https://openrouter.ai/rankings>) with deliberate coverage of Western and
//! Chinese frontier labs: Anthropic, OpenAI, Google, xAI, DeepSeek, MiniMax,
//! MoonshotAI (Kimi), Z.AI (GLM), Xiaomi (MiMo), Qwen, Meta.
//!
//! Prices track [`pricing.rs`] — the same prefix rules apply. When adding an
//! entry here, also register a price prefix there so cost-accounting stays
//! accurate.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// Zero-cost: OpenRouter ":free" tier or local Ollama.
    Free,
    /// Sub-$1/Mtok input — the everyday default tier.
    Cheap,
    /// $1–$5/Mtok input — stronger reasoning, worth it for real work.
    Balanced,
    /// $5+/Mtok input — frontier, used sparingly.
    Premium,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelEntry {
    /// Canonical slug — `{family}/{model-id}`. Stored on agents verbatim.
    pub id: &'static str,
    /// Human-readable name for the picker row.
    pub display_name: &'static str,
    /// Logical family (routing hint + grouping key).
    pub family: &'static str,
    pub tier: Tier,
    pub context_window: u32,
    /// USD per million input tokens.
    pub price_in: f64,
    /// USD per million output tokens.
    pub price_out: f64,
    /// One-line positioning blurb shown on the row.
    pub notes: &'static str,
    /// Highlighted in the picker (leads its tier group, starred).
    pub recommended: bool,
    /// Capability tags — rendered as small chips.
    /// Canonical values: "tools", "code", "long-context", "vision", "thinking".
    pub tags: &'static [&'static str],
}

static CATALOG: &[ModelEntry] = &[
    // ---------------------------------------------------------------- FREE
    ModelEntry {
        id: "z-ai/glm-4.5-air:free",
        display_name: "GLM 4.5 Air",
        family: "z-ai",
        tier: Tier::Free,
        context_window: 131_072,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Z.AI’s compact model, free via OpenRouter",
        recommended: true,
        tags: &["tools"],
    },
    ModelEntry {
        id: "minimax/minimax-m2.5:free",
        display_name: "MiniMax M2.5",
        family: "minimax",
        tier: Tier::Free,
        context_window: 196_608,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Top-5 ranked, free tier",
        recommended: false,
        tags: &["tools", "long-context"],
    },
    ModelEntry {
        id: "qwen/qwen3-coder:free",
        display_name: "Qwen3 Coder",
        family: "qwen",
        tier: Tier::Free,
        context_window: 262_000,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Programming-tuned, 262k context",
        recommended: false,
        tags: &["tools", "code"],
    },
    ModelEntry {
        id: "meta-llama/llama-3.3-70b-instruct:free",
        display_name: "Llama 3.3 70B",
        family: "meta-llama",
        tier: Tier::Free,
        context_window: 65_536,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Meta’s open-weights general model",
        recommended: false,
        tags: &["tools"],
    },
    ModelEntry {
        id: "ollama/llama3.2",
        display_name: "Llama 3.2 (local)",
        family: "ollama",
        tier: Tier::Free,
        context_window: 32_000,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Runs on your machine — offline, private",
        recommended: false,
        tags: &[],
    },
    // --------------------------------------------------------------- CHEAP
    ModelEntry {
        id: "deepseek/deepseek-v3.2",
        display_name: "DeepSeek V3.2",
        family: "deepseek",
        tier: Tier::Cheap,
        context_window: 131_072,
        price_in: 0.25,
        price_out: 0.38,
        notes: "Ranked #2 overall — aeqi default",
        recommended: true,
        tags: &["tools", "code"],
    },
    ModelEntry {
        id: "xiaomi/mimo-v2-flash",
        display_name: "MiMo V2 Flash",
        family: "xiaomi",
        tier: Tier::Cheap,
        context_window: 262_144,
        price_in: 0.09,
        price_out: 0.29,
        notes: "Xiaomi’s fast tier — cheapest strong tool-caller",
        recommended: false,
        tags: &["tools"],
    },
    ModelEntry {
        id: "minimax/minimax-m2.5",
        display_name: "MiniMax M2.5",
        family: "minimax",
        tier: Tier::Cheap,
        context_window: 196_608,
        price_in: 0.15,
        price_out: 1.20,
        notes: "Ranked #5 overall",
        recommended: false,
        tags: &["tools", "long-context"],
    },
    ModelEntry {
        id: "x-ai/grok-4-fast",
        display_name: "Grok 4 Fast",
        family: "x-ai",
        tier: Tier::Cheap,
        context_window: 2_000_000,
        price_in: 0.20,
        price_out: 0.50,
        notes: "2M context, sub-cent input — cheap long-context king",
        recommended: true,
        tags: &["tools", "long-context"],
    },
    ModelEntry {
        id: "qwen/qwen3-coder",
        display_name: "Qwen3 Coder",
        family: "qwen",
        tier: Tier::Cheap,
        context_window: 262_144,
        price_in: 0.22,
        price_out: 1.00,
        notes: "Programming-tuned, 480B MoE",
        recommended: false,
        tags: &["tools", "code"],
    },
    ModelEntry {
        id: "google/gemini-2.5-flash",
        display_name: "Gemini 2.5 Flash",
        family: "google",
        tier: Tier::Cheap,
        context_window: 1_048_576,
        price_in: 0.30,
        price_out: 2.50,
        notes: "1M context, multimodal",
        recommended: false,
        tags: &["tools", "long-context", "vision"],
    },
    ModelEntry {
        id: "openai/gpt-5-mini",
        display_name: "GPT-5 Mini",
        family: "openai",
        tier: Tier::Cheap,
        context_window: 400_000,
        price_in: 0.25,
        price_out: 2.00,
        notes: "OpenAI’s cheap GPT-5 tier",
        recommended: false,
        tags: &["tools"],
    },
    ModelEntry {
        id: "z-ai/glm-4.6",
        display_name: "GLM 4.6",
        family: "z-ai",
        tier: Tier::Cheap,
        context_window: 204_800,
        price_in: 0.39,
        price_out: 1.90,
        notes: "Z.AI’s strong coder, 200k context",
        recommended: false,
        tags: &["tools", "code"],
    },
    ModelEntry {
        id: "moonshotai/kimi-k2-0905",
        display_name: "Kimi K2",
        family: "moonshotai",
        tier: Tier::Cheap,
        context_window: 262_144,
        price_in: 0.40,
        price_out: 2.00,
        notes: "MoonshotAI’s agentic tool-caller",
        recommended: false,
        tags: &["tools", "code"],
    },
    ModelEntry {
        id: "google/gemini-3-flash-preview",
        display_name: "Gemini 3 Flash",
        family: "google",
        tier: Tier::Cheap,
        context_window: 1_048_576,
        price_in: 0.50,
        price_out: 3.00,
        notes: "Ranked #4 overall, 1M context",
        recommended: true,
        tags: &["tools", "long-context", "vision"],
    },
    // ------------------------------------------------------------ BALANCED
    ModelEntry {
        id: "anthropic/claude-sonnet-4.6",
        display_name: "Claude Sonnet 4.6",
        family: "anthropic",
        tier: Tier::Balanced,
        context_window: 1_000_000,
        price_in: 3.0,
        price_out: 15.0,
        notes: "Ranked #1 overall — flagship for real work",
        recommended: true,
        tags: &["tools", "code", "long-context", "vision"],
    },
    ModelEntry {
        id: "xiaomi/mimo-v2.5-pro",
        display_name: "MiMo V2.5 Pro",
        family: "xiaomi",
        tier: Tier::Balanced,
        context_window: 1_048_576,
        price_in: 1.0,
        price_out: 3.0,
        notes: "Xiaomi’s flagship, 1M context",
        recommended: false,
        tags: &["tools", "long-context"],
    },
    ModelEntry {
        id: "google/gemini-2.5-pro",
        display_name: "Gemini 2.5 Pro",
        family: "google",
        tier: Tier::Balanced,
        context_window: 1_048_576,
        price_in: 1.25,
        price_out: 10.0,
        notes: "1M context, strong long-doc reasoning",
        recommended: false,
        tags: &["tools", "long-context", "vision"],
    },
    ModelEntry {
        id: "openai/gpt-5",
        display_name: "GPT-5",
        family: "openai",
        tier: Tier::Balanced,
        context_window: 400_000,
        price_in: 1.25,
        price_out: 10.0,
        notes: "OpenAI’s flagship",
        recommended: false,
        tags: &["tools"],
    },
    ModelEntry {
        id: "openai/gpt-5-codex",
        display_name: "GPT-5 Codex",
        family: "openai",
        tier: Tier::Balanced,
        context_window: 400_000,
        price_in: 1.25,
        price_out: 10.0,
        notes: "GPT-5 tuned for programming",
        recommended: false,
        tags: &["tools", "code"],
    },
    ModelEntry {
        id: "x-ai/grok-4",
        display_name: "Grok 4",
        family: "x-ai",
        tier: Tier::Balanced,
        context_window: 256_000,
        price_in: 3.0,
        price_out: 15.0,
        notes: "xAI’s flagship reasoning model",
        recommended: false,
        tags: &["tools", "thinking"],
    },
    // ------------------------------------------------------------- PREMIUM
    ModelEntry {
        id: "anthropic/claude-opus-4.7",
        display_name: "Claude Opus 4.7",
        family: "anthropic",
        tier: Tier::Premium,
        context_window: 1_000_000,
        price_in: 5.0,
        price_out: 25.0,
        notes: "Anthropic’s deepest reasoning tier",
        recommended: true,
        tags: &["tools", "code", "long-context", "thinking"],
    },
    ModelEntry {
        id: "openai/gpt-5-pro",
        display_name: "GPT-5 Pro",
        family: "openai",
        tier: Tier::Premium,
        context_window: 400_000,
        price_in: 15.0,
        price_out: 120.0,
        notes: "Frontier — reserve for the hardest problems",
        recommended: false,
        tags: &["tools", "thinking"],
    },
];

/// Return the full catalog.
pub fn all() -> &'static [ModelEntry] {
    CATALOG
}

/// Find an entry by exact slug match. Returns `None` for custom/unknown slugs.
pub fn find(id: &str) -> Option<&'static ModelEntry> {
    CATALOG.iter().find(|e| e.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_entries_in_every_tier() {
        let tiers = [Tier::Free, Tier::Cheap, Tier::Balanced, Tier::Premium];
        for t in tiers {
            assert!(
                all().iter().any(|e| e.tier == t),
                "missing entries for tier {t:?}"
            );
        }
    }

    #[test]
    fn all_ids_are_unique() {
        let mut ids: Vec<&str> = all().iter().map(|e| e.id).collect();
        ids.sort_unstable();
        let original_len = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), original_len, "duplicate slug in catalog");
    }

    #[test]
    fn slugs_follow_family_prefix() {
        for entry in all() {
            let expected_prefix = format!("{}/", entry.family);
            assert!(
                entry.id.starts_with(&expected_prefix),
                "slug {} does not start with family prefix {}",
                entry.id,
                expected_prefix,
            );
        }
    }

    #[test]
    fn free_tier_is_free() {
        for entry in all().iter().filter(|e| e.tier == Tier::Free) {
            assert_eq!(
                entry.price_in, 0.0,
                "free model {} has nonzero input price",
                entry.id
            );
            assert_eq!(
                entry.price_out, 0.0,
                "free model {} has nonzero output price",
                entry.id
            );
        }
    }

    #[test]
    fn find_returns_known_slug() {
        assert!(find("anthropic/claude-sonnet-4.6").is_some());
        assert!(find("deepseek/deepseek-v3.2").is_some());
        assert!(find("bogus/nonexistent").is_none());
    }

    #[test]
    fn at_least_one_recommended_per_major_tier() {
        for tier in [Tier::Free, Tier::Cheap, Tier::Balanced, Tier::Premium] {
            assert!(
                all()
                    .iter()
                    .any(|e| e.tier == tier && e.recommended),
                "tier {tier:?} has no recommended model — picker loses its hero",
            );
        }
    }
}
