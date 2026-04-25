//! Shared FTS5 helpers — sanitiser, query wrapper, and snippet builder.
//!
//! Extracted from `sqlite::search` so any caller (idea search, session
//! transcript search, future FTS5-backed primitives) can reuse the same
//! BM25 read path without re-implementing the metacharacter dance.
//!
//! ### What lives here
//!
//! - [`sanitise_fts5_query`] — strip metacharacters per word and append `*`
//!   prefix wildcards so partial words match. Handles unbalanced quotes /
//!   parens, empty input, and pure whitespace by returning `"\"\""` (an
//!   FTS5 expression that matches nothing — safer than the raw query
//!   bubbling a parser error to the caller).
//! - [`fts5_snippet_expr`] — produces the `snippet(...)` SQL expression for
//!   the standard `<mark>...</mark>` highlight markers used across the
//!   codebase. Centralised so the marker tokens stay consistent.
//! - [`fts5_max_token_count`] — token-count cap fed into `snippet()`.
//!
//! ### What deliberately does NOT live here
//!
//! - Per-table SQL (column lists, WHERE clauses, scope filters). Each
//!   FTS5 caller knows its own schema; this module is the lexical layer
//!   only.
//! - Score normalisation. BM25 from FTS5 is negative (lower = better);
//!   each caller decides whether to flip the sign for downstream weighted
//!   sums. The raw value is what `bm25(<table>)` returns.

/// FTS5 metacharacters stripped from each query word before re-assembly.
///
/// Quote/paren stripping handles unbalanced delimiters at the cost of
/// dropping exact-phrase queries entirely. The previous (per-call inline)
/// sanitiser made the same trade; this constant just pins it.
const FTS5_METACHARS: [char; 7] = ['"', '\'', '*', '^', '-', '(', ')'];

/// Default max token count fed into `snippet(<table>, col, '<mark>',
/// '</mark>', '...', N)`. ~32 tokens at typical English token lengths
/// lands the snippet near the 200-character target the design plan calls
/// out without truncating mid-word.
pub const FTS5_DEFAULT_SNIPPET_TOKEN_COUNT: i32 = 32;

/// Compile a raw user query into an FTS5 MATCH expression.
///
/// Each whitespace-separated word is stripped of FTS5 metacharacters and
/// suffixed with `*` so prefix matching works (e.g. `"auth"` matches
/// `"authentication"`). The resulting expression is implicitly AND-joined
/// across words — FTS5's default for space-separated terms.
///
/// Edge cases — all return `"\"\""` (an empty exact-phrase that matches
/// nothing, but is a *valid* FTS5 expression so the caller's `MATCH`
/// clause never triggers a parser error):
///
/// - empty string
/// - all-whitespace input
/// - input that becomes empty after stripping (e.g. just `"*"`, `"()"`)
/// - any unbalanced quote / paren — the chars are dropped per-word, so
///   the expression always parses.
pub fn sanitise_fts5_query(text: &str) -> String {
    let words: Vec<String> = text
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| {
            let safe = w.replace(FTS5_METACHARS, "");
            if safe.is_empty() {
                String::new()
            } else {
                format!("{safe}*")
            }
        })
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        // FTS5 parses `""` as the empty phrase — yields no matches but
        // doesn't error out. Safer than passing the raw input through.
        "\"\"".into()
    } else if words.len() == 1 {
        words.into_iter().next().unwrap()
    } else {
        words.join(" ")
    }
}

/// Build the SQL expression that calls FTS5's built-in `snippet()` against
/// the given table+column with `<mark>...</mark>` highlight markers and an
/// ellipsis fallback for non-matching context.
///
/// `column_index` is the 0-based column position inside the FTS5 virtual
/// table (e.g. `0` for the first / only `content` column, `1` for the
/// second column when an FTS5 table indexes both `name` and `content`).
///
/// `token_count` controls the snippet width (FTS5's `N` argument). Pass
/// [`FTS5_DEFAULT_SNIPPET_TOKEN_COUNT`] for the codebase default.
pub fn fts5_snippet_expr(table: &str, column_index: i32, token_count: i32) -> String {
    format!("snippet({table}, {column_index}, '<mark>', '</mark>', '…', {token_count})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_yields_empty_phrase() {
        assert_eq!(sanitise_fts5_query(""), "\"\"");
    }

    #[test]
    fn all_whitespace_yields_empty_phrase() {
        assert_eq!(sanitise_fts5_query("   \t\n  "), "\"\"");
    }

    #[test]
    fn single_word_gets_prefix_star() {
        assert_eq!(sanitise_fts5_query("hello"), "hello*");
    }

    #[test]
    fn multi_word_joined_with_space() {
        assert_eq!(sanitise_fts5_query("foo bar"), "foo* bar*");
    }

    #[test]
    fn unbalanced_quote_is_stripped() {
        // `"unclosed` would error in raw FTS5 — sanitiser drops the quote.
        assert_eq!(sanitise_fts5_query("\"unclosed"), "unclosed*");
    }

    #[test]
    fn unbalanced_paren_is_stripped() {
        assert_eq!(sanitise_fts5_query("(unbalanced"), "unbalanced*");
    }

    #[test]
    fn glob_star_in_middle_is_stripped() {
        assert_eq!(sanitise_fts5_query("foo*bar"), "foobar*");
    }

    #[test]
    fn pure_metachars_drop_to_empty_phrase() {
        assert_eq!(sanitise_fts5_query("**"), "\"\"");
        assert_eq!(sanitise_fts5_query("()"), "\"\"");
        assert_eq!(sanitise_fts5_query("\"\""), "\"\"");
    }

    #[test]
    fn fts5_snippet_expr_shape() {
        let s = fts5_snippet_expr("messages_fts", 0, 32);
        assert_eq!(s, "snippet(messages_fts, 0, '<mark>', '</mark>', '…', 32)");
    }
}
