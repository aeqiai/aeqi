//! Placeholder provider resolution — T1.3 of the universality plan.
//!
//! Templates expanded by [`crate::idea_assembly::expand_template`] and
//! [`crate::idea_assembly::substitute_args_with_results`] support a fixed
//! set of built-in `{name}` placeholders (`{user_prompt}`, `{tool_output}`,
//! `{quest_description}`, `{session_id}`, `{agent_id}`, `{last_tool_result}`,
//! `{tool_calls.N.…}`). Adding a new placeholder used to require a Rust
//! match arm + recompile.
//!
//! This module turns that hardcoded seam into a data-driven lookup. A
//! seeded global meta-idea named `meta:placeholder-providers` carries a
//! TOML body that maps placeholder names to "source" descriptors:
//!
//! ```toml
//! [[placeholder]]
//! name = "now"
//! source = "builtin:utc_rfc3339"
//!
//! [[placeholder]]
//! name = "agent.name"
//! source = "context:agent_name"
//! ```
//!
//! Supported source kinds:
//! - `builtin:utc_rfc3339` — current UTC timestamp in RFC3339.
//! - `builtin:utc_date` — current UTC date as `YYYY-MM-DD`.
//! - `context:<key>` — value from the resolution context (currently
//!   `agent_id`, `agent_name`, `session_id`).
//! - `env:<VAR>` — process environment variable, empty if unset.
//! - `ideas.count:<query>` — count of ideas matching a comma-separated
//!   `key=value` query. Supports `tag=<tag>`; unknown keys are logged
//!   and ignored.
//!
//! Unknown source kinds → debug log + skip (the placeholder is not added
//! to the resolved map, so the existing literal pass-through behaviour
//! takes over downstream).
//!
//! Lookup priority: the resolved map is consulted FIRST by template
//! expansion. If a name is in the meta-idea AND collides with a built-in,
//! the meta-idea wins (operator override). If the meta-idea is absent or
//! empty, [`resolve_placeholder_providers`] returns an empty map and the
//! existing built-in resolution handles every placeholder unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use aeqi_core::traits::IdeaStore;
use chrono::Utc;
use serde::Deserialize;

use crate::agent_registry::AgentRegistry;

/// The seeded global idea name that carries the placeholder provider TOML.
pub const PROVIDERS_IDEA_NAME: &str = "meta:placeholder-providers";

/// Single `[[placeholder]]` table entry in the meta-idea TOML body.
#[derive(Debug, Deserialize)]
struct PlaceholderEntry {
    name: String,
    source: String,
}

/// Full TOML body shape — a list of placeholder entries.
#[derive(Debug, Default, Deserialize)]
struct PlaceholderProvidersBody {
    #[serde(default)]
    placeholder: Vec<PlaceholderEntry>,
}

/// Inputs threaded into context-source resolution. All fields are
/// optional so callers without an `ExecutionContext` (e.g. session:start
/// idea assembly) can still invoke the resolver.
#[derive(Debug, Default, Clone)]
pub struct ResolverContext {
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub session_id: Option<String>,
}

/// Resolve every entry in `meta:placeholder-providers` against the
/// running runtime, returning a `name → value` map suitable for direct
/// substitution into a template.
///
/// When the meta-idea is absent, the body is empty, or every entry has
/// an unknown source kind, the returned map is empty — callers fall
/// straight through to the existing built-in resolution.
pub async fn resolve_placeholder_providers(
    idea_store: Option<&Arc<dyn IdeaStore>>,
    registry: Option<&AgentRegistry>,
    rctx: &ResolverContext,
) -> HashMap<String, String> {
    let Some(store) = idea_store else {
        return HashMap::new();
    };
    let body_text = match store.get_by_name(PROVIDERS_IDEA_NAME, None).await {
        Ok(Some(idea)) => idea.content,
        Ok(None) => return HashMap::new(),
        Err(e) => {
            tracing::debug!(error = %e, "placeholder providers: lookup failed; treating as absent");
            return HashMap::new();
        }
    };

    let parsed: PlaceholderProvidersBody = match toml::from_str(&body_text) {
        Ok(body) => body,
        Err(e) => {
            tracing::warn!(
                idea = %PROVIDERS_IDEA_NAME,
                error = %e,
                "placeholder providers: TOML parse failed; using built-ins only"
            );
            return HashMap::new();
        }
    };

    // Lazily filled the first time a `context:agent_name` entry needs it.
    // We cache to avoid repeated registry lookups when many providers
    // reference the same agent.
    let mut agent_name_cache: Option<String> = rctx.agent_name.clone();

    let mut out: HashMap<String, String> = HashMap::with_capacity(parsed.placeholder.len());
    for entry in parsed.placeholder {
        let resolved =
            match resolve_source(&entry.source, store, registry, rctx, &mut agent_name_cache).await
            {
                Some(v) => v,
                None => {
                    tracing::debug!(
                        placeholder = %entry.name,
                        source = %entry.source,
                        "placeholder providers: unknown or unresolvable source; skipping"
                    );
                    continue;
                }
            };
        out.insert(entry.name, resolved);
    }
    out
}

/// Dispatch on the `source` string. Returns `None` for unknown kinds so
/// the caller can log + skip; returns `Some(empty_string)` for known
/// kinds that resolved to empty (e.g. unset env var) so the placeholder
/// still substitutes — just to nothing — exactly like the built-in path
/// for `Option::None` fields.
async fn resolve_source(
    source: &str,
    store: &Arc<dyn IdeaStore>,
    registry: Option<&AgentRegistry>,
    rctx: &ResolverContext,
    agent_name_cache: &mut Option<String>,
) -> Option<String> {
    if let Some(rest) = source.strip_prefix("builtin:") {
        return resolve_builtin(rest);
    }
    if let Some(key) = source.strip_prefix("context:") {
        return resolve_context(key, rctx, registry, agent_name_cache).await;
    }
    if let Some(var) = source.strip_prefix("env:") {
        return Some(std::env::var(var).unwrap_or_default());
    }
    if let Some(query) = source.strip_prefix("ideas.count:") {
        return Some(resolve_ideas_count(query, store).await.to_string());
    }
    None
}

/// Built-in time sources. Pure, no I/O.
fn resolve_builtin(name: &str) -> Option<String> {
    match name {
        "utc_rfc3339" => Some(Utc::now().to_rfc3339()),
        "utc_date" => Some(Utc::now().format("%Y-%m-%d").to_string()),
        _ => None,
    }
}

/// Read a value out of the resolver context. `agent_name` triggers a
/// registry lookup if the caller didn't pre-fill it; the result caches
/// in `agent_name_cache` so a TOML body with multiple `context:agent_name`
/// entries doesn't re-query.
async fn resolve_context(
    key: &str,
    rctx: &ResolverContext,
    registry: Option<&AgentRegistry>,
    agent_name_cache: &mut Option<String>,
) -> Option<String> {
    match key {
        "agent_id" => Some(rctx.agent_id.clone().unwrap_or_default()),
        "session_id" => Some(rctx.session_id.clone().unwrap_or_default()),
        "agent_name" => {
            if let Some(name) = agent_name_cache.as_ref() {
                return Some(name.clone());
            }
            // Try to materialize from the registry using agent_id.
            let resolved = match (registry, rctx.agent_id.as_deref()) {
                (Some(reg), Some(id)) => reg
                    .get(id)
                    .await
                    .ok()
                    .flatten()
                    .map(|a| a.name)
                    .unwrap_or_default(),
                _ => String::new(),
            };
            *agent_name_cache = Some(resolved.clone());
            Some(resolved)
        }
        _ => None,
    }
}

/// Parse the after-colon part of `ideas.count:tag=foo,since_hours=24` into
/// supported filters and run the count. Currently only `tag=<value>` is
/// honoured; other params are debug-logged and ignored. A missing tag means
/// "no filter we can express" → returns 0 (same as count of nothing).
async fn resolve_ideas_count(query: &str, store: &Arc<dyn IdeaStore>) -> i64 {
    let mut tag: Option<String> = None;
    for part in query.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some((k, v)) = part.split_once('=') else {
            tracing::debug!(param = %part, "placeholder ideas.count: ignoring malformed param");
            continue;
        };
        let (k, v) = (k.trim(), v.trim());
        match k {
            "tag" => tag = Some(v.to_string()),
            other => {
                tracing::debug!(param = %other, "placeholder ideas.count: unsupported param; ignoring");
            }
        }
    }
    let Some(tag) = tag else {
        return 0;
    };
    // `count_by_tag_since` is the trait surface; pass UNIX_EPOCH for "no
    // time bound" so we get a total count for the tag. The minimal version
    // intentionally ignores `since_hours=N` — the spec says debug-log
    // unsupported params, not extend the surface.
    let since = chrono::DateTime::<Utc>::from_timestamp(0, 0).unwrap_or_else(Utc::now);
    match store.count_by_tag_since(&tag, since).await {
        Ok(n) => n,
        Err(e) => {
            tracing::debug!(
                tag = %tag,
                error = %e,
                "placeholder ideas.count: count_by_tag_since failed; returning 0"
            );
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::Idea;
    use async_trait::async_trait;
    use std::sync::Mutex;

    /// Minimal `IdeaStore` stub: returns a single idea by exact name match
    /// when configured, otherwise `None`. `count_by_tag_since` returns a
    /// fixed value so we can assert the wiring without a real SQLite.
    struct StubStore {
        providers_idea: Option<Idea>,
        tag_count: Mutex<HashMap<String, i64>>,
    }

    impl StubStore {
        fn new(content: Option<&str>) -> Self {
            let providers_idea = content.map(|body| Idea {
                id: "stub-providers".to_string(),
                name: PROVIDERS_IDEA_NAME.to_string(),
                content: body.to_string(),
                tags: vec!["meta".into()],
                agent_id: None,
                created_at: chrono::Utc::now(),
                session_id: None,
                score: 0.0,
                scope: aeqi_core::Scope::Global,
                inheritance: "self".to_string(),
                tool_allow: Vec::new(),
                tool_deny: Vec::new(),
            });
            Self {
                providers_idea,
                tag_count: Mutex::new(HashMap::new()),
            }
        }

        fn with_tag_count(self, tag: &str, count: i64) -> Self {
            self.tag_count
                .lock()
                .unwrap()
                .insert(tag.to_string(), count);
            self
        }
    }

    #[async_trait]
    impl IdeaStore for StubStore {
        fn name(&self) -> &str {
            "stub"
        }

        async fn store(
            &self,
            _name: &str,
            _content: &str,
            _tags: &[String],
            _agent_id: Option<&str>,
        ) -> anyhow::Result<String> {
            unimplemented!()
        }

        async fn search(&self, _query: &aeqi_core::traits::IdeaQuery) -> anyhow::Result<Vec<Idea>> {
            Ok(Vec::new())
        }

        async fn hierarchical_search(
            &self,
            _text: &str,
            _ancestors: &[String],
            _top_k: usize,
        ) -> anyhow::Result<Vec<Idea>> {
            Ok(Vec::new())
        }

        async fn hierarchical_search_with_tags(
            &self,
            _text: &str,
            _ancestors: &[String],
            _top_k: usize,
            _tags: &[String],
        ) -> anyhow::Result<Vec<Idea>> {
            Ok(Vec::new())
        }

        async fn delete(&self, _id: &str) -> anyhow::Result<()> {
            Ok(())
        }

        async fn get_by_name(
            &self,
            name: &str,
            _agent_id: Option<&str>,
        ) -> anyhow::Result<Option<Idea>> {
            if name == PROVIDERS_IDEA_NAME {
                Ok(self.providers_idea.clone())
            } else {
                Ok(None)
            }
        }

        async fn count_by_tag_since(
            &self,
            tag: &str,
            _since: chrono::DateTime<Utc>,
        ) -> anyhow::Result<i64> {
            Ok(*self
                .tag_count
                .lock()
                .unwrap()
                .get(&tag.to_lowercase())
                .unwrap_or(&0))
        }
    }

    fn store_with(content: Option<&str>) -> Arc<dyn IdeaStore> {
        Arc::new(StubStore::new(content))
    }

    #[tokio::test]
    async fn returns_empty_when_meta_idea_absent() {
        let store = store_with(None);
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        assert!(
            map.is_empty(),
            "no meta-idea → empty resolution map → existing built-ins handle every placeholder"
        );
    }

    #[tokio::test]
    async fn resolves_builtin_utc_rfc3339() {
        let body = r#"
            [[placeholder]]
            name = "now"
            source = "builtin:utc_rfc3339"
        "#;
        let store = store_with(Some(body));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        let now = map.get("now").expect("now must be present");
        // RFC3339 strings always contain a 'T' separator and at least one '-' in the date.
        assert!(now.contains('T'), "RFC3339 has 'T': {now}");
        assert!(now.contains('-'), "RFC3339 has '-': {now}");
    }

    #[tokio::test]
    async fn resolves_builtin_utc_date_format() {
        let body = r#"
            [[placeholder]]
            name = "date.iso"
            source = "builtin:utc_date"
        "#;
        let store = store_with(Some(body));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        let date = map.get("date.iso").expect("date.iso must be present");
        // YYYY-MM-DD has length 10 with two '-'.
        assert_eq!(date.len(), 10, "YYYY-MM-DD: {date}");
        assert_eq!(date.chars().filter(|c| *c == '-').count(), 2);
    }

    #[tokio::test]
    async fn resolves_context_agent_id() {
        let body = r#"
            [[placeholder]]
            name = "agent.id"
            source = "context:agent_id"
        "#;
        let store = store_with(Some(body));
        let rctx = ResolverContext {
            agent_id: Some("agent-42".to_string()),
            ..ResolverContext::default()
        };
        let map = resolve_placeholder_providers(Some(&store), None, &rctx).await;
        assert_eq!(map.get("agent.id").map(String::as_str), Some("agent-42"));
    }

    #[tokio::test]
    async fn resolves_context_agent_name_from_prefilled() {
        // When the caller pre-fills ResolverContext.agent_name, the
        // registry never has to be consulted — important for hot paths.
        let body = r#"
            [[placeholder]]
            name = "agent.name"
            source = "context:agent_name"
        "#;
        let store = store_with(Some(body));
        let rctx = ResolverContext {
            agent_id: Some("agent-42".to_string()),
            agent_name: Some("Helper".to_string()),
            ..ResolverContext::default()
        };
        let map = resolve_placeholder_providers(Some(&store), None, &rctx).await;
        assert_eq!(map.get("agent.name").map(String::as_str), Some("Helper"));
    }

    #[tokio::test]
    async fn resolves_env_source() {
        // Use a unique name so we don't collide with any test-host env.
        let var = "AEQI_TEST_T13_PLACEHOLDER_VAR";
        // SAFETY: tests run with their own process; this var is unique to T1.3.
        unsafe {
            std::env::set_var(var, "from-env");
        }
        let body = format!(
            r#"
            [[placeholder]]
            name = "machine"
            source = "env:{var}"
        "#
        );
        let store = store_with(Some(&body));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        unsafe {
            std::env::remove_var(var);
        }
        assert_eq!(map.get("machine").map(String::as_str), Some("from-env"));
    }

    #[tokio::test]
    async fn resolves_ideas_count_with_tag() {
        let body = r#"
            [[placeholder]]
            name = "skill.count"
            source = "ideas.count:tag=skill"
        "#;
        let store: Arc<dyn IdeaStore> =
            Arc::new(StubStore::new(Some(body)).with_tag_count("skill", 7));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        assert_eq!(map.get("skill.count").map(String::as_str), Some("7"));
    }

    #[tokio::test]
    async fn resolves_ideas_count_ignores_unsupported_params() {
        // `since_hours` isn't supported in the minimal implementation — it
        // must be debug-logged and silently ignored, NOT crash.
        let body = r#"
            [[placeholder]]
            name = "skill.count"
            source = "ideas.count:tag=skill,since_hours=24"
        "#;
        let store: Arc<dyn IdeaStore> =
            Arc::new(StubStore::new(Some(body)).with_tag_count("skill", 3));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        assert_eq!(map.get("skill.count").map(String::as_str), Some("3"));
    }

    #[tokio::test]
    async fn unknown_source_kind_is_skipped_not_crashed() {
        let body = r#"
            [[placeholder]]
            name = "weather"
            source = "http:https://example.com/weather"
        "#;
        let store = store_with(Some(body));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        // Skipped → not present in the map. Downstream substitution then
        // leaves `{weather}` literal, exactly per the spec.
        assert!(
            !map.contains_key("weather"),
            "unknown source must be skipped, not propagated"
        );
    }

    #[tokio::test]
    async fn malformed_toml_body_falls_back_to_empty() {
        let body = r#"
            [[placeholder
            name = unclosed
        "#;
        let store = store_with(Some(body));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        assert!(
            map.is_empty(),
            "TOML parse failure → empty map → built-ins handle all"
        );
    }

    /// Hygiene: the shipped seed body in
    /// `presets/seed_ideas/meta-placeholder-providers.md` (everything
    /// after the `---` frontmatter) MUST parse as a `PlaceholderProvidersBody`
    /// or fresh installs silently lose every default placeholder. We parse
    /// the file directly here so a typo in the seed catches at build time.
    #[test]
    fn shipped_seed_body_parses_as_toml() {
        // CARGO_MANIFEST_DIR is `crates/aeqi-orchestrator`; up two levels
        // → workspace root.
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .expect("workspace root resolves from CARGO_MANIFEST_DIR");
        let seed = repo_root.join("presets/seed_ideas/meta-placeholder-providers.md");
        let raw = std::fs::read_to_string(&seed)
            .unwrap_or_else(|e| panic!("read {}: {e}", seed.display()));
        // Strip the `---`-delimited frontmatter; everything after the
        // closing `---` is the TOML body that gets stored as `content`.
        let body = raw
            .splitn(3, "---")
            .nth(2)
            .expect("seed file missing closing frontmatter delimiter");
        let parsed: PlaceholderProvidersBody = toml::from_str(body)
            .unwrap_or_else(|e| panic!("seed body must parse as TOML: {e}\nbody:\n{body}"));
        let names: Vec<&str> = parsed.placeholder.iter().map(|p| p.name.as_str()).collect();
        // Defaults documented in the universality plan and pinned here so
        // a rename in the seed file (or accidental delete) is a
        // compile-time-visible regression.
        for required in &["now", "date.iso", "agent.name", "agent.id"] {
            assert!(
                names.contains(required),
                "seed body missing default placeholder '{required}'; saw {names:?}"
            );
        }
    }

    #[tokio::test]
    async fn meta_idea_overrides_builtin_name() {
        // The substitution layer must honour meta-idea entries before its
        // built-in match. We test the resolver level here: producing an
        // override entry named after a built-in is allowed and surfaces in
        // the map. The substitution-layer override is covered by the
        // idea_assembly tests.
        let body = r#"
            [[placeholder]]
            name = "user_prompt"
            source = "builtin:utc_date"
        "#;
        let store = store_with(Some(body));
        let map =
            resolve_placeholder_providers(Some(&store), None, &ResolverContext::default()).await;
        let val = map.get("user_prompt").expect("override entry present");
        // YYYY-MM-DD shape — confirms it routed through utc_date, not the
        // user_prompt built-in.
        assert_eq!(val.len(), 10);
    }
}
