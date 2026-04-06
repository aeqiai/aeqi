//! Provider fallback chain for resilient LLM routing.
//!
//! When a provider fails or is unavailable, the fallback chain progresses to
//! the next provider in an ordered list. This complements [`ReliableProvider`]
//! (which handles retries within a single provider) by providing cross-provider
//! failover: Anthropic -> OpenRouter -> Ollama.

use serde::{Deserialize, Serialize};

/// Configuration for a single provider in the fallback chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// Human-readable provider name (e.g., "anthropic", "openrouter", "ollama").
    pub name: String,
    /// Base URL for the provider's API.
    pub base_url: String,
    /// Environment variable name that holds the API key.
    pub api_key_env: String,
    /// Maximum number of retries before moving to the next provider.
    pub max_retries: u32,
}

impl ProviderConfig {
    /// Create a new provider config.
    pub fn new(
        name: impl Into<String>,
        base_url: impl Into<String>,
        api_key_env: impl Into<String>,
        max_retries: u32,
    ) -> Self {
        Self {
            name: name.into(),
            base_url: base_url.into(),
            api_key_env: api_key_env.into(),
            max_retries,
        }
    }
}

/// An ordered chain of provider configurations for fallback routing.
///
/// Tracks a cursor into the chain. Call [`advance`] to move to the next
/// provider when the current one is exhausted. Call [`reset`] to go back
/// to the first provider (e.g., on a new task).
#[derive(Debug, Clone)]
pub struct FallbackChain {
    providers: Vec<ProviderConfig>,
    current_index: usize,
}

impl FallbackChain {
    /// Create a new fallback chain from an ordered list of providers.
    ///
    /// The first provider in the list is the primary; subsequent providers
    /// are fallbacks in priority order.
    pub fn new(providers: Vec<ProviderConfig>) -> Self {
        Self {
            providers,
            current_index: 0,
        }
    }

    /// Create a chain with sensible defaults: Anthropic -> OpenRouter -> Ollama.
    pub fn with_defaults() -> Self {
        Self::new(vec![
            ProviderConfig::new(
                "anthropic",
                "https://api.anthropic.com",
                "ANTHROPIC_API_KEY",
                2,
            ),
            ProviderConfig::new(
                "openrouter",
                "https://openrouter.ai/api",
                "OPENROUTER_API_KEY",
                2,
            ),
            ProviderConfig::new("ollama", "http://localhost:11434", "OLLAMA_API_KEY", 1),
        ])
    }

    /// Return the current provider config.
    ///
    /// Returns `None` if the chain is empty.
    pub fn current(&self) -> Option<&ProviderConfig> {
        self.providers.get(self.current_index)
    }

    /// Advance to the next provider in the chain.
    ///
    /// Returns the next provider config, or `None` if all providers have
    /// been exhausted.
    pub fn advance(&mut self) -> Option<&ProviderConfig> {
        if self.current_index + 1 < self.providers.len() {
            self.current_index += 1;
            Some(&self.providers[self.current_index])
        } else {
            None
        }
    }

    /// Reset the chain back to the first provider.
    pub fn reset(&mut self) {
        self.current_index = 0;
    }

    /// Whether all providers in the chain have been exhausted.
    pub fn is_exhausted(&self) -> bool {
        self.providers.is_empty() || self.current_index >= self.providers.len()
    }

    /// Number of providers in the chain.
    pub fn len(&self) -> usize {
        self.providers.len()
    }

    /// Whether the chain has no providers.
    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_defaults_creates_three_providers() {
        let chain = FallbackChain::with_defaults();
        assert_eq!(chain.len(), 3);
        assert!(!chain.is_empty());

        let current = chain.current().unwrap();
        assert_eq!(current.name, "anthropic");
        assert_eq!(current.base_url, "https://api.anthropic.com");
        assert_eq!(current.api_key_env, "ANTHROPIC_API_KEY");
        assert_eq!(current.max_retries, 2);
    }

    #[test]
    fn chain_progression() {
        let mut chain = FallbackChain::with_defaults();

        // Start at anthropic.
        assert_eq!(chain.current().unwrap().name, "anthropic");

        // Move to openrouter.
        let next = chain.advance().unwrap();
        assert_eq!(next.name, "openrouter");
        assert_eq!(chain.current().unwrap().name, "openrouter");

        // Move to ollama.
        let next = chain.advance().unwrap();
        assert_eq!(next.name, "ollama");
        assert_eq!(chain.current().unwrap().name, "ollama");
    }

    #[test]
    fn exhaustion_returns_none() {
        let mut chain = FallbackChain::with_defaults();

        chain.advance(); // -> openrouter
        chain.advance(); // -> ollama
        let exhausted = chain.advance();
        assert!(exhausted.is_none());

        // current() still returns the last provider.
        assert_eq!(chain.current().unwrap().name, "ollama");
    }

    #[test]
    fn reset_goes_back_to_first() {
        let mut chain = FallbackChain::with_defaults();

        chain.advance(); // -> openrouter
        chain.advance(); // -> ollama
        assert_eq!(chain.current().unwrap().name, "ollama");

        chain.reset();
        assert_eq!(chain.current().unwrap().name, "anthropic");
    }

    #[test]
    fn empty_chain() {
        let mut chain = FallbackChain::new(vec![]);
        assert!(chain.is_empty());
        assert_eq!(chain.len(), 0);
        assert!(chain.current().is_none());
        assert!(chain.advance().is_none());
        assert!(chain.is_exhausted());
    }

    #[test]
    fn single_provider_chain() {
        let mut chain = FallbackChain::new(vec![ProviderConfig::new(
            "anthropic",
            "https://api.anthropic.com",
            "ANTHROPIC_API_KEY",
            3,
        )]);

        assert_eq!(chain.len(), 1);
        assert_eq!(chain.current().unwrap().name, "anthropic");
        assert!(chain.advance().is_none());
    }

    #[test]
    fn reset_after_exhaustion() {
        let mut chain = FallbackChain::with_defaults();

        // Exhaust the chain.
        chain.advance();
        chain.advance();
        assert!(chain.advance().is_none());

        // Reset and verify we can traverse again.
        chain.reset();
        assert_eq!(chain.current().unwrap().name, "anthropic");
        assert_eq!(chain.advance().unwrap().name, "openrouter");
        assert_eq!(chain.advance().unwrap().name, "ollama");
        assert!(chain.advance().is_none());
    }

    #[test]
    fn provider_config_fields() {
        let config = ProviderConfig::new("test", "http://localhost:8080", "TEST_KEY", 5);
        assert_eq!(config.name, "test");
        assert_eq!(config.base_url, "http://localhost:8080");
        assert_eq!(config.api_key_env, "TEST_KEY");
        assert_eq!(config.max_retries, 5);
    }

    #[test]
    fn default_chain_provider_details() {
        let chain = FallbackChain::with_defaults();

        let providers: Vec<&str> = (0..chain.len())
            .map(|i| chain.providers[i].name.as_str())
            .collect();
        assert_eq!(providers, vec!["anthropic", "openrouter", "ollama"]);

        // Ollama should have fewer retries (local, fast to fail).
        assert_eq!(chain.providers[2].max_retries, 1);
    }
}
