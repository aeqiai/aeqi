//! Syntax highlighting via syntect — converts source code to styled spans.

use syntect::easy::HighlightLines;
use syntect::highlighting::{Style as SynStyle, ThemeSet};
use syntect::parsing::SyntaxSet;

use super::markdown::{StyledLine, StyledSpan};

static SYNTAX_SET: std::sync::LazyLock<SyntaxSet> =
    std::sync::LazyLock::new(SyntaxSet::load_defaults_newlines);

static THEME: std::sync::LazyLock<syntect::highlighting::Theme> = std::sync::LazyLock::new(|| {
    let ts = ThemeSet::load_defaults();
    ts.themes["base16-ocean.dark"].clone()
});

fn normalize_lang(lang: &str) -> &str {
    match lang.to_lowercase().as_str() {
        "js" | "javascript" => "JavaScript",
        "ts" | "typescript" => "TypeScript",
        "py" | "python" => "Python",
        "rb" | "ruby" => "Ruby",
        "rs" | "rust" => "Rust",
        "sh" | "bash" | "shell" | "zsh" => "Bourne Again Shell (bash)",
        "yml" | "yaml" => "YAML",
        "json" => "JSON",
        "toml" => "TOML",
        "go" | "golang" => "Go",
        "c" => "C",
        "cpp" | "c++" => "C++",
        "java" => "Java",
        "sql" => "SQL",
        "html" => "HTML",
        "css" => "CSS",
        "xml" => "XML",
        _ => lang,
    }
}

/// Highlight source code and return styled lines.
pub fn highlight_code(code: &str, lang: &str) -> Vec<StyledLine> {
    let ss = &*SYNTAX_SET;
    let theme = &*THEME;

    let normalized = normalize_lang(lang);
    let syntax = ss
        .find_syntax_by_name(normalized)
        .or_else(|| ss.find_syntax_by_extension(lang))
        .unwrap_or_else(|| ss.find_syntax_plain_text());

    let mut h = HighlightLines::new(syntax, theme);
    let mut lines = Vec::new();

    for line in code.lines() {
        match h.highlight_line(line, ss) {
            Ok(ranges) => {
                let spans: Vec<StyledSpan> = std::iter::once(StyledSpan::plain("  "))
                    .chain(ranges.into_iter().map(|(s, t)| to_span(s, t)))
                    .collect();
                let mut sl = StyledLine::new(spans);
                sl.is_code_block = true;
                lines.push(sl);
            }
            Err(_) => {
                lines.push(StyledLine {
                    spans: vec![StyledSpan {
                        text: format!("  {line}"),
                        dim: true,
                        code: true,
                        ..StyledSpan::plain("")
                    }],
                    is_code_block: true,
                    indent: 0,
                });
            }
        }
    }
    lines
}

fn to_span(style: SynStyle, text: &str) -> StyledSpan {
    let fg = style.foreground;
    StyledSpan {
        text: text.to_string(),
        bold: (style.font_style.bits() & 1) != 0,
        italic: (style.font_style.bits() & 2) != 0,
        dim: false,
        code: true,
        color: Some((fg.r, fg.g, fg.b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_highlight_rust() {
        let lines = highlight_code("fn main() {\n    println!(\"hello\");\n}", "rust");
        assert!(!lines.is_empty());
        assert!(lines[0].spans.iter().any(|s| s.color.is_some()));
    }

    #[test]
    fn test_highlight_unknown_lang() {
        let lines = highlight_code("some text", "nonexistent_xyz");
        assert!(!lines.is_empty());
    }

    #[test]
    fn test_normalize() {
        assert_eq!(normalize_lang("rs"), "Rust");
        assert_eq!(normalize_lang("py"), "Python");
        assert_eq!(normalize_lang("js"), "JavaScript");
    }
}
