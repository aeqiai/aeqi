use aeqi_core::traits::{ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tracing::debug;

pub struct FileEditTool {
    workspace: PathBuf,
}

impl FileEditTool {
    pub fn new(workspace: PathBuf) -> Self {
        Self { workspace }
    }

    fn resolve_path(&self, path: &str) -> Result<PathBuf> {
        let resolved = if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            self.workspace.join(path)
        };

        let canonical = resolved.canonicalize().unwrap_or_else(|_| resolved.clone());
        let workspace_canonical = self
            .workspace
            .canonicalize()
            .unwrap_or_else(|_| self.workspace.clone());

        if !canonical.starts_with(&workspace_canonical) {
            anyhow::bail!(
                "path {} is outside workspace {}",
                path,
                self.workspace.display()
            );
        }

        Ok(canonical)
    }
}

#[async_trait]
impl aeqi_core::traits::Tool for FileEditTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'path' argument"))?;

        let old_string = args
            .get("old_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'old_string' argument"))?;

        let new_string = args
            .get("new_string")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'new_string' argument"))?;

        let replace_all = args
            .get("replace_all")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let resolved = match self.resolve_path(path) {
            Ok(p) => p,
            Err(e) => return Ok(ToolResult::error(e.to_string())),
        };

        let content = match tokio::fs::read_to_string(&resolved).await {
            Ok(c) => c,
            Err(e) => {
                return Ok(ToolResult::error(format!(
                    "failed to read {}: {e}",
                    resolved.display()
                )));
            }
        };

        if old_string == new_string {
            return Ok(ToolResult::error("old_string and new_string are identical"));
        }

        if replace_all {
            if !content.contains(old_string) {
                if let Some(similar) = find_similar_substring(&content, old_string, 3) {
                    return Ok(ToolResult::error(format!(
                        "old_string not found in {}. Did you mean: '{}'?",
                        resolved.display(),
                        similar.lines().take(3).collect::<Vec<_>>().join("\\n")
                    )));
                }
                return Ok(ToolResult::error(format!(
                    "old_string not found in {}",
                    resolved.display()
                )));
            }
            let count = content.matches(old_string).count();
            let updated = content.replace(old_string, new_string);
            tokio::fs::write(&resolved, &updated).await?;
            debug!(path = %resolved.display(), count, "replaced all occurrences");
            return Ok(ToolResult::success(format!(
                "replaced {count} occurrences in {}",
                resolved.display()
            )));
        }

        let match_count = content.matches(old_string).count();

        if match_count == 0 {
            // Check for near-matches via sliding window (Levenshtein-like)
            if let Some(similar) = find_similar_substring(&content, old_string, 3) {
                return Ok(ToolResult::error(format!(
                    "old_string not found in {}. Did you mean: '{}'?",
                    resolved.display(),
                    similar.lines().take(3).collect::<Vec<_>>().join("\\n")
                )));
            }
            // Fall back to line-based fuzzy matching
            let suggestion = find_fuzzy_match(&content, old_string);
            let msg = if let Some((line_num, line)) = suggestion {
                format!(
                    "old_string not found in {}. Did you mean line {line_num}?\n  {line}",
                    resolved.display()
                )
            } else {
                format!("old_string not found in {}", resolved.display())
            };
            return Ok(ToolResult::error(msg));
        }

        if match_count > 1 {
            return Ok(ToolResult::error(format!(
                "old_string matches {match_count} locations in {}. Provide more surrounding context to make the match unique, or use replace_all.",
                resolved.display()
            )));
        }

        let updated = content.replacen(old_string, new_string, 1);
        tokio::fs::write(&resolved, &updated).await?;

        debug!(path = %resolved.display(), "edited file");
        Ok(ToolResult::success(format!(
            "edited {}",
            resolved.display()
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "edit_file".to_string(),
            description: "Make a targeted edit to a file by replacing an exact string match. The old_string must be unique in the file unless replace_all is true. Provide enough surrounding context in old_string to ensure uniqueness.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file"
                    },
                    "old_string": {
                        "type": "string",
                        "description": "The exact string to find and replace"
                    },
                    "new_string": {
                        "type": "string",
                        "description": "The replacement string"
                    },
                    "replace_all": {
                        "type": "boolean",
                        "description": "Replace all occurrences instead of requiring uniqueness (default: false)"
                    }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        }
    }

    fn name(&self) -> &str {
        "edit_file"
    }
}

fn normalize_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Count character differences between two byte slices of equal length.
fn char_diff_count(a: &[u8], b: &[u8]) -> usize {
    a.iter().zip(b.iter()).filter(|(x, y)| x != y).count()
}

/// Sliding window search: find substrings in `content` that differ from `needle`
/// by at most `max_diff` characters. Returns the best (lowest diff) match as a
/// snippet with surrounding context.
fn find_similar_substring(content: &str, needle: &str, max_diff: usize) -> Option<String> {
    let content_bytes = content.as_bytes();
    let needle_bytes = needle.as_bytes();
    let needle_len = needle_bytes.len();

    if needle_len == 0 || needle_len > content_bytes.len() {
        return None;
    }

    let mut best_diff = max_diff + 1;
    let mut best_pos = 0usize;

    for i in 0..=(content_bytes.len() - needle_len) {
        let window = &content_bytes[i..i + needle_len];
        let diff = char_diff_count(window, needle_bytes);
        if diff <= max_diff && diff < best_diff {
            best_diff = diff;
            best_pos = i;
            if diff == 0 {
                break; // exact match, shouldn't happen but short-circuit
            }
        }
    }

    if best_diff > max_diff {
        return None;
    }

    // UTF-8 safety: ensure byte positions land on character boundaries.
    if best_pos + needle_len > content.len()
        || !content.is_char_boundary(best_pos)
        || !content.is_char_boundary(best_pos + needle_len)
    {
        return None;
    }

    // Extract the similar substring
    let similar = &content[best_pos..best_pos + needle_len];
    Some(similar.to_string())
}

fn find_fuzzy_match(content: &str, needle: &str) -> Option<(usize, String)> {
    let needle_trimmed = needle.trim();
    let first_line = needle_trimmed.lines().next().unwrap_or(needle_trimmed);
    let first_line_trimmed = first_line.trim();

    if first_line_trimmed.is_empty() {
        return None;
    }

    for (i, line) in content.lines().enumerate() {
        if line.contains(first_line_trimmed) {
            return Some((i + 1, line.to_string()));
        }
    }

    let needle_normalized = normalize_whitespace(first_line_trimmed).to_lowercase();
    for (i, line) in content.lines().enumerate() {
        let line_normalized = normalize_whitespace(line).to_lowercase();
        if line_normalized.contains(&needle_normalized) {
            return Some((i + 1, line.to_string()));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::Tool;
    use tempfile::TempDir;

    async fn setup(content: &str) -> (FileEditTool, TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("test.rs");
        tokio::fs::write(&file, content).await.unwrap();
        let tool = FileEditTool::new(dir.path().to_path_buf());
        (tool, dir, file)
    }

    #[tokio::test]
    async fn unique_match_succeeds() {
        let (tool, _dir, file) = setup("fn main() {\n    println!(\"hello\");\n}\n").await;
        let result = tool
            .execute(serde_json::json!({
                "path": file.to_str().unwrap(),
                "old_string": "println!(\"hello\")",
                "new_string": "println!(\"world\")"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "{}", result.output);
        let content = tokio::fs::read_to_string(&file).await.unwrap();
        assert!(content.contains("println!(\"world\")"));
    }

    #[tokio::test]
    async fn ambiguous_match_fails() {
        let (tool, _dir, file) = setup("let x = 1;\nlet y = 1;\n").await;
        let result = tool
            .execute(serde_json::json!({
                "path": file.to_str().unwrap(),
                "old_string": " = 1;",
                "new_string": " = 2;"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("2 locations"));
    }

    #[tokio::test]
    async fn no_match_suggests_fuzzy() {
        let (tool, _dir, file) = setup("fn main() {\n    let value = 42;\n}\n").await;
        let result = tool
            .execute(serde_json::json!({
                "path": file.to_str().unwrap(),
                "old_string": "let  value = 42;",
                "new_string": "let value = 99;"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("Did you mean"));
    }

    #[tokio::test]
    async fn replace_all_works() {
        let (tool, _dir, file) = setup("a = 1;\nb = 1;\nc = 1;\n").await;
        let result = tool
            .execute(serde_json::json!({
                "path": file.to_str().unwrap(),
                "old_string": " = 1;",
                "new_string": " = 2;",
                "replace_all": true
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "{}", result.output);
        assert!(result.output.contains("3 occurrences"));
    }

    #[tokio::test]
    async fn identical_strings_rejected() {
        let (tool, _dir, file) = setup("hello\n").await;
        let result = tool
            .execute(serde_json::json!({
                "path": file.to_str().unwrap(),
                "old_string": "hello",
                "new_string": "hello"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("identical"));
    }
}
