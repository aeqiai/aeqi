//! Quest sandbox — git worktree isolation with optional bubblewrap enforcement.
//!
//! Every quest execution can run inside a sandbox:
//! 1. A git worktree is created as the ephemeral workspace
//! 2. Shell commands execute inside bubblewrap (bwrap) with no network and limited fs
//! 3. File tools operate on the worktree via existing workspace validation
//! 4. On quest end: extract git diff, optionally commit/merge, then destroy worktree
//!
//! The agent can be fully destructive inside the sandbox — nothing persists unless
//! explicitly committed out.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::process::Command;
use tracing::{info, warn};

/// Configuration for quest sandboxing.
#[derive(Debug, Clone)]
pub struct SandboxConfig {
    /// Root of the git repository to create worktrees from.
    pub repo_root: PathBuf,
    /// Base directory for worktrees (e.g., ~/.aeqi/worktrees/).
    pub worktree_base: PathBuf,
    /// Git ref to base worktrees on (default: "HEAD").
    pub base_ref: String,
    /// Whether to wrap shell commands in bubblewrap.
    /// False for Owner tier (trusted), true for everyone else.
    pub enable_bwrap: bool,
    /// Extra read-only bind mounts for bwrap (host_path, guest_path).
    pub extra_ro_binds: Vec<(PathBuf, PathBuf)>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            repo_root: PathBuf::from("."),
            worktree_base: dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from("/tmp"))
                .join(".aeqi")
                .join("worktrees"),
            base_ref: "HEAD".to_string(),
            enable_bwrap: true,
            extra_ro_binds: Vec::new(),
        }
    }
}

/// A live quest sandbox — owns the worktree and provides bwrap command building.
pub struct QuestSandbox {
    /// Unique sandbox ID (matches quest_id).
    pub quest_id: String,
    /// Path to the worktree directory.
    pub worktree_path: PathBuf,
    /// Branch name for this worktree.
    pub branch_name: String,
    /// The repo root (for git operations outside the sandbox).
    pub repo_root: PathBuf,
    /// Whether to use bubblewrap for shell commands.
    pub enable_bwrap: bool,
    /// Extra read-only bind mounts.
    extra_ro_binds: Vec<(PathBuf, PathBuf)>,
    /// Whether the sandbox has been torn down.
    torn_down: AtomicBool,
}

/// The diff extracted from a quest sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestDiff {
    /// The raw unified diff text.
    pub diff_text: String,
    /// List of changed file paths.
    pub files_changed: Vec<String>,
    /// Number of lines inserted.
    pub insertions: u32,
    /// Number of lines deleted.
    pub deletions: u32,
    /// The branch name the changes are on.
    pub branch_name: String,
}

/// What to do with sandbox changes when finalizing.
#[derive(Debug, Clone)]
pub enum FinalizeAction {
    /// Commit all changes, merge into target branch, tear down.
    CommitAndMerge {
        message: String,
        target_branch: String,
    },
    /// Commit all changes on the worktree branch, keep the branch.
    CommitOnly { message: String },
    /// Discard all changes and tear down.
    Discard,
}

impl QuestSandbox {
    /// Create a new sandbox: creates a git worktree on a detached branch.
    pub async fn create(quest_id: &str, config: &SandboxConfig) -> Result<Self> {
        let branch_name = format!("quest/{quest_id}");
        let worktree_path = config.worktree_base.join(quest_id);

        // Ensure worktree base exists.
        tokio::fs::create_dir_all(&config.worktree_base)
            .await
            .with_context(|| {
                format!(
                    "failed to create worktree base: {}",
                    config.worktree_base.display()
                )
            })?;

        // Create git worktree.
        let output = Command::new("git")
            .args([
                "worktree",
                "add",
                "-b",
                &branch_name,
                &worktree_path.to_string_lossy(),
                &config.base_ref,
            ])
            .current_dir(&config.repo_root)
            .output()
            .await
            .context("failed to run git worktree add")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!(
                "git worktree add failed: {stderr}\nrepo: {}\nbranch: {branch_name}",
                config.repo_root.display()
            );
        }

        info!(
            quest_id,
            worktree = %worktree_path.display(),
            branch = %branch_name,
            "quest sandbox created"
        );

        Ok(Self {
            quest_id: quest_id.to_string(),
            worktree_path,
            branch_name,
            repo_root: config.repo_root.clone(),
            enable_bwrap: config.enable_bwrap,
            extra_ro_binds: config.extra_ro_binds.clone(),
            torn_down: AtomicBool::new(false),
        })
    }

    /// Build a `tokio::process::Command` that runs `inner_command` inside bwrap.
    ///
    /// The sandbox provides:
    /// - Read-write access to the worktree (mounted at /workspace)
    /// - Read-only system binaries (/usr, /bin, /lib, /lib64)
    /// - No network (--unshare-net)
    /// - Isolated PID namespace (--unshare-pid)
    /// - Ephemeral /tmp (tmpfs)
    /// - Dies with parent process
    ///
    /// If bwrap is disabled, returns a plain bash command scoped to the worktree.
    pub fn build_command(&self, inner_command: &str) -> Command {
        if !self.enable_bwrap {
            let mut cmd = Command::new("bash");
            cmd.arg("-c")
                .arg(inner_command)
                .current_dir(&self.worktree_path);
            return cmd;
        }

        let mut cmd = Command::new("bwrap");

        // Read-only system mounts for bash, git, rg, common tools.
        let ro_binds: &[(&str, &str)] = &[
            ("/usr", "/usr"),
            ("/bin", "/bin"),
            ("/lib", "/lib"),
            ("/lib64", "/lib64"),
            ("/etc/ssl", "/etc/ssl"),
            ("/etc/ca-certificates", "/etc/ca-certificates"),
            ("/etc/resolv.conf", "/etc/resolv.conf"),
            ("/etc/passwd", "/etc/passwd"),
            ("/etc/group", "/etc/group"),
            ("/etc/alternatives", "/etc/alternatives"),
        ];

        for (host, guest) in ro_binds {
            // Only bind paths that exist on the host.
            if Path::new(host).exists() {
                cmd.arg("--ro-bind").arg(host).arg(guest);
            }
        }

        // Extra read-only binds from config.
        for (host, guest) in &self.extra_ro_binds {
            if host.exists() {
                cmd.arg("--ro-bind")
                    .arg(host.as_os_str())
                    .arg(guest.as_os_str());
            }
        }

        // The worktree is the ONLY writable mount.
        cmd.arg("--bind")
            .arg(self.worktree_path.as_os_str())
            .arg("/workspace");

        // Minimal /dev, /proc, /tmp.
        cmd.arg("--dev").arg("/dev");
        cmd.arg("--proc").arg("/proc");
        cmd.arg("--tmpfs").arg("/tmp");

        // Isolation.
        cmd.arg("--unshare-net"); // No network.
        cmd.arg("--unshare-pid"); // Isolated PID namespace.
        cmd.arg("--die-with-parent"); // Cleanup on parent crash.
        cmd.arg("--new-session"); // Prevent terminal signal leakage.

        // Working directory inside the sandbox.
        cmd.arg("--chdir").arg("/workspace");

        // The actual command.
        cmd.arg("--").arg("bash").arg("-c").arg(inner_command);

        cmd
    }

    /// Extract the git diff of all changes made inside the worktree.
    /// Runs on the host side (not inside bwrap).
    pub async fn extract_diff(&self) -> Result<QuestDiff> {
        if self.torn_down.load(Ordering::Relaxed) {
            bail!("sandbox already torn down");
        }

        // Stage everything to capture new/deleted files in the diff.
        let _ = Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.worktree_path)
            .output()
            .await;

        // Get the diff against the base.
        let diff_output = Command::new("git")
            .args(["diff", "--cached", "--stat"])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to run git diff --cached --stat")?;

        let stat_text = String::from_utf8_lossy(&diff_output.stdout).to_string();

        // Parse insertions/deletions from the summary line.
        let (insertions, deletions) = parse_diff_stat(&stat_text);

        // Get the full diff text.
        let full_diff = Command::new("git")
            .args(["diff", "--cached"])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to run git diff --cached")?;

        let diff_text = String::from_utf8_lossy(&full_diff.stdout).to_string();

        // Get changed file list.
        let files_output = Command::new("git")
            .args(["diff", "--cached", "--name-only"])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to run git diff --cached --name-only")?;

        let files_changed: Vec<String> = String::from_utf8_lossy(&files_output.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();

        // Unstage so the worktree is back to a clean index state.
        let _ = Command::new("git")
            .args(["reset", "HEAD"])
            .current_dir(&self.worktree_path)
            .output()
            .await;

        Ok(QuestDiff {
            diff_text,
            files_changed,
            insertions,
            deletions,
            branch_name: self.branch_name.clone(),
        })
    }

    /// Commit all changes in the worktree with the given message.
    /// Returns the commit hash.
    pub async fn commit_changes(&self, message: &str, author: &str) -> Result<String> {
        if self.torn_down.load(Ordering::Relaxed) {
            bail!("sandbox already torn down");
        }

        // Stage everything.
        let add = Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to git add")?;

        if !add.status.success() {
            bail!("git add failed: {}", String::from_utf8_lossy(&add.stderr));
        }

        // Check if there's anything to commit.
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&self.worktree_path)
            .output()
            .await?;

        if String::from_utf8_lossy(&status.stdout).trim().is_empty() {
            bail!("nothing to commit");
        }

        // Commit.
        let commit = Command::new("git")
            .args([
                "commit",
                "-m",
                message,
                "--author",
                &format!("{author} <agent@aeqi.ai>"),
            ])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to git commit")?;

        if !commit.status.success() {
            bail!(
                "git commit failed: {}",
                String::from_utf8_lossy(&commit.stderr)
            );
        }

        // Get the commit hash.
        let hash = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to get commit hash")?;

        let commit_hash = String::from_utf8_lossy(&hash.stdout).trim().to_string();

        info!(
            quest_id = %self.quest_id,
            commit = %commit_hash,
            "sandbox changes committed"
        );

        Ok(commit_hash)
    }

    /// Finalize the sandbox: commit/merge/discard, then tear down.
    pub async fn finalize(&self, action: FinalizeAction) -> Result<Option<String>> {
        let commit_hash = match action {
            FinalizeAction::CommitAndMerge {
                message,
                target_branch: _,
            } => {
                let hash = self.commit_changes(&message, "aeqi-agent").await?;

                // Merge the quest branch into the target branch (from repo root).
                let merge = Command::new("git")
                    .args([
                        "merge",
                        &self.branch_name,
                        "--no-ff",
                        "-m",
                        &format!("Merge quest {}: {message}", self.quest_id),
                    ])
                    .current_dir(&self.repo_root)
                    .output()
                    .await
                    .context("failed to merge quest branch")?;

                if !merge.status.success() {
                    warn!(
                        quest_id = %self.quest_id,
                        stderr = %String::from_utf8_lossy(&merge.stderr),
                        "merge failed — branch preserved for manual resolution"
                    );
                    // Don't tear down if merge fails — keep the branch for manual resolution.
                    return Ok(Some(hash));
                }

                self.teardown().await?;
                Some(hash)
            }
            FinalizeAction::CommitOnly { message } => {
                let hash = self.commit_changes(&message, "aeqi-agent").await?;
                self.teardown().await?;
                Some(hash)
            }
            FinalizeAction::Discard => {
                self.teardown().await?;
                None
            }
        };

        Ok(commit_hash)
    }

    /// Tear down: remove worktree and delete the quest branch.
    pub async fn teardown(&self) -> Result<()> {
        if self.torn_down.swap(true, Ordering::Relaxed) {
            // Already torn down.
            return Ok(());
        }

        // Remove the worktree.
        let remove = Command::new("git")
            .args([
                "worktree",
                "remove",
                "--force",
                &self.worktree_path.to_string_lossy(),
            ])
            .current_dir(&self.repo_root)
            .output()
            .await;

        match remove {
            Ok(output) if !output.status.success() => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!(
                    quest_id = %self.quest_id,
                    stderr = %stderr,
                    "git worktree remove failed — attempting manual cleanup"
                );
                // Fallback: manual removal.
                let _ = tokio::fs::remove_dir_all(&self.worktree_path).await;
                // Prune stale worktree entries.
                let _ = Command::new("git")
                    .args(["worktree", "prune"])
                    .current_dir(&self.repo_root)
                    .output()
                    .await;
            }
            Err(e) => {
                warn!(
                    quest_id = %self.quest_id,
                    error = %e,
                    "git worktree remove command failed"
                );
                let _ = tokio::fs::remove_dir_all(&self.worktree_path).await;
            }
            Ok(_) => {}
        }

        // Delete the quest branch.
        let _ = Command::new("git")
            .args(["branch", "-D", &self.branch_name])
            .current_dir(&self.repo_root)
            .output()
            .await;

        info!(
            quest_id = %self.quest_id,
            "quest sandbox torn down"
        );

        Ok(())
    }

    /// Get the worktree status (git status --short).
    pub async fn worktree_status(&self) -> Result<String> {
        if self.torn_down.load(Ordering::Relaxed) {
            return Ok(String::new());
        }

        let output = Command::new("git")
            .args(["status", "--short"])
            .current_dir(&self.worktree_path)
            .output()
            .await
            .context("failed to run git status")?;

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Check if bwrap is available on this system.
    pub fn bwrap_available() -> bool {
        std::process::Command::new("bwrap")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// Parse insertions/deletions from `git diff --stat` summary line.
/// Example: " 3 files changed, 42 insertions(+), 10 deletions(-)"
fn parse_diff_stat(stat: &str) -> (u32, u32) {
    let mut insertions = 0u32;
    let mut deletions = 0u32;

    // Look at the last line (the summary).
    if let Some(summary) = stat.lines().last() {
        for part in summary.split(',') {
            let part = part.trim();
            if part.contains("insertion")
                && let Some(n) = part.split_whitespace().next()
            {
                insertions = n.parse().unwrap_or(0);
            } else if part.contains("deletion")
                && let Some(n) = part.split_whitespace().next()
            {
                deletions = n.parse().unwrap_or(0);
            }
        }
    }

    (insertions, deletions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_diff_stat() {
        assert_eq!(
            parse_diff_stat(" 3 files changed, 42 insertions(+), 10 deletions(-)"),
            (42, 10)
        );
        assert_eq!(parse_diff_stat(" 1 file changed, 5 insertions(+)"), (5, 0));
        assert_eq!(parse_diff_stat(" 1 file changed, 3 deletions(-)"), (0, 3));
        assert_eq!(parse_diff_stat(""), (0, 0));
    }

    #[test]
    fn test_sandbox_config_default() {
        let config = SandboxConfig::default();
        assert_eq!(config.base_ref, "HEAD");
        assert!(config.enable_bwrap);
        assert!(config.extra_ro_binds.is_empty());
    }

    #[tokio::test]
    async fn test_sandbox_lifecycle() {
        // Create a temporary git repo.
        let dir = tempfile::TempDir::new().unwrap();
        let repo = dir.path();

        let init = std::process::Command::new("git")
            .args(["init"])
            .current_dir(repo)
            .output();

        if init.is_err() || !init.unwrap().status.success() {
            return; // Git not available.
        }

        // Configure git user.
        let _ = std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(repo)
            .output();
        let _ = std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(repo)
            .output();

        // Initial commit.
        std::fs::write(repo.join("hello.txt"), "hello").unwrap();
        let _ = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(repo)
            .output();
        let _ = std::process::Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(repo)
            .output();

        let worktree_base = dir.path().join("worktrees");
        let config = SandboxConfig {
            repo_root: repo.to_path_buf(),
            worktree_base,
            base_ref: "HEAD".to_string(),
            enable_bwrap: false, // Don't require bwrap in tests.
            extra_ro_binds: Vec::new(),
        };

        // Create sandbox.
        let sandbox = QuestSandbox::create("test-session-001", &config)
            .await
            .unwrap();

        assert!(sandbox.worktree_path.exists());
        assert_eq!(sandbox.branch_name, "quest/test-session-001");

        // Make changes in the worktree.
        tokio::fs::write(sandbox.worktree_path.join("hello.txt"), "hello world")
            .await
            .unwrap();
        tokio::fs::write(sandbox.worktree_path.join("new_file.txt"), "new content")
            .await
            .unwrap();

        // Extract diff.
        let diff = sandbox.extract_diff().await.unwrap();
        assert!(!diff.files_changed.is_empty());
        assert!(diff.files_changed.contains(&"hello.txt".to_string()));
        assert!(diff.files_changed.contains(&"new_file.txt".to_string()));
        assert!(diff.insertions > 0);
        assert!(!diff.diff_text.is_empty());

        // Teardown.
        sandbox.teardown().await.unwrap();
        assert!(!sandbox.worktree_path.exists());

        // Second teardown is a no-op.
        sandbox.teardown().await.unwrap();
    }

    #[tokio::test]
    async fn test_sandbox_commit_and_finalize() {
        let dir = tempfile::TempDir::new().unwrap();
        let repo = dir.path();

        let init = std::process::Command::new("git")
            .args(["init"])
            .current_dir(repo)
            .output();

        if init.is_err() || !init.unwrap().status.success() {
            return;
        }

        let _ = std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(repo)
            .output();
        let _ = std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(repo)
            .output();

        std::fs::write(repo.join("file.txt"), "original").unwrap();
        let _ = std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(repo)
            .output();
        let _ = std::process::Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(repo)
            .output();

        let config = SandboxConfig {
            repo_root: repo.to_path_buf(),
            worktree_base: dir.path().join("worktrees"),
            base_ref: "HEAD".to_string(),
            enable_bwrap: false,
            extra_ro_binds: Vec::new(),
        };

        let sandbox = QuestSandbox::create("test-commit", &config).await.unwrap();

        // Make changes.
        tokio::fs::write(sandbox.worktree_path.join("file.txt"), "modified")
            .await
            .unwrap();

        // Commit.
        let hash = sandbox
            .commit_changes("test commit from sandbox", "test-agent")
            .await
            .unwrap();
        assert!(!hash.is_empty());

        // Teardown.
        sandbox.teardown().await.unwrap();
    }

    #[test]
    fn test_build_command_no_bwrap() {
        let sandbox = QuestSandbox {
            quest_id: "test".to_string(),
            worktree_path: PathBuf::from("/tmp/test-worktree"),
            branch_name: "quest/test".to_string(),
            repo_root: PathBuf::from("/tmp/repo"),
            enable_bwrap: false,
            extra_ro_binds: Vec::new(),
            torn_down: AtomicBool::new(false),
        };

        let cmd = sandbox.build_command("echo hello");
        // When bwrap is disabled, it's a plain bash command.
        let prog = cmd.as_std().get_program();
        assert_eq!(prog, "bash");
    }

    #[test]
    fn test_build_command_with_bwrap() {
        let sandbox = QuestSandbox {
            quest_id: "test".to_string(),
            worktree_path: PathBuf::from("/tmp/test-worktree"),
            branch_name: "quest/test".to_string(),
            repo_root: PathBuf::from("/tmp/repo"),
            enable_bwrap: true,
            extra_ro_binds: Vec::new(),
            torn_down: AtomicBool::new(false),
        };

        let cmd = sandbox.build_command("echo hello");
        let prog = cmd.as_std().get_program();
        assert_eq!(prog, "bwrap");

        // Verify key args are present.
        let args: Vec<_> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"--unshare-net".to_string()));
        assert!(args.contains(&"--unshare-pid".to_string()));
        assert!(args.contains(&"--die-with-parent".to_string()));
        assert!(args.contains(&"/workspace".to_string()));
        assert!(args.contains(&"echo hello".to_string()));
    }
}
