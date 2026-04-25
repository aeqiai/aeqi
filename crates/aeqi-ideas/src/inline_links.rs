//! Body parser for inline entity links.
//!
//! Ideas reference other entities in prose with wikilink-style syntax:
//!
//! - `[[X]]` — **mention**: lightweight reference; surrounding prose carries
//!   the semantic meaning.
//! - `![[X]]` — **embed**: transclude the target's full content when
//!   rendering.
//!
//! Targets default to `kind = "idea"` and `id = X`. T1.8 added a
//! `<kind>:<id>` form recognised inside `[[...]]` and `![[...]]`:
//!
//! - `[[session:abc-123]]` — mention of a session.
//! - `![[session:abc-123]]` — embed of a session (transcludes the
//!   transcript on render).
//! - `[[quest:<id>]]`, `[[agent:<id>]]` — same pattern, future-proof.
//!
//! Unknown kinds (`[[unknown:foo]]`) fall back to a plain idea-mention with
//! the literal `unknown:foo` as the target name — preserves existing
//! behaviour and never crashes.
//!
//! The leading `!` takes precedence — `![[X]]` is an embed, not a mention
//! of `[X`. Whitespace inside the brackets is trimmed. Refs are
//! deduplicated case-insensitively per `(target_kind, relation)` group
//! (the first-seen casing wins).
//!
//! This parser is a pure function: no DB, no network. Edge reconciliation
//! that turns [`ParsedLinks`] into graph rows lives on the `IdeaStore`
//! trait.

use std::collections::HashSet;

/// Recognised entity kinds for the `<kind>:<id>` prefix inside `[[...]]`.
/// Anything not in this list falls back to `"idea"` with the raw token as
/// the target name (preserves existing behaviour).
const KNOWN_KINDS: &[&str] = &["idea", "session", "quest", "agent", "pack"];

/// One parsed reference, kind-aware.
///
/// `target_id` is the literal token after the `<kind>:` prefix when one
/// was present, or the full bracket contents when no prefix was given. For
/// `kind = "idea"` the consumer treats this as a name to resolve against
/// the idea store; for other kinds it is the entity's id directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypedRef {
    pub target_kind: String,
    pub target_id: String,
    /// One of `"mention"` or `"embed"`. The body parser never emits
    /// `"link"` — that relation is reserved for direct API / "+ Link"
    /// UI writes.
    pub relation: String,
}

/// Every reference parsed from a body, in first-seen order. Deduplicated
/// case-insensitively per `(target_kind, relation)` so the same `[[X]]`
/// twice in one body produces a single edge.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedLinks {
    pub refs: Vec<TypedRef>,
}

impl ParsedLinks {
    /// Total number of refs across all kinds and relations.
    pub fn len(&self) -> usize {
        self.refs.len()
    }

    /// True when no refs were parsed.
    pub fn is_empty(&self) -> bool {
        self.refs.is_empty()
    }

    /// Filter to refs matching a specific relation (`"mention"` or
    /// `"embed"`).
    pub fn by_relation<'a>(&'a self, relation: &'a str) -> impl Iterator<Item = &'a TypedRef> + 'a {
        self.refs.iter().filter(move |r| r.relation == relation)
    }

    /// Filter to refs with a specific target kind.
    pub fn by_kind<'a>(&'a self, kind: &'a str) -> impl Iterator<Item = &'a TypedRef> + 'a {
        self.refs.iter().filter(move |r| r.target_kind == kind)
    }

    /// All `kind="idea"` refs, regardless of relation. Convenience for
    /// callers that resolve idea names to ids.
    pub fn idea_refs(&self) -> impl Iterator<Item = &TypedRef> {
        self.by_kind("idea")
    }
}

/// Parse a body string and return every referenced entity.
///
/// The leading `!` on `![[X]]` takes precedence (it's an embed, never a
/// mention of `[X`). Whitespace inside brackets is trimmed; empty matches
/// are skipped. Refs are deduplicated case-insensitively per
/// `(target_kind, relation)` group; the same name across different
/// relations (e.g. `[[X]]` and later `![[X]]`) emits two refs.
pub fn parse_links(body: &str) -> ParsedLinks {
    let bytes = body.as_bytes();
    let mut out = ParsedLinks::default();
    let mut seen = SeenSet::default();

    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let is_embed = i > 0 && bytes[i - 1] == b'!';
            let start = i + 2;

            // Scan until `]]` or a disqualifying char (`]`, `\n`, `[`).
            let mut end: Option<usize> = None;
            let mut j = start;
            while j < bytes.len() {
                let b = bytes[j];
                if b == b'\n' || b == b'[' {
                    break;
                }
                if b == b']' {
                    if j + 1 < bytes.len() && bytes[j + 1] == b']' {
                        end = Some(j);
                    }
                    break;
                }
                j += 1;
            }

            match end {
                Some(e) => {
                    let raw = &body[start..e];
                    let trimmed = raw.trim();
                    if !trimmed.is_empty() {
                        record_match(trimmed, is_embed, &mut out, &mut seen);
                    }
                    i = e + 2;
                    continue;
                }
                None => {
                    // Unterminated `[[` — keep scanning past the opening
                    // bracket so we still pick up later well-formed links.
                    i = start;
                    continue;
                }
            }
        }
        i += 1;
    }

    out
}

#[derive(Default)]
struct SeenSet {
    /// Lowercased `(target_kind, relation, target_id)` triples.
    set: HashSet<(String, String, String)>,
}

impl SeenSet {
    fn insert(&mut self, kind: &str, relation: &str, id: &str) -> bool {
        self.set
            .insert((kind.to_string(), relation.to_string(), id.to_lowercase()))
    }
}

fn record_match(token: &str, is_embed: bool, out: &mut ParsedLinks, seen: &mut SeenSet) {
    let relation = if is_embed { "embed" } else { "mention" };
    let (kind, id) = split_kind_id(token);
    if seen.insert(kind, relation, id) {
        out.refs.push(TypedRef {
            target_kind: kind.to_string(),
            target_id: id.to_string(),
            relation: relation.to_string(),
        });
    }
}

/// Split a bracket token into `(kind, id)`. Recognises `<kind>:<id>` only
/// when `<kind>` is in [`KNOWN_KINDS`]; anything else (including unknown
/// kinds like `unknown:foo`) returns `("idea", token)` — the full token
/// becomes the idea name. Preserves existing behaviour for tokens that
/// happen to contain a colon for non-kind reasons (e.g. `[[meta:tag]]`).
fn split_kind_id(token: &str) -> (&str, &str) {
    if let Some((maybe_kind, rest)) = token.split_once(':') {
        let kind = maybe_kind.trim();
        let id = rest.trim();
        if KNOWN_KINDS.contains(&kind) && !id.is_empty() {
            return (kind_static(kind), id);
        }
    }
    ("idea", token)
}

/// Map a runtime kind string back to its static slot in [`KNOWN_KINDS`].
/// Lets us return `&'static str` for the kind so the caller can hold a
/// borrow with no allocation when writing into [`TypedRef`].
fn kind_static(kind: &str) -> &'static str {
    for k in KNOWN_KINDS {
        if *k == kind {
            return k;
        }
    }
    "idea"
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mention(kind: &str, id: &str) -> TypedRef {
        TypedRef {
            target_kind: kind.to_string(),
            target_id: id.to_string(),
            relation: "mention".to_string(),
        }
    }

    fn embed(kind: &str, id: &str) -> TypedRef {
        TypedRef {
            target_kind: kind.to_string(),
            target_id: id.to_string(),
            relation: "embed".to_string(),
        }
    }

    #[test]
    fn mentions_are_parsed() {
        let p = parse_links("see [[Auth System]] and [[Deploy]] for context");
        assert_eq!(
            p.refs,
            vec![mention("idea", "Auth System"), mention("idea", "Deploy")]
        );
    }

    #[test]
    fn embeds_are_parsed() {
        let p = parse_links("body: ![[Prelude]]\n\n![[Appendix]]");
        assert_eq!(
            p.refs,
            vec![embed("idea", "Prelude"), embed("idea", "Appendix")]
        );
    }

    #[test]
    fn bang_takes_precedence_over_mention() {
        let p = parse_links("![[X]]");
        assert_eq!(p.refs, vec![embed("idea", "X")]);
    }

    #[test]
    fn mixed_body_splits_by_relation() {
        let p = parse_links("intro [[A]] then ![[B]] and finally [[C]]");
        assert_eq!(
            p.refs,
            vec![
                mention("idea", "A"),
                embed("idea", "B"),
                mention("idea", "C"),
            ]
        );
    }

    #[test]
    fn whitespace_is_stripped() {
        let p = parse_links("see [[  spaced name  ]] and ![[  embedded  ]]");
        assert_eq!(
            p.refs,
            vec![mention("idea", "spaced name"), embed("idea", "embedded"),]
        );
    }

    #[test]
    fn case_insensitive_dedupe_per_relation() {
        let p = parse_links("[[Foo]] and [[foo]] and [[FOO]]");
        // First-seen casing wins.
        assert_eq!(p.refs, vec![mention("idea", "Foo")]);
    }

    #[test]
    fn same_name_can_be_mention_and_embed() {
        let p = parse_links("[[X]] and later ![[X]]");
        assert_eq!(p.refs, vec![mention("idea", "X"), embed("idea", "X")]);
    }

    #[test]
    fn unterminated_brackets_do_not_match() {
        let p = parse_links("this [[unfinished and [[real]] one");
        assert_eq!(p.refs, vec![mention("idea", "real")]);
    }

    #[test]
    fn newline_inside_brackets_breaks_match() {
        let p = parse_links("[[line one\nline two]]");
        assert!(p.refs.is_empty());
    }

    #[test]
    fn empty_brackets_are_ignored() {
        let p = parse_links("nothing here: [[]] and ![[]]");
        assert!(p.refs.is_empty());
    }

    #[test]
    fn whitespace_only_brackets_are_ignored() {
        let p = parse_links("[[   ]]");
        assert!(p.refs.is_empty());
    }

    #[test]
    fn empty_body_returns_empty() {
        let p = parse_links("");
        assert!(p.refs.is_empty());
    }

    #[test]
    fn no_links_in_plain_prose() {
        let p = parse_links("this has no wikilinks at all, [single brackets] only");
        assert!(p.refs.is_empty());
    }

    #[test]
    fn bang_without_brackets_is_not_an_embed() {
        let p = parse_links("exciting! [[Regular]] mention after");
        assert_eq!(p.refs, vec![mention("idea", "Regular")]);
    }

    // ── Cross-kind tests (T1.8) ────────────────────────────────────────

    #[test]
    fn session_mention_parses() {
        let p = parse_links("see [[session:abc-123]] for what we said");
        assert_eq!(p.refs, vec![mention("session", "abc-123")]);
    }

    #[test]
    fn session_embed_parses() {
        let p = parse_links("transclude: ![[session:abc-123]]");
        assert_eq!(p.refs, vec![embed("session", "abc-123")]);
    }

    #[test]
    fn quest_mention_parses() {
        let p = parse_links("blocked by [[quest:Q-42]]");
        assert_eq!(p.refs, vec![mention("quest", "Q-42")]);
    }

    #[test]
    fn agent_mention_parses() {
        let p = parse_links("dispatched to [[agent:hermes]]");
        assert_eq!(p.refs, vec![mention("agent", "hermes")]);
    }

    #[test]
    fn unknown_kind_falls_back_to_idea_with_full_token() {
        // Preserves existing behaviour: `unknown:foo` is treated as an
        // idea name, never crashes.
        let p = parse_links("[[unknown:foo]]");
        assert_eq!(p.refs, vec![mention("idea", "unknown:foo")]);
    }

    #[test]
    fn bare_brackets_default_to_idea_kind() {
        let p = parse_links("[[just-a-name]]");
        assert_eq!(p.refs, vec![mention("idea", "just-a-name")]);
    }

    #[test]
    fn cross_kind_dedupe_is_per_kind() {
        let p = parse_links("[[X]] [[idea:X]]");
        // `[[idea:X]]` resolves to the same `(idea, X, mention)` triple
        // as `[[X]]` — second is a duplicate.
        assert_eq!(p.refs, vec![mention("idea", "X")]);
    }

    #[test]
    fn cross_kind_session_then_idea_with_same_id() {
        let p = parse_links("[[session:abc]] and [[abc]]");
        // Different kinds — both kept.
        assert_eq!(
            p.refs,
            vec![mention("session", "abc"), mention("idea", "abc")]
        );
    }

    #[test]
    fn whitespace_around_kind_prefix_is_tolerated() {
        let p = parse_links("[[ session : abc-123 ]]");
        assert_eq!(p.refs, vec![mention("session", "abc-123")]);
    }

    #[test]
    fn empty_id_after_known_kind_falls_back_to_idea() {
        // `[[session:]]` — empty id should not match the kind path.
        let p = parse_links("[[session:]]");
        assert_eq!(p.refs, vec![mention("idea", "session:")]);
    }

    #[test]
    fn meta_colon_tag_is_idea_name_not_kind_prefix() {
        // `[[meta:tag]]` — `meta` is not a known kind; the whole token is
        // the idea name (this matches the legacy `[[meta:thing]]` shape
        // that some seeds use).
        let p = parse_links("[[meta:tag]]");
        assert_eq!(p.refs, vec![mention("idea", "meta:tag")]);
    }
}
