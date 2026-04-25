//! T1.4 — per-item validator hook for `ideas.store_many`.
//!
//! This module owns the [`IdeaValidator`] trait and the four built-in
//! validators that ship with the runtime. The dispatch site lives in
//! `ideas_store_many.rs`: after the T1.1 blast-radius admission gate but
//! before the SQLite write, every item is run through the validators
//! declared by its merged [`EffectivePolicy`] (T1.4 field on `TagPolicy`).
//!
//! ## Design contract
//!
//! - **Optional.** When no `meta:tag-policy` declares a `validators = [...]`
//!   list, no validator runs and behaviour is byte-identical to the
//!   pre-T1.4 path.
//! - **Per-item.** Validators inspect ONE item at a time and return
//!   `Result<(), String>`. They never mutate. They never abort the batch.
//! - **First-failure-wins.** The dispatcher records the first validator
//!   error per item and skips that item; remaining items in the batch
//!   continue through admission unchanged.
//! - **Unknown name = no-op.** If a policy names a validator the registry
//!   doesn't know, the dispatcher logs a warning and treats the item as if
//!   the unknown validator passed. Crashing on a typoed seed would be a
//!   denial-of-service surface; logging matches the rest of the runtime
//!   (unknown placeholders, unknown feedback signals).
//!
//! ## Why not a generic plugin trait
//!
//! T1.4 ships with exactly four neutral-dial validators. Anything richer
//! (regex, schema, content-classifier) is a content-layer extension and
//! belongs in a future `meta:validator-policy` proposal. Keeping the
//! built-in set small means we can afford a hand-written `match`.

use std::sync::Arc;

use aeqi_core::traits::IdeaStore;
use async_trait::async_trait;

/// One item being validated. The dispatcher hands the validator references
/// only — validators NEVER mutate the item. If a validator could rewrite
/// the item we'd be in auto-fix territory, which is a different feature
/// (and a different trust boundary).
#[derive(Debug)]
pub struct ValidatorItem<'a> {
    pub name: &'a str,
    pub content: &'a str,
    pub tags: &'a [String],
}

/// Read-only context every validator can consult. Currently exposes the
/// `IdeaStore` so validators like `tag_in_known_set` and
/// `references_resolve` can hit the existing tagged-idea index without the
/// dispatcher having to pre-fetch.
pub struct ValidatorCtx<'a> {
    pub store: &'a Arc<dyn IdeaStore>,
}

/// Per-item validator surface. Returns `Ok(())` to admit the item, or
/// `Err(reason)` to skip it. The dispatcher logs the reason and counts the
/// failure under `failed_validation` in the response.
///
/// Validators are async because two of the built-ins query the IdeaStore.
/// `name()` is the registry key authors reference from a tag policy's
/// `validators = [...]` list.
#[async_trait]
pub trait IdeaValidator: Send + Sync {
    fn name(&self) -> &'static str;

    async fn validate(
        &self,
        item: &ValidatorItem<'_>,
        ctx: &ValidatorCtx<'_>,
    ) -> Result<(), String>;
}

// ── Built-in validators ───────────────────────────────────────────────────

/// Reject items whose `name` is empty or whitespace-only. Layered on top
/// of the structural empty-name check already in `ideas_store_many` so
/// authors who declare it get a more honest "rejected by validator
/// `name_non_empty`" line in the response instead of the structural
/// "skipped: item missing 'name'" string.
pub struct NameNonEmpty;

#[async_trait]
impl IdeaValidator for NameNonEmpty {
    fn name(&self) -> &'static str {
        "name_non_empty"
    }

    async fn validate(
        &self,
        item: &ValidatorItem<'_>,
        _ctx: &ValidatorCtx<'_>,
    ) -> Result<(), String> {
        if item.name.trim().is_empty() {
            Err("name is empty or whitespace".to_string())
        } else {
            Ok(())
        }
    }
}

/// Reject items whose `content` is empty or whitespace-only. Useful for
/// reflection / consolidation pipelines where a model occasionally emits a
/// `{"name": "...", "content": ""}` placeholder.
pub struct ContentNonEmpty;

#[async_trait]
impl IdeaValidator for ContentNonEmpty {
    fn name(&self) -> &'static str {
        "content_non_empty"
    }

    async fn validate(
        &self,
        item: &ValidatorItem<'_>,
        _ctx: &ValidatorCtx<'_>,
    ) -> Result<(), String> {
        if item.content.trim().is_empty() {
            Err("content is empty or whitespace".to_string())
        } else {
            Ok(())
        }
    }
}

/// Reject items whose tags are not all listed in the `meta:pack-catalog`
/// idea. The catalog's body is treated as plain text — the validator
/// scans for "`<tag>`" tokens (backtick-fenced) anywhere in the body. This
/// matches the catalog's existing prose convention without introducing a
/// new structured format.
///
/// If the catalog idea is missing, the validator passes every item (a
/// missing catalog is an operator misconfiguration, not a per-item
/// problem). If a tag policy opts in to this validator without ever
/// seeding the catalog, the operator sees zero behaviour change — which
/// is the right failure mode for a substrate-level dial.
pub struct TagInKnownSet;

#[async_trait]
impl IdeaValidator for TagInKnownSet {
    fn name(&self) -> &'static str {
        "tag_in_known_set"
    }

    async fn validate(
        &self,
        item: &ValidatorItem<'_>,
        ctx: &ValidatorCtx<'_>,
    ) -> Result<(), String> {
        let catalog = match ctx.store.get_by_name("meta:pack-catalog", None).await {
            Ok(Some(idea)) => idea,
            Ok(None) => {
                // No catalog seeded — nothing to validate against.
                return Ok(());
            }
            Err(e) => {
                // Hitting the store failed; surface as a per-item failure
                // so the operator notices instead of silently passing
                // every item past a misbehaving validator.
                return Err(format!("tag_in_known_set: catalog lookup failed: {e}"));
            }
        };
        let known = parse_known_tags(&catalog.content);
        for tag in item.tags {
            let key = tag.to_lowercase();
            if !known.contains(&key) {
                return Err(format!("tag '{tag}' not listed in meta:pack-catalog"));
            }
        }
        Ok(())
    }
}

/// Reject items whose inline-mention references point at ideas that
/// don't exist.
///
/// T1.8 retired the `distilled_into:[[X]]` typed prefix; this validator
/// now walks every `kind="idea"` mention parsed out of the body. The
/// guard is most useful on consolidator output (items tagged
/// `consolidates`), where every mention is supposed to resolve to a
/// source idea — but it applies uniformly to any item that opts in via
/// a tag policy's `validators = ["references_resolve"]` setting.
///
/// References are looked up in two places:
///
/// 1. Inline-link parser output on `content` — every `[[Some Name]]`
///    mention with `kind="idea"`. Cross-kind refs (`[[session:...]]`,
///    `[[quest:...]]`) are skipped: they don't go through the idea
///    name resolver, so a missing session is a separate failure mode.
/// 2. Tag prefix `mention:<name>` on the item's `tags` list — for
///    callers that emit references through tags rather than body prose.
///    The legacy `distilled_into:<name>` prefix is still recognised so
///    pre-T1.8 consolidator outputs validate cleanly during the
///    transition.
///
/// Each referenced name is resolved via `IdeaStore::get_by_name(name,
/// None)` (global scope). This matches how the graph edge reconciler
/// resolves references today.
pub struct ReferencesResolve;

#[async_trait]
impl IdeaValidator for ReferencesResolve {
    fn name(&self) -> &'static str {
        "references_resolve"
    }

    async fn validate(
        &self,
        item: &ValidatorItem<'_>,
        ctx: &ValidatorCtx<'_>,
    ) -> Result<(), String> {
        let parsed = aeqi_ideas::inline_links::parse_links(item.content);
        let mut refs: Vec<String> = parsed
            .by_relation("mention")
            .filter(|r| r.target_kind == "idea")
            .map(|r| r.target_id.clone())
            .collect();
        for tag in item.tags {
            // `mention:<name>` is the canonical tag-based ref shape;
            // `distilled_into:<name>` is the pre-T1.8 form preserved
            // for one release while authors migrate.
            for prefix in ["mention:", "distilled_into:"] {
                if let Some(rest) = tag.strip_prefix(prefix)
                    && !rest.trim().is_empty()
                {
                    refs.push(rest.trim().to_string());
                }
            }
        }
        // Dedup case-insensitively, preserving first-seen casing.
        let mut seen = std::collections::HashSet::<String>::new();
        refs.retain(|name: &String| seen.insert(name.to_lowercase()));

        for name in &refs {
            match ctx.store.get_by_name(name, None).await {
                Ok(Some(_)) => continue,
                Ok(None) => {
                    return Err(format!("mention reference '{name}' does not resolve"));
                }
                Err(e) => {
                    return Err(format!(
                        "references_resolve: lookup failed for '{name}': {e}"
                    ));
                }
            }
        }
        Ok(())
    }
}

/// Built-in registry. The dispatcher consults this lookup with the names
/// declared on each tag policy. Returning a static slice keeps the call
/// site allocation-free; it's small enough that linear scan is
/// indistinguishable from a hash lookup at our batch sizes.
pub fn builtin_validators() -> Vec<Arc<dyn IdeaValidator>> {
    vec![
        Arc::new(NameNonEmpty),
        Arc::new(ContentNonEmpty),
        Arc::new(TagInKnownSet),
        Arc::new(ReferencesResolve),
    ]
}

/// Look up a validator by name in the built-in set. Returns `None` for
/// unknown names — the dispatcher converts that into a logged warning and
/// a no-op, never an error.
pub fn lookup_validator(name: &str) -> Option<Arc<dyn IdeaValidator>> {
    builtin_validators().into_iter().find(|v| v.name() == name)
}

/// Parse the meta:pack-catalog body for backtick-fenced tag names. Public
/// for unit testing.
fn parse_known_tags(body: &str) -> std::collections::HashSet<String> {
    // Walk the body byte-by-byte (the catalog is ASCII in practice; we
    // bail to char boundaries before slicing). Extract every single-line
    // single-backtick token. Triple-backtick code fences are skipped
    // wholesale because Markdown uses them for code blocks and we don't
    // want code samples leaking into the known-tag set.
    let mut out = std::collections::HashSet::new();
    let bytes = body.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        // Triple-backtick code fence: skip to the matching close (or EOF).
        if i + 2 < bytes.len() && bytes[i + 1] == b'`' && bytes[i + 2] == b'`' {
            let after = i + 3;
            match body[after..].find("```") {
                Some(rel) => {
                    i = after + rel + 3;
                    continue;
                }
                None => break,
            }
        }
        // Single-backtick span: scan to the next ` or newline. Only emit
        // the token if it terminates with a closing backtick (un-closed
        // spans are ignored — this is what GitHub Markdown does).
        let after = i + 1;
        let mut j = after;
        while j < bytes.len() && bytes[j] != b'`' && bytes[j] != b'\n' {
            j += 1;
        }
        if j < bytes.len() && bytes[j] == b'`' && j > after {
            let token = body[after..j].trim();
            if !token.is_empty() {
                out.insert(token.to_lowercase());
            }
            i = j + 1;
        } else {
            // No closing backtick on this line — advance past the open
            // and keep scanning.
            i = after;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_validator_resolves_each_builtin() {
        for name in [
            "name_non_empty",
            "content_non_empty",
            "tag_in_known_set",
            "references_resolve",
        ] {
            assert!(
                lookup_validator(name).is_some(),
                "missing built-in validator '{name}'"
            );
        }
    }

    #[test]
    fn lookup_validator_returns_none_for_unknown() {
        assert!(lookup_validator("nope_not_real").is_none());
    }

    #[test]
    fn parse_known_tags_picks_single_backtick_tokens() {
        let body = "available: `fact`, `decision`, and `preference`.";
        let set = parse_known_tags(body);
        assert!(set.contains("fact"));
        assert!(set.contains("decision"));
        assert!(set.contains("preference"));
        assert_eq!(set.len(), 3);
    }

    #[test]
    fn parse_known_tags_ignores_triple_backtick_fences() {
        let body = "Real `fact` tag.\n\n```\nignored `not-a-tag` here\n```\n\nAnother `decision`.";
        let set = parse_known_tags(body);
        assert!(set.contains("fact"));
        assert!(set.contains("decision"));
        assert!(!set.contains("not-a-tag"));
    }

    #[test]
    fn parse_known_tags_handles_empty_body() {
        let set = parse_known_tags("");
        assert!(set.is_empty());
    }
}
