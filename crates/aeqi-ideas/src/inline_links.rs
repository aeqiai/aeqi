//! Body parser for inline idea links.
//!
//! Ideas reference each other in prose with wikilink-style syntax:
//!
//! - `[[X]]` — **mention**: render as a link to X; pull nothing inline.
//! - `![[X]]` — **embed**: transclude X's full content when rendering.
//!
//! The leading `!` takes precedence — `![[X]]` is an embed, not a mention of
//! `[X`. Whitespace inside the brackets is trimmed. Names are deduplicated
//! case-insensitively within each relation (the first-seen casing wins).
//!
//! This parser is a pure function: no DB, no network. Edge reconciliation
//! that turns [`ParsedLinks`] into graph rows lives on the `IdeaStore` trait.

use std::collections::HashSet;

/// The two kinds of references a body can contain.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedLinks {
    /// Names referenced with `[[X]]`.
    pub mentions: Vec<String>,
    /// Names referenced with `![[X]]`.
    pub embeds: Vec<String>,
}

/// Parse a body string and return every referenced name, split by relation.
///
/// Names are trimmed and empty matches skipped. Each output list is
/// deduplicated case-insensitively (the first casing seen is retained).
/// A reference cannot appear as both a mention and an embed for the same body
/// — `![[X]]` is always an embed, and the `[[X]]` that follows a `!` is not
/// counted again as a mention.
pub fn parse_links(body: &str) -> ParsedLinks {
    let bytes = body.as_bytes();
    let mut mentions: Vec<String> = Vec::new();
    let mut embeds: Vec<String> = Vec::new();
    let mut seen_mentions: HashSet<String> = HashSet::new();
    let mut seen_embeds: HashSet<String> = HashSet::new();

    let mut i = 0;
    while i + 1 < bytes.len() {
        // Detect `[[` with an optional leading `!` for embeds.
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let is_embed = i > 0 && bytes[i - 1] == b'!';
            let start = i + 2;
            // Scan until `]]` or a disqualifying char (`]`, `\n`, `[`).
            // Matches the regex `\[\[([^\]\n]+)\]\]` — content must not
            // contain `]` or newline. We also stop on an inner `[` so that
            // `[[unterminated [[real]]` picks up the real one, not the
            // runaway.
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
                        let key = name.to_lowercase();
                        if is_embed {
                            if seen_embeds.insert(key) {
                                embeds.push(name.to_string());
                            }
                        } else if seen_mentions.insert(key) {
                            mentions.push(name.to_string());
                        }
                    }
                    i = e + 2; // Skip past `]]`.
                    continue;
                }
                None => {
                    // Unterminated `[[` — continue scanning from the next
                    // byte after the opening bracket so we can still pick up
                    // a later well-formed link.
                    i = start;
                    continue;
                }
            }
        }
        i += 1;
    }

    ParsedLinks { mentions, embeds }
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
        // `![[X]]` must NOT create a mention of `X`.
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
        // First casing wins; duplicates (case-insensitive) dropped.
        assert_eq!(p.mentions, vec!["Foo"]);
    }

    #[test]
    fn same_name_can_be_mention_and_embed() {
        // The `!` prefix is what distinguishes the relations; a name can
        // appear in both buckets if the body uses both forms.
        let p = parse_links("[[X]] and later ![[X]]");
        assert_eq!(p.mentions, vec!["X"]);
        assert_eq!(p.embeds, vec!["X"]);
    }

    #[test]
    fn unterminated_brackets_do_not_match() {
        let p = parse_links("this [[unfinished and [[real]] one");
        // The first `[[unfinished` has no closing `]]` before the next `[[`
        // is scanned — parser must still find `[[real]]`.
        assert_eq!(p.mentions, vec!["real"]);
    }

    #[test]
    fn newline_inside_brackets_breaks_match() {
        // `\[\[([^\]\n]+)\]\]` — newlines inside the brackets disqualify the
        // match. This keeps runaway paragraphs from becoming giant names.
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
}
