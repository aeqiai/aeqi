use aeqi_core::traits::{ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use tracing::debug;

pub struct GlobTool {
    workspace: PathBuf,
}

impl GlobTool {
    pub fn new(workspace: PathBuf) -> Self {
        Self { workspace }
    }
}

#[async_trait]
impl aeqi_core::traits::Tool for GlobTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let pattern = args
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'pattern' argument"))?;

        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");

        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(100);

        let search_path = if std::path::Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            self.workspace.join(path)
        };

        debug!(pattern, path = %search_path.display(), "glob search");

        let mut cmd = tokio::process::Command::new("rg");
        cmd.arg("--files")
            .arg("--glob")
            .arg(pattern)
            .arg("--color=never")
            .arg("--sort=modified")
            .arg(&search_path);

        let output =
            match tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await {
                Ok(Ok(o)) => o,
                Ok(Err(e)) => {
                    return Ok(ToolResult::error(format!(
                        "failed to run rg --files: {e}. Is ripgrep installed?"
                    )));
                }
                Err(_) => {
                    return Ok(ToolResult::error("glob timed out after 15s"));
                }
            };

        let stdout = String::from_utf8_lossy(&output.stdout);

        if stdout.is_empty() {
            return Ok(ToolResult::success("no files matched"));
        }

        let files: Vec<&str> = stdout.lines().collect();
        let total = files.len();
        let limited: String = files
            .into_iter()
            .take(max_results as usize)
            .collect::<Vec<_>>()
            .join("\n");

        let suffix = if total > max_results as usize {
            format!("\n\n... ({total} total files, showing first {max_results})")
        } else {
            format!("\n\n{total} files matched")
        };

        Ok(ToolResult::success(format!("{limited}{suffix}")))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "glob".to_string(),
            description: "Find files matching a glob pattern. Returns file paths sorted by modification time.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (e.g. '*.rs', 'src/**/*.ts', '*.{js,jsx}')"
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search in (default: workspace root)"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum files to return (default: 100)"
                    }
                },
                "required": ["pattern"]
            }),
        }
    }

    fn name(&self) -> &str {
        "glob"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::Tool;
    use tempfile::TempDir;

    async fn setup() -> (GlobTool, TempDir) {
        let dir = TempDir::new().unwrap();
        tokio::fs::write(dir.path().join("main.rs"), "fn main() {}")
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("lib.rs"), "pub mod lib;")
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("readme.md"), "# Readme")
            .await
            .unwrap();
        let tool = GlobTool::new(dir.path().to_path_buf());
        (tool, dir)
    }

    #[tokio::test]
    async fn finds_rust_files() {
        let (tool, _dir) = setup().await;
        let result = tool
            .execute(serde_json::json!({ "pattern": "*.rs" }))
            .await
            .unwrap();
        assert!(!result.is_error, "{}", result.output);
        assert!(result.output.contains("main.rs"));
        assert!(result.output.contains("lib.rs"));
        assert!(!result.output.contains("readme.md"));
    }

    #[tokio::test]
    async fn no_matches() {
        let (tool, _dir) = setup().await;
        let result = tool
            .execute(serde_json::json!({ "pattern": "*.xyz" }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("no files matched"));
    }
}
