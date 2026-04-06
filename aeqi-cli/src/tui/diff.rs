//! Diff rendering — displays file changes with colored +/- lines.

use super::markdown::{StyledLine, StyledSpan};
use similar::{ChangeTag, TextDiff};

/// Render a unified diff between old and new content.
pub fn render_diff(old: &str, new: &str, file_path: &str) -> Vec<StyledLine> {
    let diff = TextDiff::from_lines(old, new);
    let mut lines = Vec::new();

    // File header.
    lines.push(StyledLine::new(vec![StyledSpan {
        text: format!("  --- {file_path}"),
        color: Some((180, 160, 255)), // Purple
        ..StyledSpan::plain("")
    }]));
    lines.push(StyledLine::new(vec![StyledSpan {
        text: format!("  +++ {file_path}"),
        color: Some((180, 160, 255)),
        ..StyledSpan::plain("")
    }]));

    for hunk in diff.unified_diff().context_radius(3).iter_hunks() {
        // Hunk header.
        lines.push(StyledLine::new(vec![StyledSpan {
            text: format!("  {}", hunk.header()),
            dim: true,
            color: Some((120, 120, 144)),
            ..StyledSpan::plain("")
        }]));

        for change in hunk.iter_changes() {
            let (prefix, color) = match change.tag() {
                ChangeTag::Delete => ("-", (255, 100, 100)), // Red
                ChangeTag::Insert => ("+", (100, 255, 100)), // Green
                ChangeTag::Equal => (" ", (180, 180, 180)),  // Gray
            };

            let text = format!("  {prefix}{}", change.value().trim_end_matches('\n'));
            lines.push(StyledLine::new(vec![StyledSpan {
                text,
                color: Some(color),
                ..StyledSpan::plain("")
            }]));
        }
    }

    if lines.len() <= 2 {
        // No actual changes.
        lines.push(StyledLine::new(vec![StyledSpan::dim("  (no changes)")]));
    }

    lines
}

/// Render a pre-computed unified diff string (from tool output).
pub fn render_unified_diff(diff_text: &str) -> Vec<StyledLine> {
    let mut lines = Vec::new();

    for line in diff_text.lines() {
        let (color, dim) = if line.starts_with("+++") || line.starts_with("---") {
            (Some((180, 160, 255)), false) // Purple for file headers
        } else if line.starts_with("@@") {
            (Some((120, 120, 144)), true) // Dim cyan for hunk headers
        } else if line.starts_with('+') {
            (Some((100, 255, 100)), false) // Green for additions
        } else if line.starts_with('-') {
            (Some((255, 100, 100)), false) // Red for deletions
        } else {
            (None, true) // Dim for context
        };

        lines.push(StyledLine::new(vec![StyledSpan {
            text: format!("  {line}"),
            dim,
            color,
            ..StyledSpan::plain("")
        }]));
    }

    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_diff() {
        let old = "line1\nline2\nline3\n";
        let new = "line1\nmodified\nline3\n";
        let lines = render_diff(old, new, "test.rs");
        assert!(!lines.is_empty());
        // Should have file headers.
        assert!(lines[0].spans[0].text.contains("test.rs"));
        // Should have colored changes.
        let has_red = lines
            .iter()
            .any(|l| l.spans.iter().any(|s| s.color == Some((255, 100, 100))));
        let has_green = lines
            .iter()
            .any(|l| l.spans.iter().any(|s| s.color == Some((100, 255, 100))));
        assert!(has_red, "should have red (deleted) lines");
        assert!(has_green, "should have green (added) lines");
    }

    #[test]
    fn test_no_changes() {
        let lines = render_diff("same\n", "same\n", "test.rs");
        assert!(
            lines
                .iter()
                .any(|l| l.spans.iter().any(|s| s.text.contains("no changes")))
        );
    }

    #[test]
    fn test_unified_diff_rendering() {
        let diff = "--- a/file.rs\n+++ b/file.rs\n@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3\n";
        let lines = render_unified_diff(diff);
        assert!(!lines.is_empty());
    }
}
