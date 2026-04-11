//! Git checkpoint manager — transparent filesystem snapshots for rollback.
//!
//! Uses a separate GIT_DIR (outside the user's repo) with GIT_WORK_TREE pointing
//! to the project directory. No git state leaks into the user's project.
//!
//! Inspired by Hermes Agent's checkpoint_manager.py.

use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{debug, warn};

const DEFAULT_MAX_CHECKPOINTS: usize = 50;

/// Manages shadow git checkpoints for a single working directory.
pub struct CheckpointManager {
    work_dir: PathBuf,
    git_dir: PathBuf,
    initialized: bool,
    checkpoint_count: usize,
    max_checkpoints: usize,
    taken_this_turn: bool,
}

impl CheckpointManager {
    pub fn new(work_dir: PathBuf) -> Self {
        let hash = Self::dir_hash(&work_dir);
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let git_dir = PathBuf::from(home)
            .join(".aeqi")
            .join("checkpoints")
            .join(hash);

        Self {
            work_dir,
            git_dir,
            initialized: false,
            checkpoint_count: 0,
            max_checkpoints: DEFAULT_MAX_CHECKPOINTS,
            taken_this_turn: false,
        }
    }

    pub fn with_max_checkpoints(mut self, max: usize) -> Self {
        self.max_checkpoints = max;
        self
    }

    /// Signal a new step — resets the per-step dedup flag.
    pub fn new_turn(&mut self) {
        self.taken_this_turn = false;
    }

    /// Take a checkpoint. Deduplicates within a step.
    /// Returns Ok(true) if a checkpoint was actually taken.
    pub fn checkpoint(&mut self, label: &str) -> Result<bool, String> {
        if self.taken_this_turn {
            return Ok(false);
        }
        if !self.initialized {
            self.init_shadow_repo()?;
        }

        self.git(&["add", "-A"])?;

        let status = self.git(&["status", "--porcelain"])?;
        if status.trim().is_empty() {
            return Ok(false);
        }

        let msg = format!("[checkpoint {}] {}", self.checkpoint_count + 1, label);
        self.git(&["commit", "-m", &msg, "--allow-empty"])?;

        self.checkpoint_count += 1;
        self.taken_this_turn = true;

        debug!(
            work_dir = %self.work_dir.display(),
            count = self.checkpoint_count,
            label,
            "checkpoint taken"
        );

        if self.checkpoint_count > self.max_checkpoints {
            self.prune_oldest();
        }

        Ok(true)
    }

    /// Rollback to Nth most recent checkpoint (1 = last).
    pub fn rollback(&self, steps_back: usize) -> Result<(), String> {
        if !self.initialized {
            return Err("No checkpoints taken yet.".to_string());
        }
        if steps_back == 0 || steps_back > self.checkpoint_count {
            return Err(format!(
                "Invalid rollback: {} steps, {} checkpoints exist.",
                steps_back, self.checkpoint_count
            ));
        }

        let ref_spec = format!("HEAD~{}", steps_back);
        self.git(&["checkout", &ref_spec, "--", "."])?;

        debug!(work_dir = %self.work_dir.display(), steps_back, "rolled back");
        Ok(())
    }

    /// List recent checkpoints (most recent first).
    pub fn list(&self, max: usize) -> Result<Vec<String>, String> {
        if !self.initialized {
            return Ok(Vec::new());
        }
        let output = self.git(&["log", "--oneline", &format!("-{max}"), "--format=%h %s"])?;
        Ok(output.lines().map(|l| l.to_string()).collect())
    }

    /// Clean up the shadow git directory.
    pub fn cleanup(&self) -> Result<(), String> {
        if self.git_dir.exists() {
            std::fs::remove_dir_all(&self.git_dir).map_err(|e| format!("cleanup failed: {e}"))?;
            debug!(git_dir = %self.git_dir.display(), "shadow repo cleaned up");
        }
        Ok(())
    }

    pub fn count(&self) -> usize {
        self.checkpoint_count
    }

    // --- Internal ---

    fn init_shadow_repo(&mut self) -> Result<(), String> {
        std::fs::create_dir_all(&self.git_dir)
            .map_err(|e| format!("failed to create shadow git dir: {e}"))?;

        self.git(&["init"])?;
        self.git(&["config", "user.email", "aeqi@checkpoint"])?;
        self.git(&["config", "user.name", "AEQI Checkpoint"])?;

        let excludes_dir = self.git_dir.join("info");
        std::fs::create_dir_all(&excludes_dir)
            .map_err(|e| format!("failed to create excludes dir: {e}"))?;

        let excludes = [
            "node_modules/",
            "target/",
            ".git/",
            "__pycache__/",
            "*.pyc",
            ".env",
            ".env.*",
            "venv/",
            ".venv/",
            "dist/",
            "build/",
            ".next/",
            ".cache/",
        ];
        std::fs::write(excludes_dir.join("exclude"), excludes.join("\n"))
            .map_err(|e| format!("failed to write excludes: {e}"))?;

        self.initialized = true;
        debug!(
            work_dir = %self.work_dir.display(),
            git_dir = %self.git_dir.display(),
            "shadow repo initialized"
        );
        Ok(())
    }

    fn git(&self, args: &[&str]) -> Result<String, String> {
        let output = Command::new("git")
            .env("GIT_DIR", &self.git_dir)
            .env("GIT_WORK_TREE", &self.work_dir)
            .args(args)
            .output()
            .map_err(|e| format!("git command failed: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("nothing to commit") || stderr.contains("nothing added") {
                return Ok(String::new());
            }
            return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    fn prune_oldest(&self) {
        warn!(
            work_dir = %self.work_dir.display(),
            count = self.checkpoint_count,
            max = self.max_checkpoints,
            "checkpoint limit reached"
        );
    }

    fn dir_hash(path: &Path) -> String {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        path.to_string_lossy().hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_checkpoint_and_rollback() {
        let dir = TempDir::new().unwrap();
        let work = dir.path().to_path_buf();
        let mut mgr = CheckpointManager::new(work.clone());

        std::fs::write(work.join("test.txt"), "version 1").unwrap();
        assert!(mgr.checkpoint("initial").unwrap());
        assert_eq!(mgr.count(), 1);

        mgr.new_turn();
        std::fs::write(work.join("test.txt"), "version 2").unwrap();
        assert!(mgr.checkpoint("update").unwrap());
        assert_eq!(mgr.count(), 2);

        mgr.rollback(1).unwrap();
        let content = std::fs::read_to_string(work.join("test.txt")).unwrap();
        assert_eq!(content, "version 1");

        mgr.cleanup().unwrap();
    }

    #[test]
    fn test_dedup_within_turn() {
        let dir = TempDir::new().unwrap();
        let work = dir.path().to_path_buf();
        let mut mgr = CheckpointManager::new(work.clone());

        std::fs::write(work.join("a.txt"), "hello").unwrap();
        assert!(mgr.checkpoint("first").unwrap());

        std::fs::write(work.join("b.txt"), "world").unwrap();
        assert!(!mgr.checkpoint("second").unwrap());
        assert_eq!(mgr.count(), 1);

        mgr.new_turn();
        assert!(mgr.checkpoint("after step").unwrap());
        assert_eq!(mgr.count(), 2);

        mgr.cleanup().unwrap();
    }

    #[test]
    fn test_no_changes_no_checkpoint() {
        let dir = TempDir::new().unwrap();
        let mut mgr = CheckpointManager::new(dir.path().to_path_buf());
        assert!(!mgr.checkpoint("empty").unwrap());
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn test_list_checkpoints() {
        let dir = TempDir::new().unwrap();
        let work = dir.path().to_path_buf();
        let mut mgr = CheckpointManager::new(work.clone());

        std::fs::write(work.join("a.txt"), "v1").unwrap();
        mgr.checkpoint("first").unwrap();
        mgr.new_turn();
        std::fs::write(work.join("a.txt"), "v2").unwrap();
        mgr.checkpoint("second").unwrap();

        let list = mgr.list(5).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].contains("second"));
        assert!(list[1].contains("first"));

        mgr.cleanup().unwrap();
    }

    #[test]
    fn test_dir_hash_stable() {
        let h1 = CheckpointManager::dir_hash(Path::new("/home/user/project"));
        let h2 = CheckpointManager::dir_hash(Path::new("/home/user/project"));
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 16);
    }
}
