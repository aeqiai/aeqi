//! Debounced reflection writes — batch and dedup before committing to memory.
//!
//! During agent execution, multiple reflections may produce overlapping or
//! redundant memory writes in quick succession.  The [`WriteQueue`] batches
//! these writes and deduplicates by `{project}:{key}`, keeping only the
//! most recent version.  Writes are flushed after a configurable debounce
//! window (default 30 seconds).
//!
//! This prevents memory thrashing and reduces embedding API calls.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::debug;

// ── Types ──────────────────────────────────────────────────────────────────

/// A single memory write waiting in the debounce queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebouncedWrite {
    /// Semantic key (e.g. "auth/jwt-rotation").
    pub key: String,
    /// Full content to be stored.
    pub content: String,
    /// Memory category (e.g. "fact", "pattern", "decision").
    pub category: String,
    /// Memory scope (e.g. "domain", "system").
    pub scope: String,
    /// Project this write belongs to.
    pub project: String,
    /// When this write was queued (or last replaced).
    pub queued_at: DateTime<Utc>,
}

// ── Write Queue ────────────────────────────────────────────────────────────

/// Debounced write queue that batches and deduplicates memory writes.
///
/// Writes are keyed by `"{project}:{key}"` — a newer write with the same
/// composite key replaces the older one.  The [`drain_ready`] method returns
/// writes whose debounce window has elapsed.
pub struct WriteQueue {
    /// Pending writes keyed by `"{project}:{key}"`.
    queue: HashMap<String, DebouncedWrite>,
    /// Debounce window in milliseconds (default 30,000 = 30 seconds).
    pub debounce_ms: u64,
}

impl Default for WriteQueue {
    fn default() -> Self {
        Self {
            queue: HashMap::new(),
            debounce_ms: 30_000,
        }
    }
}

impl WriteQueue {
    /// Create a queue with a custom debounce window (in milliseconds).
    pub fn new(debounce_ms: u64) -> Self {
        Self {
            queue: HashMap::new(),
            debounce_ms,
        }
    }

    /// Push a write into the queue.
    ///
    /// If a write with the same `{project}:{key}` already exists, it is
    /// replaced — the newer content wins and the `queued_at` timestamp
    /// is updated.
    pub fn push(&mut self, write: DebouncedWrite) {
        let composite_key = format!("{}:{}", write.project, write.key);
        debug!(
            key = %composite_key,
            "debounce queue: push (replace if exists)"
        );
        self.queue.insert(composite_key, write);
    }

    /// Drain writes whose debounce window has elapsed.
    ///
    /// A write is "ready" when `now - queued_at` exceeds `debounce_ms`.
    /// Ready writes are removed from the queue and returned.
    pub fn drain_ready(&mut self, now: DateTime<Utc>) -> Vec<DebouncedWrite> {
        let debounce_duration = chrono::Duration::milliseconds(self.debounce_ms as i64);

        let ready_keys: Vec<String> = self
            .queue
            .iter()
            .filter(|(_, w)| (now - w.queued_at) >= debounce_duration)
            .map(|(k, _)| k.clone())
            .collect();

        let mut ready = Vec::with_capacity(ready_keys.len());
        for key in ready_keys {
            if let Some(write) = self.queue.remove(&key) {
                ready.push(write);
            }
        }

        if !ready.is_empty() {
            debug!(count = ready.len(), "debounce queue: drained ready writes");
        }

        ready
    }

    /// Number of writes currently pending in the queue.
    pub fn pending_count(&self) -> usize {
        self.queue.len()
    }

    /// Whether the queue is empty.
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    /// Clear all pending writes from the queue.
    pub fn clear(&mut self) {
        self.queue.clear();
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn make_write(
        project: &str,
        key: &str,
        content: &str,
        queued_at: DateTime<Utc>,
    ) -> DebouncedWrite {
        DebouncedWrite {
            key: key.to_string(),
            content: content.to_string(),
            category: "fact".to_string(),
            scope: "domain".to_string(),
            project: project.to_string(),
            queued_at,
        }
    }

    #[test]
    fn push_dedup_same_key_replaces() {
        let mut queue = WriteQueue::default();
        let now = Utc::now();

        queue.push(make_write("aeqi", "auth/jwt", "rotation every 24h", now));
        assert_eq!(queue.pending_count(), 1);

        // Push again with same project:key — should replace.
        queue.push(make_write(
            "aeqi",
            "auth/jwt",
            "rotation every 12h with refresh",
            now,
        ));
        assert_eq!(queue.pending_count(), 1, "same key should replace, not add");

        // The content should be the newer version.
        let writes = queue.drain_ready(now + Duration::minutes(1));
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].content, "rotation every 12h with refresh");
    }

    #[test]
    fn push_different_keys_accumulate() {
        let mut queue = WriteQueue::default();
        let now = Utc::now();

        queue.push(make_write("aeqi", "auth/jwt", "jwt rotation", now));
        queue.push(make_write("aeqi", "deploy/docker", "docker config", now));
        queue.push(make_write(
            "algostaking",
            "auth/jwt",
            "different project jwt",
            now,
        ));

        assert_eq!(queue.pending_count(), 3);
    }

    #[test]
    fn drain_ready_respects_debounce_window() {
        let mut queue = WriteQueue::new(30_000); // 30 seconds
        let now = Utc::now();
        let old = now - Duration::seconds(60); // 60 seconds ago — ready
        let recent = now - Duration::seconds(10); // 10 seconds ago — not ready

        queue.push(make_write("aeqi", "old-write", "old content", old));
        queue.push(make_write("aeqi", "recent-write", "new content", recent));

        let ready = queue.drain_ready(now);
        assert_eq!(ready.len(), 1, "only the old write should be ready");
        assert_eq!(ready[0].key, "old-write");

        // The recent write should still be pending.
        assert_eq!(queue.pending_count(), 1);
    }

    #[test]
    fn drain_ready_returns_nothing_when_all_too_new() {
        let mut queue = WriteQueue::new(30_000);
        let now = Utc::now();
        let recent = now - Duration::seconds(5);

        queue.push(make_write("aeqi", "fresh", "just added", recent));

        let ready = queue.drain_ready(now);
        assert!(ready.is_empty(), "nothing should be ready yet");
        assert_eq!(queue.pending_count(), 1);
    }

    #[test]
    fn drain_ready_removes_from_queue() {
        let mut queue = WriteQueue::new(1_000); // 1 second debounce
        let now = Utc::now();
        let old = now - Duration::seconds(5);

        queue.push(make_write("aeqi", "key-1", "content 1", old));
        queue.push(make_write("aeqi", "key-2", "content 2", old));

        assert_eq!(queue.pending_count(), 2);

        let ready = queue.drain_ready(now);
        assert_eq!(ready.len(), 2);
        assert!(queue.is_empty(), "queue should be empty after drain");
    }

    #[test]
    fn pending_count_and_is_empty() {
        let mut queue = WriteQueue::default();
        assert_eq!(queue.pending_count(), 0);
        assert!(queue.is_empty());

        queue.push(make_write("aeqi", "key", "content", Utc::now()));
        assert_eq!(queue.pending_count(), 1);
        assert!(!queue.is_empty());
    }

    #[test]
    fn clear_empties_queue() {
        let mut queue = WriteQueue::default();
        let now = Utc::now();

        queue.push(make_write("aeqi", "k1", "c1", now));
        queue.push(make_write("aeqi", "k2", "c2", now));
        queue.push(make_write("algostaking", "k3", "c3", now));

        assert_eq!(queue.pending_count(), 3);

        queue.clear();
        assert!(queue.is_empty());
        assert_eq!(queue.pending_count(), 0);
    }

    #[test]
    fn default_debounce_ms() {
        let queue = WriteQueue::default();
        assert_eq!(queue.debounce_ms, 30_000);
    }

    #[test]
    fn custom_debounce_ms() {
        let queue = WriteQueue::new(5_000);
        assert_eq!(queue.debounce_ms, 5_000);
    }
}
