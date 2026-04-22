//! Provider-agnostic model catalog.
//!
//! The UI picker reads this list to render grouped model options. Slugs are
//! logical (`family/model-id`), not transport-specific — the orchestrator
//! decides whether a given slug routes through Anthropic direct, OpenRouter,
//! Ollama, or a future own-inference backend based on configured credentials.
//!
//! Prices track [`pricing.rs`] — the same prefix rules apply. Keep the two
//! tables aligned when adding entries.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// Zero-cost: OpenRouter ":free" tier or local Ollama.
    Free,
    /// Sub-$1/Mtok input — the everyday default.
    Cheap,
    /// $1–$5/Mtok input — stronger reasoning, worth it for real work.
    Balanced,
    /// $5+/Mtok input — frontier, used sparingly.
    Premium,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// One-line positioning blurb for the picker row.
    pub notes: &'static str,
}

static CATALOG: &[ModelEntry] = &[
    // ---------- FREE ----------
    ModelEntry {
        id: "deepseek/deepseek-chat:free",
        display_name: "DeepSeek Chat",
        family: "deepseek",
        tier: Tier::Free,
        context_window: 128_000,
        price_in: 0.0,
        price_out: 0.0,
        notes: "No key, no cost — everyday workhorse",
    },
    ModelEntry {
        id: "google/gemini-2.0-flash-exp:free",
        display_name: "Gemini 2.0 Flash",
        family: "google",
        tier: Tier::Free,
        context_window: 1_000_000,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Fast, multimodal, 1M context",
    },
    ModelEntry {
        id: "meta-llama/llama-3.3-70b-instruct:free",
        display_name: "Llama 3.3 70B",
        family: "meta-llama",
        tier: Tier::Free,
        context_window: 128_000,
        price_in: 0.0,
        price_out: 0.0,
        notes: "Open-weights, solid general model",
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
    },
    // ---------- CHEAP ----------
    ModelEntry {
        id: "deepseek/deepseek-chat",
        display_name: "DeepSeek Chat",
        family: "deepseek",
        tier: Tier::Cheap,
        context_window: 128_000,
        price_in: 0.14,
        price_out: 0.28,
        notes: "Reliable sub-$1 default for most agents",
    },
    ModelEntry {
        id: "google/gemini-2.5-flash",
        display_name: "Gemini 2.5 Flash",
        family: "google",
        tier: Tier::Cheap,
        context_window: 1_000_000,
        price_in: 0.15,
        price_out: 0.60,
        notes: "1M context for cheap, multimodal",
    },
    ModelEntry {
        id: "openai/gpt-4o-mini",
        display_name: "GPT-4o Mini",
        family: "openai",
        tier: Tier::Cheap,
        context_window: 128_000,
        price_in: 0.15,
        price_out: 0.60,
        notes: "OpenAI’s cheap tier",
    },
    ModelEntry {
        id: "anthropic/claude-haiku-4-5",
        display_name: "Claude Haiku 4.5",
        family: "anthropic",
        tier: Tier::Cheap,
        context_window: 200_000,
        price_in: 0.80,
        price_out: 4.0,
        notes: "Claude taste for under a dollar",
    },
    // ---------- BALANCED ----------
    ModelEntry {
        id: "anthropic/claude-sonnet-4-6",
        display_name: "Claude Sonnet 4.6",
        family: "anthropic",
        tier: Tier::Balanced,
        context_window: 200_000,
        price_in: 3.0,
        price_out: 15.0,
        notes: "Recommended default — strong agents use this",
    },
    ModelEntry {
        id: "google/gemini-2.5-pro",
        display_name: "Gemini 2.5 Pro",
        family: "google",
        tier: Tier::Balanced,
        context_window: 1_000_000,
        price_in: 1.25,
        price_out: 10.0,
        notes: "1M context, strong long-doc reasoning",
    },
    ModelEntry {
        id: "openai/gpt-4o",
        display_name: "GPT-4o",
        family: "openai",
        tier: Tier::Balanced,
        context_window: 128_000,
        price_in: 2.50,
        price_out: 10.0,
        notes: "OpenAI’s balanced flagship",
    },
    // ---------- PREMIUM ----------
    ModelEntry {
        id: "anthropic/claude-opus-4-7",
        display_name: "Claude Opus 4.7",
        family: "anthropic",
        tier: Tier::Premium,
        context_window: 200_000,
        price_in: 15.0,
        price_out: 75.0,
        notes: "Frontier reasoning — use sparingly",
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
        assert!(find("anthropic/claude-sonnet-4-6").is_some());
        assert!(find("bogus/nonexistent").is_none());
    }
}
