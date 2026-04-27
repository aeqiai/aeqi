use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tracing::debug;

use crate::quest::{Quest, QuestId, QuestOutcomeKind, QuestOutcomeRecord, QuestStatus};

/// Valid transitions for the five-status quest state machine
/// (Backlog → Todo → InProgress → Done | Cancelled). Backlog is the
/// "parked / not yet committed" tier; Todo is "ready to work on".
/// Anything can be cancelled; in-progress can re-queue back to Todo
/// on worker failure.
fn valid_transition(from: &QuestStatus, to: &QuestStatus) -> bool {
    use QuestStatus::*;
    matches!(
        (from, to),
        // Forward flow
        (Backlog, Todo)
            | (Todo, InProgress)
            | (InProgress, Done)
            | (InProgress, Cancelled)
            // Retry / re-queue from worker failure
            | (InProgress, Todo)
            | (InProgress, Backlog)
            // Park: pull a Todo back to the backlog
            | (Todo, Backlog)
            // Cancellation from any non-terminal state
            | (Backlog, Cancelled)
            | (Todo, Cancelled)
            // Same-state (no-op)
            | (Backlog, Backlog)
            | (Todo, Todo)
            | (InProgress, InProgress)
    )
}

/// JSONL-based quest store. One file per prefix, git-native.
pub struct QuestBoard {
    dir: PathBuf,
    /// In-memory index: all quests keyed by ID.
    quests: HashMap<String, Quest>,
    /// Next sequence number per prefix.
    sequences: HashMap<String, u32>,
}

impl QuestBoard {
    /// Open or create a quest store in the given directory.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("failed to create quests dir: {}", dir.display()))?;

        let mut store = Self {
            dir: dir.to_path_buf(),
            quests: HashMap::new(),
            sequences: HashMap::new(),
        };

        store.load_all()?;
        Ok(store)
    }

    /// Load all JSONL files from the store directory.
    fn load_all(&mut self) -> Result<()> {
        let entries = std::fs::read_dir(&self.dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "jsonl") {
                self.load_file(&path)?;
            }
        }
        Ok(())
    }

    /// Load quests from a single JSONL file.
    fn load_file(&mut self, path: &Path) -> Result<()> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read {}", path.display()))?;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            match serde_json::from_str::<Quest>(line) {
                Ok(quest) => {
                    // Track max sequence for this prefix.
                    let prefix = quest.id.prefix().to_string();
                    if quest.id.depth() == 0
                        && let Some(seq_str) = quest.id.0.split('-').nth(1)
                    {
                        // Handle dotted children: take only the root part.
                        let root_seq = seq_str.split('.').next().unwrap_or(seq_str);
                        if let Ok(seq) = root_seq.parse::<u32>() {
                            let entry = self.sequences.entry(prefix).or_insert(0);
                            *entry = (*entry).max(seq);
                        }
                    }
                    self.quests.insert(quest.id.0.clone(), quest);
                }
                Err(e) => {
                    debug!(path = %path.display(), error = %e, "skipping malformed quest line");
                }
            }
        }

        Ok(())
    }

    /// Persist a quest to its prefix JSONL file (append).
    fn persist(&self, quest: &Quest) -> Result<()> {
        let prefix = quest.id.prefix();
        let path = self.dir.join(format!("{prefix}.jsonl"));

        let line = serde_json::to_string(quest)? + "\n";

        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("failed to open {}", path.display()))?;
        file.write_all(line.as_bytes())?;

        Ok(())
    }

    /// Rewrite the entire JSONL file for a prefix (after updates).
    fn rewrite_prefix(&self, prefix: &str) -> Result<()> {
        let path = self.dir.join(format!("{prefix}.jsonl"));

        let mut quests: Vec<&Quest> = self
            .quests
            .values()
            .filter(|b| b.id.prefix() == prefix)
            .collect();
        quests.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        let mut content = String::new();
        for quest in quests {
            content.push_str(&serde_json::to_string(quest)?);
            content.push('\n');
        }

        std::fs::write(&path, &content)
            .with_context(|| format!("failed to write {}", path.display()))?;

        Ok(())
    }

    /// Create a new quest with auto-generated ID and optional agent binding.
    pub fn create_with_agent(
        &mut self,
        prefix: &str,
        name: &str,
        agent_id: Option<&str>,
    ) -> Result<Quest> {
        let seq = self.sequences.entry(prefix.to_string()).or_insert(0);
        *seq += 1;
        let id = QuestId::root(prefix, *seq);

        let quest = Quest::with_agent(id, name, agent_id);
        self.persist(&quest)?;
        self.quests.insert(quest.id.0.clone(), quest.clone());

        Ok(quest)
    }

    /// Create a child quest under a parent. Inherits the parent's `agent_id`.
    pub fn create_child(&mut self, parent_id: &QuestId, name: &str) -> Result<Quest> {
        let parent_agent_id = self
            .quests
            .get(&parent_id.0)
            .and_then(|p| p.agent_id.clone());

        // Count existing children to determine next child seq.
        let child_count = self
            .quests
            .values()
            .filter(|b| b.id.parent().as_ref() == Some(parent_id))
            .count() as u32;

        let id = parent_id.child(child_count + 1);
        let mut quest = Quest::new(id, name);
        // Inherit agent_id from parent.
        quest.agent_id = parent_agent_id;
        quest.depends_on = Vec::new();

        self.persist(&quest)?;
        self.quests.insert(quest.id.0.clone(), quest.clone());

        Ok(quest)
    }

    /// Get a quest by ID.
    pub fn get(&self, id: &str) -> Option<&Quest> {
        self.quests.get(id)
    }

    /// Update a quest. Returns the updated quest.
    ///
    /// Uses append-only persistence: the updated quest is appended to the JSONL
    /// file rather than rewriting all quests for the prefix. On reload, later
    /// entries overwrite earlier ones (last-write-wins dedup in load_file).
    pub fn update(&mut self, id: &str, f: impl FnOnce(&mut Quest)) -> Result<Quest> {
        let quest = self
            .quests
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("quest not found: {id}"))?;

        f(quest);
        quest.updated_at = Some(chrono::Utc::now());

        let quest = quest.clone();
        self.persist(&quest)?;

        Ok(quest)
    }

    /// Update a quest with state transition validation.
    ///
    /// Like `update()`, but logs a warning if the status change is not a valid
    /// transition in the quest state machine. Does NOT block the update — callers
    /// can migrate from `update()` over time.
    pub fn validated_update(&mut self, id: &str, f: impl FnOnce(&mut Quest)) -> Result<Quest> {
        let old_status = self
            .quests
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("quest not found: {id}"))?
            .status;

        let quest = self.update(id, f)?;

        if !valid_transition(&old_status, &quest.status) {
            tracing::warn!(
                quest = %id,
                from = ?old_status,
                to = ?quest.status,
                "invalid quest state transition (allowed for backwards compat)"
            );
        }

        Ok(quest)
    }

    /// Atomically claim a quest for execution.
    pub fn checkout(&mut self, id: &str, _worker_id: &str) -> Result<Quest> {
        let quest = self
            .quests
            .get(id)
            .ok_or_else(|| anyhow::anyhow!("quest not found: {id}"))?;

        if quest.status != QuestStatus::Todo {
            anyhow::bail!(
                "quest {} is not Todo (status: {:?}) — only Todo quests can be checked out",
                id,
                quest.status
            );
        }

        // Concurrency is now handled by the scheduler via status transitions.
        self.update(id, |t| {
            t.status = QuestStatus::InProgress;
        })
    }

    /// Release a quest (on completion or failure) — now a no-op kept for API compat.
    pub fn release(&mut self, _id: &str) -> Result<Quest> {
        // Lock fields removed; scheduler handles concurrency via status.
        // Kept as a no-op for callers that haven't been updated yet.
        anyhow::bail!("release() is deprecated — use status transitions directly")
    }

    /// Close a quest (mark as done with reason).
    /// Automatically cascades: if all sibling children of a parent are now closed,
    /// the parent is auto-closed too (pipeline auto-progression).
    pub fn close(&mut self, id: &str, reason: &str) -> Result<Quest> {
        let quest = self.update(id, |b| {
            b.status = QuestStatus::Done;
            b.closed_at = Some(chrono::Utc::now());
            b.set_quest_outcome(&QuestOutcomeRecord::new(QuestOutcomeKind::Done, reason));
        })?;

        self.cascade_parent_close(&quest.id);

        Ok(quest)
    }

    fn cascade_parent_close(&mut self, child_id: &QuestId) {
        let Some(parent_id) = child_id.parent() else {
            return;
        };
        let Some(parent) = self.quests.get(&parent_id.0) else {
            return;
        };
        if parent.is_closed() {
            return;
        }

        let children: Vec<String> = self
            .quests
            .values()
            .filter(|b| b.id.parent().as_ref() == Some(&parent_id))
            .map(|b| b.id.0.clone())
            .collect();

        if children.is_empty() {
            return;
        }

        let all_closed = children
            .iter()
            .all(|cid| self.quests.get(cid).is_some_and(|b| b.is_closed()));

        if all_closed {
            // Step 6: Smart cascade close — check if parent was actively worked on.
            let parent_has_checkpoints = self
                .quests
                .get(&parent_id.0)
                .is_some_and(|p| !p.checkpoints.is_empty());

            if parent_has_checkpoints {
                // Parent was actively worked on — re-queue for synthesis, do NOT auto-close.
                if let Err(e) = self.update(&parent_id.0, |b| {
                    b.status = QuestStatus::Todo;
                }) {
                    debug!(parent = %parent_id, error = %e, "failed to re-queue parent for synthesis");
                    return;
                }
                debug!(parent = %parent_id, children = children.len(), "parent has checkpoints — re-queued for synthesis instead of auto-close");
                // Do NOT recurse — parent is not closed.
                return;
            }

            // Parent is a pure container (no checkpoints) — auto-close as before.
            // Check if ALL children were cancelled — parent should be Cancelled, not Done.
            let all_cancelled = children.iter().all(|cid| {
                self.quests
                    .get(cid)
                    .is_some_and(|b| b.status == QuestStatus::Cancelled)
            });

            let (outcome_status, outcome_kind, verb) = if all_cancelled {
                (
                    QuestStatus::Cancelled,
                    QuestOutcomeKind::Cancelled,
                    "cancelled",
                )
            } else {
                (QuestStatus::Done, QuestOutcomeKind::Done, "completed")
            };

            let child_summaries: Vec<String> = children
                .iter()
                .filter_map(|cid| {
                    self.quests.get(cid).map(|b| {
                        let summary = b.outcome_summary().unwrap_or_else(|| verb.to_string());
                        let title = if b.title().is_empty() {
                            b.id.0.as_str()
                        } else {
                            b.title()
                        };
                        format!("  {title} — {summary}")
                    })
                })
                .collect();

            let reason = format!(
                "All {} steps {}:\n{}",
                children.len(),
                verb,
                child_summaries.join("\n")
            );

            if let Err(e) = self.update(&parent_id.0, |b| {
                b.status = outcome_status;
                b.closed_at = Some(chrono::Utc::now());
                b.set_quest_outcome(&QuestOutcomeRecord::new(outcome_kind, reason.clone()));
            }) {
                debug!(parent = %parent_id, error = %e, "failed to auto-close parent quest");
                return;
            }

            debug!(parent = %parent_id, children = children.len(), status = ?outcome_status, "auto-closed parent (all children closed)");

            self.cascade_parent_close(&parent_id);
        }
    }

    /// Cancel a quest.
    pub fn cancel(&mut self, id: &str, reason: &str) -> Result<Quest> {
        self.update(id, |b| {
            b.status = QuestStatus::Cancelled;
            b.closed_at = Some(chrono::Utc::now());
            b.set_quest_outcome(&QuestOutcomeRecord::new(
                QuestOutcomeKind::Cancelled,
                reason,
            ));
        })
    }

    /// Detect if adding `from` depends-on `to` would create a cycle.
    /// Check if adding "`id` depends on `dep_id`" would create a cycle.
    /// Follows depends_on edges from dep_id; if we reach id, it's a cycle.
    fn would_cycle(&self, id: &str, dep_id: &str) -> bool {
        let mut visited = std::collections::HashSet::new();
        let mut stack = vec![dep_id.to_string()];
        while let Some(node) = stack.pop() {
            if node == id {
                return true;
            }
            if visited.insert(node.clone())
                && let Some(quest_entry) = self.quests.get(&node)
            {
                for dep in &quest_entry.depends_on {
                    stack.push(dep.0.clone());
                }
            }
        }
        false
    }

    /// Add a dependency: `id` depends on `dep_id`.
    pub fn add_dependency(&mut self, id: &str, dep_id: &str) -> Result<()> {
        if id == dep_id {
            anyhow::bail!("quest cannot depend on itself: {id}");
        }
        if self.would_cycle(id, dep_id) {
            anyhow::bail!("circular dependency detected: {id} → {dep_id} would create a cycle");
        }

        let dep_quest_id = QuestId::from(dep_id);

        self.update(id, |b| {
            if !b.depends_on.contains(&dep_quest_id) {
                b.depends_on.push(dep_quest_id.clone());
            }
        })?;

        Ok(())
    }

    /// Get all quests that are ready (pending + all deps resolved).
    pub fn ready(&self) -> Vec<&Quest> {
        let resolved =
            |id: &QuestId| -> bool { self.quests.get(&id.0).is_some_and(|b| b.is_closed()) };

        let mut ready: Vec<&Quest> = self
            .quests
            .values()
            .filter(|b| b.is_ready(&resolved) && !b.is_scheduler_held())
            .collect();

        // Sort by priority (highest first), then by creation time.
        ready.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| a.created_at.cmp(&b.created_at))
        });

        ready
    }

    /// Get all quests matching a prefix.
    pub fn by_prefix(&self, prefix: &str) -> Vec<&Quest> {
        let mut quests: Vec<&Quest> = self
            .quests
            .values()
            .filter(|b| b.id.prefix() == prefix)
            .collect();
        quests.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        quests
    }

    /// Get all quests.
    pub fn all(&self) -> Vec<&Quest> {
        let mut quests: Vec<&Quest> = self.quests.values().collect();
        quests.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        quests
    }

    /// Get all quests bound to a specific agent.
    pub fn by_agent(&self, agent_id: &str) -> Vec<&Quest> {
        self.quests
            .values()
            .filter(|b| b.agent_id.as_deref() == Some(agent_id) && !b.is_closed())
            .collect()
    }

    /// Get children of a quest.
    pub fn children(&self, parent_id: &QuestId) -> Vec<&Quest> {
        self.quests
            .values()
            .filter(|b| b.id.parent().as_ref() == Some(parent_id))
            .collect()
    }

    /// Count open quests by prefix.
    pub fn open_count_by_prefix(&self) -> HashMap<String, usize> {
        let mut counts = HashMap::new();
        for quest in self.quests.values() {
            if !quest.is_closed() {
                *counts.entry(quest.id.prefix().to_string()).or_insert(0) += 1;
            }
        }
        counts
    }

    /// Reload all quests from disk, picking up externally-created quests.
    /// Compacts all prefix files after reload to remove duplicate entries.
    pub fn reload(&mut self) -> Result<()> {
        self.quests.clear();
        self.sequences.clear();
        self.load_all()?;
        self.compact_all()
    }

    /// Rewrite all prefix files to contain only the latest version of each quest.
    /// This deduplicates append-only entries accumulated during updates.
    fn compact_all(&self) -> Result<()> {
        let mut prefixes: std::collections::HashSet<String> = std::collections::HashSet::new();
        for quest in self.quests.values() {
            prefixes.insert(quest.id.prefix().to_string());
        }
        for prefix in prefixes {
            self.rewrite_prefix(&prefix)?;
        }
        Ok(())
    }

    // ── Dependency Inference ─────────────────────────────────────

    /// Suggest dependencies between open quests based on entity overlap.
    pub fn suggest_dependencies(
        &self,
        threshold: f64,
    ) -> Vec<crate::dependency_inference::InferredDependency> {
        let open_quests: Vec<&Quest> = self.quests.values().filter(|t| !t.is_closed()).collect();
        crate::dependency_inference::infer_dependencies(&open_quests, threshold)
    }

    /// Apply inferred dependencies above the given confidence threshold.
    /// Skips any that would create cycles. Returns count of applied dependencies.
    pub fn apply_inferred_dependencies(&mut self, threshold: f64) -> Result<usize> {
        let deps = self.suggest_dependencies(threshold);
        let mut applied = 0;
        for dep in deps {
            if !self.would_cycle(&dep.from.0, &dep.to.0)
                && self.add_dependency(&dep.from.0, &dep.to.0).is_ok()
            {
                applied += 1;
            }
        }
        Ok(applied)
    }

    // ── General ────────────────────────────────────────────────────

    /// Store directory path.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Total quest count.
    pub fn len(&self) -> usize {
        self.quests.len()
    }

    pub fn is_empty(&self) -> bool {
        self.quests.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn temp_store() -> (QuestBoard, TempDir) {
        let dir = TempDir::new().unwrap();
        let store = QuestBoard::open(dir.path()).unwrap();
        (store, dir)
    }

    #[test]
    fn test_create_and_get() {
        let (mut store, _dir) = temp_store();
        let quest = store
            .create_with_agent("as", "Fix login bug", None)
            .unwrap();
        assert_eq!(quest.id.0, "as-001");

        let quest2 = store
            .create_with_agent("as", "Add logout button", None)
            .unwrap();
        assert_eq!(quest2.id.0, "as-002");

        assert!(store.get("as-001").is_some());
        assert!(store.get("as-002").is_some());
        assert!(store.get("as-003").is_none());
    }

    #[test]
    fn test_children() {
        let (mut store, _dir) = temp_store();
        let parent = store.create_with_agent("as", "Feature X", None).unwrap();
        let child1 = store.create_child(&parent.id, "Step 1").unwrap();
        let child2 = store.create_child(&parent.id, "Step 2").unwrap();

        assert_eq!(child1.id.0, "as-001.1");
        assert_eq!(child2.id.0, "as-001.2");
        assert_eq!(child1.id.parent().unwrap(), parent.id);
    }

    #[test]
    fn test_dependencies_and_ready() {
        let (mut store, _dir) = temp_store();
        let b1 = store.create_with_agent("as", "Quest 1", None).unwrap();
        let b2 = store.create_with_agent("as", "Quest 2", None).unwrap();

        store.add_dependency(&b2.id.0, &b1.id.0).unwrap();

        // b1 is ready, b2 is blocked.
        let ready = store.ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, b1.id);

        // Close b1 → b2 becomes ready.
        store.close(&b1.id.0, "completed").unwrap();
        let ready = store.ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, b2.id);
    }

    #[test]
    fn test_scheduler_hold_excludes_quest_from_ready() {
        let (mut store, _dir) = temp_store();
        let held = store.create_with_agent("as", "Held quest", None).unwrap();
        let free = store.create_with_agent("as", "Free quest", None).unwrap();

        store
            .update(&held.id.0, |b| {
                b.metadata = serde_json::json!({
                    "aeqi": {
                        "hold": true,
                        "hold_reason": "awaiting_council"
                    }
                });
            })
            .unwrap();

        let ready = store.ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].id, free.id);
        assert!(store.get(&held.id.0).unwrap().is_scheduler_held());
    }

    #[test]
    fn test_persistence() {
        let dir = TempDir::new().unwrap();

        {
            let mut store = QuestBoard::open(dir.path()).unwrap();
            store.create_with_agent("rd", "Price check", None).unwrap();
            store
                .create_with_agent("rd", "Inventory update", None)
                .unwrap();
        }

        // Reopen and verify data persisted.
        let store = QuestBoard::open(dir.path()).unwrap();
        assert_eq!(store.len(), 2);
        assert!(store.get("rd-001").is_some());
        assert!(store.get("rd-002").is_some());
    }

    #[test]
    fn test_self_dependency_rejected() {
        let (mut store, _dir) = temp_store();
        let b1 = store.create_with_agent("as", "Quest 1", None).unwrap();
        assert!(store.add_dependency(&b1.id.0, &b1.id.0).is_err());
    }

    #[test]
    fn test_circular_dependency_rejected() {
        let (mut store, _dir) = temp_store();
        let b1 = store.create_with_agent("as", "Quest A", None).unwrap();
        let b2 = store.create_with_agent("as", "Quest B", None).unwrap();
        let b3 = store.create_with_agent("as", "Quest C", None).unwrap();

        store.add_dependency(&b2.id.0, &b1.id.0).unwrap();
        store.add_dependency(&b3.id.0, &b2.id.0).unwrap();
        // b3 → b2 → b1. Adding b1 → b3 would create a cycle.
        assert!(store.add_dependency(&b1.id.0, &b3.id.0).is_err());
    }

    #[test]
    fn test_append_only_update_persists() {
        let dir = TempDir::new().unwrap();

        {
            let mut store = QuestBoard::open(dir.path()).unwrap();
            store.create_with_agent("as", "Quest 1", None).unwrap();
            store
                .update("as-001", |b| {
                    b.status = QuestStatus::InProgress;
                })
                .unwrap();
        }

        // Reopen — load_file deduplicates by last-write-wins.
        let store = QuestBoard::open(dir.path()).unwrap();
        assert_eq!(store.len(), 1);
        let quest = store.get("as-001").unwrap();
        assert_eq!(quest.status, QuestStatus::InProgress);
    }

    #[test]
    fn test_reload_compacts() {
        let dir = TempDir::new().unwrap();

        let mut store = QuestBoard::open(dir.path()).unwrap();
        store.create_with_agent("as", "Quest 1", None).unwrap();
        // Multiple updates = multiple append lines. Bump retry_count instead
        // of an editorial field — the canonical model has no quest.name.
        for _ in 0..5 {
            store
                .update("as-001", |b| {
                    b.retry_count += 1;
                })
                .unwrap();
        }

        // Before reload, file has 6 lines (1 create + 5 updates).
        let path = dir.path().join("as.jsonl");
        let lines_before = std::fs::read_to_string(&path).unwrap().lines().count();
        assert_eq!(lines_before, 6);

        // Reload compacts to 1 line.
        store.reload().unwrap();
        let lines_after = std::fs::read_to_string(&path).unwrap().lines().count();
        assert_eq!(lines_after, 1);

        let quest = store.get("as-001").unwrap();
        assert_eq!(quest.retry_count, 5);
    }

    #[test]
    fn test_auto_close_parent_when_all_children_done() {
        let (mut store, _dir) = temp_store();
        let parent = store
            .create_with_agent("as", "Pipeline: Deploy", None)
            .unwrap();
        let c1 = store.create_child(&parent.id, "Step 1: Build").unwrap();
        let c2 = store.create_child(&parent.id, "Step 2: Test").unwrap();
        let c3 = store.create_child(&parent.id, "Step 3: Ship").unwrap();

        store.close(&c1.id.0, "built").unwrap();
        assert_eq!(store.get(&parent.id.0).unwrap().status, QuestStatus::Todo);

        store.close(&c2.id.0, "tested").unwrap();
        assert_eq!(store.get(&parent.id.0).unwrap().status, QuestStatus::Todo);

        store.close(&c3.id.0, "shipped").unwrap();
        assert_eq!(store.get(&parent.id.0).unwrap().status, QuestStatus::Done);
        assert!(
            store
                .get(&parent.id.0)
                .unwrap()
                .outcome_summary()
                .unwrap()
                .contains("3 steps")
        );
    }

    #[test]
    fn test_auto_close_cascades_upward() {
        let (mut store, _dir) = temp_store();
        let grandparent = store.create_with_agent("as", "Epic", None).unwrap();
        let parent = store.create_child(&grandparent.id, "Feature").unwrap();
        let child = store.create_child(&parent.id, "Task").unwrap();

        store.close(&child.id.0, "done").unwrap();
        assert_eq!(store.get(&parent.id.0).unwrap().status, QuestStatus::Done);
        assert_eq!(
            store.get(&grandparent.id.0).unwrap().status,
            QuestStatus::Done
        );
    }
}
