//! `@<token>` mention parser.
//!
//! Parses at-mention tokens from body text into a `Vec<MentionRef>`.
//! This is a sibling to the `[[wikilink]]` parser in
//! `aeqi-ideas::inline_links`; it never replaces it.
//!
//! ## Recognised shapes
//!
//! | Input | Kind | id |
//! |---|---|---|
//! | `@agent:<id>` | `"agent"` | `<id>` |
//! | `@user:<id>` | `"user"` | `<id>` |
//! | `@position(<title>)` | `"position"` | `<title>` (resolved later) |
//! | `@<name>` | fuzzy | resolved by caller |
//!
//! For bare `@<name>` the parser emits `kind = "fuzzy"` and leaves
//! resolution to the wiring layer, which tries agent name → user name →
//! position title in the context of the entity scope.
//!
//! ### Character grammar
//!
//! A token continues until whitespace, punctuation (excluding `-`, `_`,
//! `.`), or end-of-string. Leading `@` is stripped. The result is trimmed.
//! Empty tokens (e.g. a lone `@`) are silently dropped.
//!
//! The parser is a pure function: no DB, no network.

use std::collections::HashSet;
use std::ops::Range;

/// Canonical kind strings emitted by the parser.
pub const KIND_AGENT: &str = "agent";
pub const KIND_USER: &str = "user";
pub const KIND_POSITION: &str = "position";
/// Fuzzy — bare `@name`; the caller must resolve to agent/user/position.
pub const KIND_FUZZY: &str = "fuzzy";

/// One parsed mention reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionRef {
    /// One of `"agent"`, `"user"`, `"position"`, `"fuzzy"`.
    pub kind: String,
    /// The entity id, user id, position title, or name token.
    pub id: String,
    /// The verbatim substring that was matched (including the leading `@`).
    pub raw_text: String,
    /// Byte range of `raw_text` within the original body.
    pub char_range: Range<usize>,
}

/// Parse all `@<token>` mentions from `body`. Deduplicated on
/// `(kind, id)` case-insensitively; first-seen wins.
pub fn parse_mentions(body: &str) -> Vec<MentionRef> {
    let mut out = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let bytes = body.as_bytes();
    let len = bytes.len();

    let mut i = 0;
    while i < len {
        if bytes[i] != b'@' {
            i += 1;
            continue;
        }

        // Don't match `@@` (email addresses etc.) or `@` preceded by `\w`.
        if i > 0 && is_word_char(bytes[i - 1]) {
            i += 1;
            continue;
        }

        let at_pos = i;
        let token_start = i + 1; // byte after `@`

        if token_start >= len || is_whitespace_or_terminal(bytes[token_start]) {
            // Lone `@` or `@ ` — skip.
            i += 1;
            continue;
        }

        // ── `@agent:<id>` or `@user:<id>` ─────────────────────────────────
        if let Some((kind, id_start)) = detect_prefixed_kind(body, token_start) {
            let id_end = scan_token_end(bytes, id_start);
            let id = body[id_start..id_end].trim();
            if !id.is_empty() {
                let raw = &body[at_pos..id_end];
                let key = (kind.to_string(), id.to_lowercase());
                if seen.insert(key) {
                    out.push(MentionRef {
                        kind: kind.to_string(),
                        id: id.to_string(),
                        raw_text: raw.to_string(),
                        char_range: at_pos..id_end,
                    });
                }
                i = id_end;
                continue;
            }
        }

        // ── `@position(<title>)` ──────────────────────────────────────────
        if body[token_start..].starts_with("position(") {
            let paren_open = token_start + "position(".len();
            if let Some(paren_close) = body[paren_open..].find(')') {
                let title = body[paren_open..paren_open + paren_close].trim();
                if !title.is_empty() {
                    let end = paren_open + paren_close + 1;
                    let raw = &body[at_pos..end];
                    let key = (KIND_POSITION.to_string(), title.to_lowercase());
                    if seen.insert(key) {
                        out.push(MentionRef {
                            kind: KIND_POSITION.to_string(),
                            id: title.to_string(),
                            raw_text: raw.to_string(),
                            char_range: at_pos..end,
                        });
                    }
                    i = end;
                    continue;
                }
            }
        }

        // ── Bare `@<name>` ────────────────────────────────────────────────
        let name_end = scan_token_end(bytes, token_start);
        let name = body[token_start..name_end].trim_end_matches('.');
        if !name.is_empty() {
            let end = at_pos + 1 + name.len();
            let raw = &body[at_pos..end];
            let key = (KIND_FUZZY.to_string(), name.to_lowercase());
            if seen.insert(key) {
                out.push(MentionRef {
                    kind: KIND_FUZZY.to_string(),
                    id: name.to_string(),
                    raw_text: raw.to_string(),
                    char_range: at_pos..end,
                });
            }
        }
        i = name_end;
    }

    out
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Detect `agent:` or `user:` prefix at `token_start`. Returns `(kind,
/// id_start_byte)` or `None`.
fn detect_prefixed_kind(body: &str, token_start: usize) -> Option<(&'static str, usize)> {
    let rest = &body[token_start..];
    for (prefix, kind) in &[("agent:", KIND_AGENT), ("user:", KIND_USER)] {
        if rest.starts_with(prefix) {
            let id_start = token_start + prefix.len();
            return Some((kind, id_start));
        }
    }
    None
}

/// Scan forward from `start` until whitespace, a terminal punctuation char,
/// or end-of-string. Returns the end byte index (exclusive).
fn scan_token_end(bytes: &[u8], start: usize) -> usize {
    let mut j = start;
    while j < bytes.len() {
        let b = bytes[j];
        if is_whitespace_or_terminal(b) {
            break;
        }
        j += 1;
    }
    j
}

/// Characters that are *not* part of a mention token. This is deliberately
/// permissive: we allow `-`, `_`, `.`, `/`, `:` inside the token so that
/// UUIDs and kebab-IDs work correctly.
fn is_whitespace_or_terminal(b: u8) -> bool {
    matches!(
        b,
        b' ' | b'\t'
            | b'\n'
            | b'\r'
            | b','
            | b';'
            | b'!'
            | b'?'
            | b'\''
            | b'"'
            | b'('
            | b')'
            | b'['
            | b']'
            | b'{'
            | b'}'
    )
}

/// True for characters that are word constituents (prev-char guard prevents
/// matching `word@anything`).
fn is_word_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ids_only(refs: &[MentionRef]) -> Vec<(String, String)> {
        refs.iter()
            .map(|r| (r.kind.clone(), r.id.clone()))
            .collect()
    }

    #[test]
    fn agent_prefixed() {
        let refs = parse_mentions("ping @agent:hermes about this");
        assert_eq!(ids_only(&refs), vec![("agent".into(), "hermes".into())]);
        assert_eq!(refs[0].raw_text, "@agent:hermes");
    }

    #[test]
    fn user_prefixed() {
        let refs = parse_mentions("cc @user:alice-123");
        assert_eq!(ids_only(&refs), vec![("user".into(), "alice-123".into())]);
    }

    #[test]
    fn position_syntax() {
        let refs = parse_mentions("escalate to @position(Head of Engineering)");
        assert_eq!(
            ids_only(&refs),
            vec![("position".into(), "Head of Engineering".into())]
        );
        assert_eq!(refs[0].raw_text, "@position(Head of Engineering)");
    }

    #[test]
    fn bare_name_fuzzy() {
        let refs = parse_mentions("hey @alice what do you think");
        assert_eq!(ids_only(&refs), vec![("fuzzy".into(), "alice".into())]);
    }

    #[test]
    fn bare_name_with_hyphen() {
        let refs = parse_mentions("@deploy-bot please run");
        assert_eq!(ids_only(&refs), vec![("fuzzy".into(), "deploy-bot".into())]);
    }

    #[test]
    fn bare_uuid_agent_id() {
        let refs = parse_mentions("@agent:550e8400-e29b-41d4-a716-446655440000 check it");
        assert_eq!(
            ids_only(&refs),
            vec![(
                "agent".into(),
                "550e8400-e29b-41d4-a716-446655440000".into()
            )]
        );
    }

    #[test]
    fn multiple_mentions() {
        let refs = parse_mentions("@alice @agent:bob and @user:carol done");
        assert_eq!(
            ids_only(&refs),
            vec![
                ("fuzzy".into(), "alice".into()),
                ("agent".into(), "bob".into()),
                ("user".into(), "carol".into()),
            ]
        );
    }

    #[test]
    fn case_insensitive_dedup() {
        let refs = parse_mentions("@Alice @alice @ALICE");
        assert_eq!(ids_only(&refs), vec![("fuzzy".into(), "Alice".into())]);
    }

    #[test]
    fn deduplicate_agent_prefix() {
        let refs = parse_mentions("@agent:hermes and @agent:hermes again");
        assert_eq!(refs.len(), 1);
    }

    #[test]
    fn lone_at_is_ignored() {
        let refs = parse_mentions("send @ to the void");
        assert!(refs.is_empty());
    }

    #[test]
    fn email_is_not_a_mention() {
        // `user@example.com` — `@` is preceded by a word char
        let refs = parse_mentions("reach me at user@example.com please");
        assert!(refs.is_empty());
    }

    #[test]
    fn trailing_punctuation_stripped() {
        let refs = parse_mentions("thanks @alice.");
        // trailing `.` is stripped by trim_end_matches('.')
        assert_eq!(ids_only(&refs), vec![("fuzzy".into(), "alice".into())]);
    }

    #[test]
    fn comma_terminates_token() {
        let refs = parse_mentions("@alice, @bob");
        assert_eq!(
            ids_only(&refs),
            vec![
                ("fuzzy".into(), "alice".into()),
                ("fuzzy".into(), "bob".into())
            ]
        );
    }

    #[test]
    fn empty_body() {
        assert!(parse_mentions("").is_empty());
    }

    #[test]
    fn no_mentions_in_plain_prose() {
        assert!(parse_mentions("nothing special here").is_empty());
    }

    #[test]
    fn position_with_empty_parens_emits_fuzzy_position() {
        // @position() — empty title, position branch skips; bare-name
        // path stops at `(` and emits "position" as a fuzzy token.
        let refs = parse_mentions("@position()");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, "fuzzy");
        assert_eq!(refs[0].id, "position");
    }

    #[test]
    fn position_unterminated_paren_falls_through_to_fuzzy() {
        // @position( without closing ) — position branch skips (no `)`);
        // bare-name path stops at `(` and emits "position" as a fuzzy token.
        let refs = parse_mentions("@position(no-close");
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, "fuzzy");
        assert_eq!(refs[0].id, "position");
    }
}
