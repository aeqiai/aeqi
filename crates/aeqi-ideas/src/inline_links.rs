//! Body parser for inline idea links.
//!
//! Ideas reference each other in prose with wikilink-style syntax:
//!
//! - `[[X]]` — **mention**: render as a link to X; pull nothing inline.
//! - `![[X]]` — **embed**: transclude X's full content when rendering.
//! - `supersedes:[[X]]`, `contradicts:[[X]]`, `supports:[[X]]`,
//!   `distilled_into:[[X]]` — **typed** mentions that emit the matching
//!   graph relation instead of a plain mention edge.
//!
//! The leading `!` takes precedence — `![[X]]` is an embed, not a mention of
//! `[X`. A typed prefix (word immediately followed by `:[[`) takes precedence
//! over a plain mention: `supersedes:[[X]]` does NOT also create a mention
//! of `X`. Whitespace inside the brackets is trimmed. Names are deduplicated
//! case-insensitively within each relation (the first-seen casing wins).
//!
//! This parser is a pure function: no DB, no network. Edge reconciliation
//! that turns [`ParsedLinks`] into graph rows lives on the `IdeaStore` trait.

use std::collections::HashSet;

/// Every relation a body can reference. Each `Vec<String>` holds target
/// names in first-seen order, deduplicated case-insensitively.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedLinks {
    /// Names referenced with `[[X]]`.
    pub mentions: Vec<String>,
    /// Names referenced with `![[X]]`.
    pub embeds: Vec<String>,
    /// Names referenced with `supersedes:[[X]]`.
    pub supersedes: Vec<String>,
    /// Names referenced with `contradicts:[[X]]`.
    pub contradicts: Vec<String>,
    /// Names referenced with `supports:[[X]]`.
    pub supports: Vec<String>,
    /// Names referenced with `distilled_into:[[X]]`.
    pub distilled_into: Vec<String>,
}

impl ParsedLinks {
    /// Flatten into `(relation, name)` pairs, preserving the first-seen
    /// order within each relation group. Callers resolve names → ids
    /// and persist via `IdeaStore::store_idea_edge`.
    ///
    /// `adjacent` is intentionally *not* part of this surface — it is
    /// emitted only by the IPC `links` field (explicit "+ Link" UI flow),
    /// never from body parsing.
    pub fn as_relation_pairs(&self) -> Vec<(&str, &str)> {
        let mut out: Vec<(&str, &str)> = Vec::with_capacity(self.total_len());
        for name in &self.mentions {
            out.push(("mentions", name.as_str()));
        }
        for name in &self.embeds {
            out.push(("embeds", name.as_str()));
        }
        for name in &self.supersedes {
            out.push(("supersedes", name.as_str()));
        }
        for name in &self.contradicts {
            out.push(("contradicts", name.as_str()));
        }
        for name in &self.supports {
            out.push(("supports", name.as_str()));
        }
        for name in &self.distilled_into {
            out.push(("distilled_into", name.as_str()));
        }
        out
    }

    fn total_len(&self) -> usize {
        self.mentions.len()
            + self.embeds.len()
            + self.supersedes.len()
            + self.contradicts.len()
            + self.supports.len()
            + self.distilled_into.len()
    }
}

/// The typed relation prefixes recognised before a `:[[...]]` block.
/// Order doesn't matter; lookup is by exact match.
const TYPED_PREFIXES: &[(&str, TypedRelation)] = &[
    ("supersedes", TypedRelation::Supersedes),
    ("contradicts", TypedRelation::Contradicts),
    ("supports", TypedRelation::Supports),
    ("distilled_into", TypedRelation::DistilledInto),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TypedRelation {
    Supersedes,
    Contradicts,
    Supports,
    DistilledInto,
}

/// Parse a body string and return every referenced name, split by relation.
///
/// Names are trimmed and empty matches skipped. Each output list is
/// deduplicated case-insensitively (the first casing seen is retained).
/// A reference cannot appear in multiple relation buckets from one match:
/// typed prefix > embed > mention. The same name may appear in multiple
/// buckets across different occurrences in the body (e.g. `[[X]]` and
/// later `![[X]]` put `X` in both `mentions` and `embeds`).
pub fn parse_links(body: &str) -> ParsedLinks {
    let bytes = body.as_bytes();
    let mut out = ParsedLinks::default();
    let mut seen = SeenSets::default();

    let mut i = 0;
    while i + 1 < bytes.len() {
        // Detect `[[` with an optional leading `!` for embeds, or a
        // typed `word:[[` prefix.
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let (typed, typed_prefix_start) = detect_typed_prefix(bytes, i);
            let is_embed = typed.is_none() && i > 0 && bytes[i - 1] == b'!';
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
                    let name = raw.trim();
                    if !name.is_empty() {
                        record_match(typed, is_embed, name, &mut out, &mut seen);
                    }
                    // Skip past the typed prefix too so we don't re-match
                    // the `[[...]]` as a plain mention.
                    let _ = typed_prefix_start;
                    i = e + 2;
                    continue;
                }
                None => {
                    // Unterminated `[[` — continue scanning from the next
                    // byte after the opening bracket so we can still pick
                    // up a later well-formed link.
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
struct SeenSets {
    mentions: HashSet<String>,
    embeds: HashSet<String>,
    supersedes: HashSet<String>,
    contradicts: HashSet<String>,
    supports: HashSet<String>,
    distilled_into: HashSet<String>,
}

fn record_match(
    typed: Option<TypedRelation>,
    is_embed: bool,
    name: &str,
    out: &mut ParsedLinks,
    seen: &mut SeenSets,
) {
    let key = name.to_lowercase();
    match typed {
        Some(TypedRelation::Supersedes) => {
            if seen.supersedes.insert(key) {
                out.supersedes.push(name.to_string());
            }
        }
        Some(TypedRelation::Contradicts) => {
            if seen.contradicts.insert(key) {
                out.contradicts.push(name.to_string());
            }
        }
        Some(TypedRelation::Supports) => {
            if seen.supports.insert(key) {
                out.supports.push(name.to_string());
            }
        }
        Some(TypedRelation::DistilledInto) => {
            if seen.distilled_into.insert(key) {
                out.distilled_into.push(name.to_string());
            }
        }
        None if is_embed => {
            if seen.embeds.insert(key) {
                out.embeds.push(name.to_string());
            }
        }
        None => {
            if seen.mentions.insert(key) {
                out.mentions.push(name.to_string());
            }
        }
    }
}

/// Look backward from `bracket_pos` (the first `[` of `[[`) for a typed
/// prefix of the form `word:` where `word` is one of [`TYPED_PREFIXES`]
/// and the char between `word` and `:` is immediately adjacent (no
/// whitespace). Returns the matched relation and the byte index at
/// which the prefix word begins, or `None` if no typed prefix matches.
fn detect_typed_prefix(bytes: &[u8], bracket_pos: usize) -> (Option<TypedRelation>, usize) {
    if bracket_pos < 2 || bytes[bracket_pos - 1] != b':' {
        return (None, bracket_pos);
    }
    // Walk backward from the `:` collecting identifier chars
    // (`a-z`, `_`) — stop on any non-identifier byte or on the start
    // of the slice.
    let word_end = bracket_pos - 1; // points at `:`
    let mut word_start = word_end;
    while word_start > 0 {
        let c = bytes[word_start - 1];
        if c.is_ascii_lowercase() || c == b'_' {
            word_start -= 1;
        } else {
            break;
        }
    }
    if word_start == word_end {
        return (None, bracket_pos);
    }
    // Guard against accidental matches in the middle of a longer word
    // like `notsupersedes:[[X]]` — the byte immediately before
    // `word_start` must not itself be an identifier char.
    if word_start > 0 {
        let prev = bytes[word_start - 1];
        if prev.is_ascii_alphanumeric() || prev == b'_' {
            return (None, bracket_pos);
        }
    }
    let word = std::str::from_utf8(&bytes[word_start..word_end]).unwrap_or("");
    for (needle, rel) in TYPED_PREFIXES {
        if word == *needle {
            return (Some(*rel), word_start);
        }
    }
    (None, bracket_pos)
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_are_parsed() {
        let p = parse_links("see [[Auth System]] and [[Deploy]] for context");
        assert_eq!(p.mentions, vec!["Auth System", "Deploy"]);
        assert!(p.embeds.is_empty());
    }

    #[test]
    fn embeds_are_parsed() {
        let p = parse_links("body: ![[Prelude]]\n\n![[Appendix]]");
        assert_eq!(p.embeds, vec!["Prelude", "Appendix"]);
        assert!(p.mentions.is_empty());
    }

    #[test]
    fn bang_takes_precedence_over_mention() {
        let p = parse_links("![[X]]");
        assert!(p.mentions.is_empty());
        assert_eq!(p.embeds, vec!["X"]);
    }

    #[test]
    fn mixed_body_splits_by_relation() {
        let p = parse_links("intro [[A]] then ![[B]] and finally [[C]]");
        assert_eq!(p.mentions, vec!["A", "C"]);
        assert_eq!(p.embeds, vec!["B"]);
    }

    #[test]
    fn whitespace_is_stripped() {
        let p = parse_links("see [[  spaced name  ]] and ![[  embedded  ]]");
        assert_eq!(p.mentions, vec!["spaced name"]);
        assert_eq!(p.embeds, vec!["embedded"]);
    }

    #[test]
    fn case_insensitive_dedupe_per_relation() {
        let p = parse_links("[[Foo]] and [[foo]] and [[FOO]]");
        assert_eq!(p.mentions, vec!["Foo"]);
    }

    #[test]
    fn same_name_can_be_mention_and_embed() {
        let p = parse_links("[[X]] and later ![[X]]");
        assert_eq!(p.mentions, vec!["X"]);
        assert_eq!(p.embeds, vec!["X"]);
    }

    #[test]
    fn unterminated_brackets_do_not_match() {
        let p = parse_links("this [[unfinished and [[real]] one");
        assert_eq!(p.mentions, vec!["real"]);
    }

    #[test]
    fn newline_inside_brackets_breaks_match() {
        let p = parse_links("[[line one\nline two]]");
        assert!(p.mentions.is_empty());
    }

    #[test]
    fn empty_brackets_are_ignored() {
        let p = parse_links("nothing here: [[]] and ![[]]");
        assert!(p.mentions.is_empty());
        assert!(p.embeds.is_empty());
    }

    #[test]
    fn whitespace_only_brackets_are_ignored() {
        let p = parse_links("[[   ]]");
        assert!(p.mentions.is_empty());
    }

    #[test]
    fn empty_body_returns_empty() {
        let p = parse_links("");
        assert!(p.mentions.is_empty());
        assert!(p.embeds.is_empty());
    }

    #[test]
    fn no_links_in_plain_prose() {
        let p = parse_links("this has no wikilinks at all, [single brackets] only");
        assert!(p.mentions.is_empty());
        assert!(p.embeds.is_empty());
    }

    #[test]
    fn bang_without_brackets_is_not_an_embed() {
        let p = parse_links("exciting! [[Regular]] mention after");
        assert_eq!(p.mentions, vec!["Regular"]);
        assert!(p.embeds.is_empty());
    }

    // ── Typed prefix tests ─────────────────────────────────────────────

    #[test]
    fn supersedes_is_parsed() {
        let p = parse_links("We moved on supersedes:[[Old Plan]] now.");
        assert_eq!(p.supersedes, vec!["Old Plan"]);
        assert!(p.mentions.is_empty());
    }

    #[test]
    fn contradicts_is_parsed() {
        let p = parse_links("But contradicts:[[Stale Fact]] — see new data.");
        assert_eq!(p.contradicts, vec!["Stale Fact"]);
        assert!(p.mentions.is_empty());
    }

    #[test]
    fn supports_is_parsed() {
        let p = parse_links("Evidence: supports:[[Main Claim]].");
        assert_eq!(p.supports, vec!["Main Claim"]);
    }

    #[test]
    fn distilled_into_is_parsed() {
        let p = parse_links("Old notes distilled_into:[[Summary Idea]].");
        assert_eq!(p.distilled_into, vec!["Summary Idea"]);
    }

    #[test]
    fn typed_prefixes_mix_with_plain_mentions() {
        let p = parse_links(
            "plain [[A]], supersedes:[[B]], then ![[C]] and supports:[[D]] and [[A]] again",
        );
        assert_eq!(p.mentions, vec!["A"]);
        assert_eq!(p.embeds, vec!["C"]);
        assert_eq!(p.supersedes, vec!["B"]);
        assert_eq!(p.supports, vec!["D"]);
    }

    #[test]
    fn typed_prefix_suppresses_plain_mention() {
        // `supersedes:[[X]]` must NOT also appear in `mentions`.
        let p = parse_links("supersedes:[[X]]");
        assert!(p.mentions.is_empty());
        assert_eq!(p.supersedes, vec!["X"]);
    }

    #[test]
    fn typed_prefix_case_insensitive_dedupe() {
        let p = parse_links("supersedes:[[Foo]] supersedes:[[foo]] supersedes:[[FOO]]");
        assert_eq!(p.supersedes, vec!["Foo"]);
    }

    #[test]
    fn unknown_typed_prefix_falls_back_to_mention() {
        // `causes` is not (yet) a recognised typed prefix — must fall
        // back to a plain mention, not silently drop.
        let p = parse_links("causes:[[Event]]");
        assert_eq!(p.mentions, vec!["Event"]);
        assert!(p.supersedes.is_empty());
    }

    #[test]
    fn prefix_embedded_in_larger_word_does_not_match() {
        // `notsupersedes:[[X]]` must NOT be parsed as a typed prefix.
        let p = parse_links("notsupersedes:[[X]]");
        assert_eq!(p.mentions, vec!["X"]);
        assert!(p.supersedes.is_empty());
    }

    #[test]
    fn as_relation_pairs_round_trips() {
        let p = parse_links(
            "[[A]] ![[B]] supersedes:[[C]] contradicts:[[D]] supports:[[E]] distilled_into:[[F]]",
        );
        let pairs = p.as_relation_pairs();
        assert_eq!(
            pairs,
            vec![
                ("mentions", "A"),
                ("embeds", "B"),
                ("supersedes", "C"),
                ("contradicts", "D"),
                ("supports", "E"),
                ("distilled_into", "F"),
            ]
        );
    }
}
