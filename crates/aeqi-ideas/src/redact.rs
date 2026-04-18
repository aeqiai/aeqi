//! Secret redaction for idea contents.
//!
//! The idea store is a public surface: anything written to it may be
//! echoed to the UI, exported, or pulled into future LLM prompts.
//! Credentials that slip through — Telegram bot tokens, OpenAI-style
//! API keys, Bearer tokens, AWS access keys — must never be persisted.
//!
//! Redaction runs character-by-character; we do not depend on a regex
//! crate to keep this module self-contained. Every matched secret is
//! replaced with the string `[REDACTED]`. False positives are tolerated
//! over false negatives — better to over-redact than to leak.

const REDACTION: &str = "[REDACTED]";

/// Replace credentials found in `input` with `[REDACTED]`.
pub fn redact_secrets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if let Some(len) = match_telegram_token(&bytes[i..]) {
            out.push_str(REDACTION);
            i += len;
            continue;
        }
        if let Some(len) = match_sk_key(&bytes[i..]) {
            out.push_str(REDACTION);
            i += len;
            continue;
        }
        if let Some(len) = match_bearer_token(&bytes[i..]) {
            out.push_str(REDACTION);
            i += len;
            continue;
        }
        if let Some(len) = match_aws_access_key(&bytes[i..]) {
            out.push_str(REDACTION);
            i += len;
            continue;
        }
        if let Some(len) = match_github_token(&bytes[i..]) {
            out.push_str(REDACTION);
            i += len;
            continue;
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn is_bearer_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.' || b == b'='
}

/// Telegram bot token: 8–10 digit bot id, colon, 35-char alnum/_- suffix.
fn match_telegram_token(s: &[u8]) -> Option<usize> {
    let mut digits = 0;
    while digits < s.len() && s[digits].is_ascii_digit() {
        digits += 1;
    }
    if !(8..=10).contains(&digits) {
        return None;
    }
    if s.get(digits) != Some(&b':') {
        return None;
    }
    let mut suffix = 0;
    let start = digits + 1;
    while start + suffix < s.len() && is_token_byte(s[start + suffix]) {
        suffix += 1;
    }
    if suffix < 30 {
        return None;
    }
    Some(start + suffix)
}

/// OpenAI-style API key: `sk-` followed by 20+ token bytes.
fn match_sk_key(s: &[u8]) -> Option<usize> {
    if s.len() < 23 {
        return None;
    }
    if &s[..3] != b"sk-" {
        return None;
    }
    let mut n = 3;
    while n < s.len() && is_token_byte(s[n]) {
        n += 1;
    }
    if n - 3 < 20 {
        return None;
    }
    Some(n)
}

/// `Bearer <token>` where token is 20+ bearer bytes.
fn match_bearer_token(s: &[u8]) -> Option<usize> {
    if s.len() < 8 {
        return None;
    }
    if &s[..7] != b"Bearer " {
        return None;
    }
    let mut n = 7;
    while n < s.len() && is_bearer_byte(s[n]) {
        n += 1;
    }
    if n - 7 < 20 {
        return None;
    }
    Some(n)
}

/// AWS access key: `AKIA` + 16 uppercase alnum.
fn match_aws_access_key(s: &[u8]) -> Option<usize> {
    if s.len() < 20 {
        return None;
    }
    if &s[..4] != b"AKIA" {
        return None;
    }
    for &b in &s[4..20] {
        if !(b.is_ascii_uppercase() || b.is_ascii_digit()) {
            return None;
        }
    }
    Some(20)
}

/// GitHub personal-access token: `ghp_` / `gho_` / `ghs_` / `ghu_` + 36+ token bytes.
fn match_github_token(s: &[u8]) -> Option<usize> {
    if s.len() < 40 {
        return None;
    }
    let prefix = &s[..4];
    if !matches!(prefix, b"ghp_" | b"gho_" | b"ghs_" | b"ghu_" | b"ghr_") {
        return None;
    }
    let mut n = 4;
    while n < s.len() && is_token_byte(s[n]) {
        n += 1;
    }
    if n - 4 < 36 {
        return None;
    }
    Some(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_telegram_bot_token_inline() {
        let input = "hit https://api.telegram.org/bot8461143135:AAHFgFLMaCAw0Cql9xjt6jmNtFHgNfqydJg/getMe now";
        let out = redact_secrets(input);
        assert!(out.contains("[REDACTED]"));
        assert!(!out.contains("AAHFgFLMaCAw0Cql9xjt6jmNtFHgNfqydJg"));
    }

    #[test]
    fn redacts_openai_style_key() {
        let input = "key=sk-abc123XYZ456def789GHI012";
        let out = redact_secrets(input);
        assert_eq!(out, "key=[REDACTED]");
    }

    #[test]
    fn redacts_bearer_token() {
        let input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc";
        let out = redact_secrets(input);
        assert!(out.starts_with("Authorization: [REDACTED]"));
        assert!(!out.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
    }

    #[test]
    fn redacts_aws_access_key() {
        let input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE done";
        let out = redact_secrets(input);
        assert!(out.contains("[REDACTED]"));
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
    }

    #[test]
    fn redacts_github_pat() {
        let input = "Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1 ok";
        let out = redact_secrets(input);
        assert!(out.contains("[REDACTED]"));
        assert!(!out.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyz1"));
    }

    #[test]
    fn leaves_normal_text_untouched() {
        let input = "Here is a regular note with no secrets. Numbers like 42 are fine.";
        assert_eq!(redact_secrets(input), input);
    }

    #[test]
    fn handles_empty_string() {
        assert_eq!(redact_secrets(""), "");
    }

    #[test]
    fn handles_unicode() {
        let input = "こんにちは world, sk-abc123XYZ456def789GHI012 tail";
        let out = redact_secrets(input);
        assert!(out.starts_with("こんにちは world, [REDACTED]"));
    }

    #[test]
    fn preserves_short_sk_dash_identifiers() {
        // "sk-foo" is too short to look like an API key — leave it.
        let input = "short sk-foo notkey";
        assert_eq!(redact_secrets(input), input);
    }
}
