//! Shell command execution tool for AEQI.
//!
//! This module provides a [`Tool`] implementation for executing shell commands
//! in a controlled environment. It includes basic command validation to prevent
//! obvious injection attempts and supports timeouts, background execution,
//! and configurable working directories.
//!
//! # Security Notes
//! - Commands are executed via `bash -c` which is inherently vulnerable to injection
//! - Basic validation is performed to catch dangerous patterns (rm -rf /, fork bombs, etc.)
//! - For production use, consider using the sandboxed version in `aeqi-orchestrator`
//! - Commands run with the same permissions as the AEQI process
//!
//! # Example
//! ```no_run
//! use aeqi_tools::ShellTool;
//! use aeqi_core::traits::Tool;
//!
//! let tool = ShellTool::new("/tmp".into());
//! // tool.execute(serde_json::json!({"command": "echo hello"}))
//! ```

use aeqi_core::traits::{ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tracing::debug;

/// Sandboxed shell command execution tool.
pub struct ShellTool {
    /// Working directory for commands.
    workdir: PathBuf,
    /// Maximum command runtime in seconds.
    timeout_secs: u64,
}

impl ShellTool {
    pub fn new(workdir: PathBuf) -> Self {
        Self {
            workdir,
            timeout_secs: 120,
        }
    }

    pub fn with_timeout(mut self, timeout_secs: u64) -> Self {
        self.timeout_secs = timeout_secs;
        self
    }

    /// Basic validation of shell commands to prevent obvious injection attempts.
    /// This is not comprehensive but catches the most dangerous patterns.
    fn validate_command(&self, command: &str) -> Result<()> {
        // Check for dangerous patterns that could indicate injection attempts
        let dangerous_patterns = [
            "rm -rf /",             // Dangerous deletion
            "rm -rf /*",            // Dangerous deletion
            ":(){ :|:& };:",        // Fork bomb
            "mkfs",                 // Filesystem formatting
            "dd if=/dev/zero",      // Disk wiping
            "> /dev/sda",           // Disk writing
            "chmod -R 777 /",       // Permission changes
            "chown -R root:root /", // Ownership changes
        ];

        let lower_command = command.to_lowercase();

        for pattern in dangerous_patterns {
            if lower_command.contains(pattern) {
                return Err(anyhow::anyhow!(
                    "Command contains dangerous pattern: {}",
                    pattern
                ));
            }
        }

        // Check for multiple command separators in a row (could indicate injection)
        let separators = [";", "&&", "||", "|"];
        let mut separator_count = 0;

        for ch in command.chars() {
            if separators.iter().any(|s| s.contains(ch)) {
                separator_count += 1;
                if separator_count > 5 {
                    return Err(anyhow::anyhow!(
                        "Command contains too many command separators"
                    ));
                }
            } else if !separators.iter().any(|s| s.contains(ch)) {
                separator_count = 0;
            }
        }

        Ok(())
    }
}

#[async_trait]
impl aeqi_core::traits::Tool for ShellTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'command' argument"))?;

        // Validate command for safety
        self.validate_command(command)?;

        let workdir = args
            .get("workdir")
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.workdir.clone());

        // Parse timeout: arg in ms, default to self.timeout_secs * 1000, cap at 600_000ms
        let timeout_ms = args
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(self.timeout_secs * 1000)
            .min(600_000);
        let timeout_dur = Duration::from_millis(timeout_ms);

        // Parse run_in_background
        let run_in_background = args
            .get("run_in_background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        debug!(command = %command, workdir = %workdir.display(), timeout_ms, run_in_background, "executing shell command");

        if run_in_background {
            let mut child = Command::new("bash")
                .arg("-c")
                .arg(command)
                .current_dir(&workdir)
                .spawn()
                .map_err(|e| anyhow::anyhow!("failed to spawn background command: {e}"))?;

            let pid = child.id().unwrap_or(0);

            // Spawn a task to wait on the child so it doesn't become a zombie
            tokio::spawn(async move {
                let _ = child.wait().await;
            });

            return Ok(ToolResult::success(format!(
                "Command started in background. PID: {pid}"
            )));
        }

        let result = tokio::time::timeout(
            timeout_dur,
            Command::new("bash")
                .arg("-c")
                .arg(command)
                .current_dir(&workdir)
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                let mut result_text = String::new();

                if !stdout.is_empty() {
                    result_text.push_str(&stdout);
                }
                if !stderr.is_empty() {
                    if !result_text.is_empty() {
                        result_text.push('\n');
                    }
                    result_text.push_str("STDERR:\n");
                    result_text.push_str(&stderr);
                }

                if result_text.is_empty() {
                    result_text = "(no output)".to_string();
                }

                // Truncate if too long.
                if result_text.len() > 30000 {
                    result_text.truncate(30000);
                    result_text.push_str("\n... (output truncated)");
                }

                if output.status.success() {
                    Ok(ToolResult::success(result_text))
                } else {
                    Ok(ToolResult::error(format!(
                        "exit code {}\n{}",
                        output.status.code().unwrap_or(-1),
                        result_text
                    )))
                }
            }
            Ok(Err(e)) => Ok(ToolResult::error(format!("failed to execute command: {e}"))),
            Err(_) => Ok(ToolResult::error(format!(
                "command timed out after {}ms",
                timeout_ms
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "shell".to_string(),
            description: "Execute a shell command. Use for git operations, builds, tests, and system commands.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute"
                    },
                    "workdir": {
                        "type": "string",
                        "description": "Working directory (optional, defaults to agent workdir)"
                    },
                    "description": {
                        "type": "string",
                        "description": "Clear description of what this command does"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 120000, max: 600000)"
                    },
                    "run_in_background": {
                        "type": "boolean",
                        "description": "Run command in background and return immediately with a task ID"
                    }
                },
                "required": ["command"]
            }),
        }
    }

    fn name(&self) -> &str {
        "shell"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }

    fn cascades_error_to_siblings(&self) -> bool {
        true
    }
}
