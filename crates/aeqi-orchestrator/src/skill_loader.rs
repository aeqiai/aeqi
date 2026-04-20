//! Unified skill discovery — single source of truth for loading skill `.md`
//! files from disk (`projects/*/skills`, `projects/*/agents`). These are
//! operator-edited files layered on top of the idea store.
//!
//! Replaces three independent disk-scan paths (session_manager, ipc/status,
//! vfs) with one configurable, cached loader.

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::debug;

/// A discovered skill file on disk (for IPC/status listing).
#[derive(Debug, Clone, serde::Serialize)]
pub struct SkillFileEntry {
    pub name: String,
    pub source: String,
    pub kind: &'static str,
    pub path: PathBuf,
    pub content: String,
}

/// Where to look for skill `.md` files.
#[derive(Debug, Clone)]
pub struct SkillLoaderConfig {
    /// Base directory containing `projects/` subtree.
    /// Skills are discovered at `{base}/projects/shared/skills`,
    /// `{base}/projects/shared/agents`, and per-project dirs.
    pub base_dir: PathBuf,
}

/// Cached skill file loader. Thread-safe, async-friendly.
pub struct SkillLoader {
    config: SkillLoaderConfig,
    /// Cached skill definitions parsed from disk. Populated on first access.
    skills: RwLock<Option<Arc<Vec<aeqi_tools::Prompt>>>>,
    /// Cached entries (for IPC responses). Populated on first access.
    entries: RwLock<Option<Arc<Vec<SkillFileEntry>>>>,
}

impl SkillLoader {
    pub fn new(config: SkillLoaderConfig) -> Self {
        Self {
            config,
            skills: RwLock::new(None),
            entries: RwLock::new(None),
        }
    }

    /// Derive config from the daemon's current working directory.
    pub fn from_cwd() -> Self {
        let base_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self::new(SkillLoaderConfig { base_dir })
    }

    /// Directories to scan for skill `.md` files.
    fn scan_dirs(&self) -> Vec<(PathBuf, String)> {
        let base = &self.config.base_dir;
        let mut dirs: Vec<(PathBuf, String)> = vec![
            (
                base.join("projects").join("shared").join("skills"),
                "shared".into(),
            ),
            (
                base.join("projects").join("shared").join("agents"),
                "shared/agents".into(),
            ),
        ];

        // Per-project: scan all project dirs.
        let projects_dir = base.join("projects");
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let project = entry.file_name().to_string_lossy().to_string();
                if project == "shared" {
                    continue;
                }
                dirs.push((entry.path().join("skills"), project.clone()));
                dirs.push((entry.path().join("agents"), format!("{project}/agents")));
            }
        }

        dirs
    }

    /// Load all skill definitions from configured directories.
    /// Results are cached; call `invalidate()` to force re-scan.
    pub async fn all(&self) -> Arc<Vec<aeqi_tools::Prompt>> {
        // Fast path: return cached.
        {
            let guard = self.skills.read().await;
            if let Some(ref cached) = *guard {
                return cached.clone();
            }
        }

        // Slow path: scan disk and cache.
        let mut all = Vec::new();
        for (dir, _source) in self.scan_dirs() {
            if let Ok(found) = aeqi_tools::Prompt::discover(&dir) {
                all.extend(found);
            }
        }
        all.sort_by(|a, b| a.name.cmp(&b.name));
        // Deduplicate by name (first occurrence wins — shared before project).
        all.dedup_by(|b, a| a.name == b.name);

        let arc = Arc::new(all);
        *self.skills.write().await = Some(arc.clone());
        arc
    }

    /// Load all skill file entries (for IPC status/skills responses).
    /// Results are cached; call `invalidate()` to force re-scan.
    pub async fn entries(&self) -> Arc<Vec<SkillFileEntry>> {
        // Fast path.
        {
            let guard = self.entries.read().await;
            if let Some(ref cached) = *guard {
                return cached.clone();
            }
        }

        // Slow path.
        let mut all = Vec::new();
        for (dir, source) in self.scan_dirs() {
            if !dir.exists() {
                continue;
            }
            let entries = std::fs::read_dir(&dir);
            for entry in entries.into_iter().flatten().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                all.push(SkillFileEntry {
                    name,
                    source: source.clone(),
                    kind: "skill",
                    path: path.clone(),
                    content,
                });
            }
        }

        let arc = Arc::new(all);
        *self.entries.write().await = Some(arc.clone());
        arc
    }

    /// Resolve a single skill by name. Returns None if not found.
    pub async fn find(&self, name: &str) -> Option<aeqi_tools::Prompt> {
        let skills = self.all().await;
        skills.iter().find(|p| p.name == name).cloned()
    }

    /// Invalidate cached data. Next access re-scans disk.
    pub async fn invalidate(&self) {
        *self.skills.write().await = None;
        *self.entries.write().await = None;
        debug!("skill_loader: cache invalidated");
    }

    /// Filter entries by allowed project names (for tenancy).
    pub async fn entries_filtered(&self, allowed: &Option<Vec<String>>) -> Vec<SkillFileEntry> {
        let entries = self.entries().await;
        if allowed.is_none() {
            return entries.as_ref().clone();
        }

        entries
            .iter()
            .filter(|s| {
                let source = &s.source;
                source == "shared"
                    || source == "shared/agents"
                    || allowed
                        .as_ref()
                        .map(|list| {
                            list.iter().any(|a| {
                                source == a
                                    || source.split('/').next().is_some_and(|prefix| prefix == a)
                            })
                        })
                        .unwrap_or(false)
            })
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn discover_from_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let loader = SkillLoader::new(SkillLoaderConfig {
            base_dir: tmp.path().to_path_buf(),
        });
        let prompts = loader.all().await;
        assert!(prompts.is_empty());
    }

    #[tokio::test]
    async fn discover_shared_prompts() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("projects/shared/skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        std::fs::write(
            skills_dir.join("deploy.md"),
            "---\nname: deploy\ndescription: Deploy\n---\n\nDeploy it",
        )
        .unwrap();

        let loader = SkillLoader::new(SkillLoaderConfig {
            base_dir: tmp.path().to_path_buf(),
        });
        let prompts = loader.all().await;
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].name, "deploy");
    }

    #[tokio::test]
    async fn cache_invalidation() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("projects/shared/skills");
        std::fs::create_dir_all(&skills_dir).unwrap();

        let loader = SkillLoader::new(SkillLoaderConfig {
            base_dir: tmp.path().to_path_buf(),
        });

        // First load — empty.
        let prompts = loader.all().await;
        assert!(prompts.is_empty());

        // Add a prompt file.
        std::fs::write(
            skills_dir.join("test.md"),
            "---\nname: test\ndescription: Test\n---\n\nTest",
        )
        .unwrap();

        // Still cached.
        let prompts = loader.all().await;
        assert!(prompts.is_empty());

        // Invalidate and re-load.
        loader.invalidate().await;
        let prompts = loader.all().await;
        assert_eq!(prompts.len(), 1);
    }

    #[tokio::test]
    async fn find_prompt_by_name() {
        let tmp = TempDir::new().unwrap();
        let skills_dir = tmp.path().join("projects/shared/skills");
        std::fs::create_dir_all(&skills_dir).unwrap();
        std::fs::write(
            skills_dir.join("alpha.md"),
            "---\nname: alpha\ndescription: Alpha\n---\n\nAlpha body",
        )
        .unwrap();
        std::fs::write(
            skills_dir.join("beta.md"),
            "---\nname: beta\ndescription: Beta\n---\n\nBeta body",
        )
        .unwrap();

        let loader = SkillLoader::new(SkillLoaderConfig {
            base_dir: tmp.path().to_path_buf(),
        });

        assert!(loader.find("alpha").await.is_some());
        assert!(loader.find("beta").await.is_some());
        assert!(loader.find("gamma").await.is_none());
    }
}
