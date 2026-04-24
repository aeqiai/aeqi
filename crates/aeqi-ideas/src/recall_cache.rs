//! Daemon-side recall cache with generation-counter invalidation.
//!
//! Caches `search_explained` results keyed by the query shape so repeated
//! look-ups within a short window return the same hits without re-running
//! the staged pipeline. Writes (store, update, delete, feedback, link) bump
//! the generation counter and wipe the cache so stale hits never leak.
//!
//! The cache lives on `CommandContext::recall_cache` so every IPC handler
//! shares it — this replaces the per-MCP cache that used to live in
//! `aeqi-cli/src/cmd/mcp.rs`.

use aeqi_core::traits::SearchHit;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Stable key for one cached recall — every field that shapes the result
/// set appears here so different query inputs don't collide.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub text_hash: u64,
    pub tags_hash: u64,
    pub top_k: usize,
    pub agent_id_hash: u64,
    pub anchors_hash: u64,
}

impl CacheKey {
    /// Build a cache key from the raw query inputs. Hashing up front keeps
    /// the stored key compact and avoids holding owned strings per entry.
    pub fn build(
        text: &str,
        tags: &[String],
        top_k: usize,
        agent_id: Option<&str>,
        anchors: Option<&[String]>,
    ) -> Self {
        Self {
            text_hash: hash_one(text),
            tags_hash: hash_many(tags.iter().map(String::as_str)),
            top_k,
            agent_id_hash: agent_id.map(hash_one).unwrap_or(0),
            anchors_hash: anchors
                .map(|a| hash_many(a.iter().map(String::as_str)))
                .unwrap_or(0),
        }
    }
}

fn hash_one(s: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

fn hash_many<'a, I: IntoIterator<Item = &'a str>>(iter: I) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for item in iter {
        item.hash(&mut h);
    }
    h.finish()
}

/// Simple bounded LRU backed by a `HashMap` + access-order `Vec`. We don't
/// pull in the `lru` crate because this cache is small (default 256
/// entries) and the access pattern is read-dominated.
struct Inner {
    capacity: usize,
    order: Vec<CacheKey>, // oldest at front
    map: HashMap<CacheKey, (Instant, Vec<SearchHit>)>,
}

impl Inner {
    fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            order: Vec::with_capacity(capacity),
            map: HashMap::with_capacity(capacity),
        }
    }

    fn touch(&mut self, key: &CacheKey) {
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
            self.order.push(*key);
        }
    }

    fn insert(&mut self, key: CacheKey, value: (Instant, Vec<SearchHit>)) {
        if self.map.contains_key(&key) {
            self.touch(&key);
            self.map.insert(key, value);
            return;
        }
        if self.order.len() >= self.capacity
            && let Some(old) = self.order.first().copied()
        {
            self.order.remove(0);
            self.map.remove(&old);
        }
        self.order.push(key);
        self.map.insert(key, value);
    }

    fn get(&mut self, key: &CacheKey) -> Option<(Instant, Vec<SearchHit>)> {
        let hit = self.map.get(key).cloned();
        if hit.is_some() {
            self.touch(key);
        }
        hit
    }

    fn clear(&mut self) {
        self.order.clear();
        self.map.clear();
    }
}

/// Thread-safe cache handle. Clone-by-`Arc` in practice.
pub struct RecallCache {
    inner: Mutex<Inner>,
    ttl: Duration,
    generation: AtomicU64,
}

impl RecallCache {
    pub fn new(capacity: usize, ttl_secs: u64) -> Self {
        Self {
            inner: Mutex::new(Inner::new(capacity)),
            ttl: Duration::from_secs(ttl_secs),
            generation: AtomicU64::new(0),
        }
    }

    /// Fetch a cached hit when still within TTL. Returns `(age, hits)` so
    /// callers can log cache freshness alongside the result.
    pub fn get(&self, key: &CacheKey) -> Option<(Duration, Vec<SearchHit>)> {
        let mut inner = self.inner.lock().ok()?;
        let (inserted_at, hits) = inner.get(key)?;
        let age = inserted_at.elapsed();
        if age < self.ttl {
            Some((age, hits))
        } else {
            // Expired — evict lazily.
            inner.map.remove(key);
            inner.order.retain(|k| k != key);
            None
        }
    }

    /// Populate the cache with a freshly-computed result set.
    pub fn put(&self, key: CacheKey, hits: Vec<SearchHit>) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.insert(key, (Instant::now(), hits));
        }
    }

    /// Wipe every entry + bump the generation counter. Call after any
    /// write that might change what a search would return: store, update,
    /// delete, feedback, link.
    pub fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut inner) = self.inner.lock() {
            inner.clear();
        }
    }

    /// Current generation counter. Exposed for tests and observability.
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }
}

impl Default for RecallCache {
    fn default() -> Self {
        Self::new(256, 300)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::{Idea, Why};
    use chrono::Utc;

    fn hit(id: &str) -> SearchHit {
        SearchHit {
            idea: Idea::recalled(
                id.to_string(),
                id.to_string(),
                "body".to_string(),
                vec![],
                None,
                Utc::now(),
                None,
                1.0,
            ),
            why: Why::default(),
        }
    }

    #[test]
    fn cache_put_and_get_roundtrip() {
        let cache = RecallCache::new(4, 300);
        let key = CacheKey::build("hello", &["fact".to_string()], 5, Some("a1"), None);
        cache.put(key, vec![hit("x")]);

        let (_age, hits) = cache.get(&key).expect("cached entry");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].idea.id, "x");
    }

    #[test]
    fn cache_miss_when_key_differs() {
        let cache = RecallCache::new(4, 300);
        let a = CacheKey::build("hello", &[], 5, None, None);
        let b = CacheKey::build("bye", &[], 5, None, None);
        cache.put(a, vec![hit("x")]);
        assert!(cache.get(&b).is_none());
    }

    #[test]
    fn invalidate_clears_and_bumps_gen() {
        let cache = RecallCache::new(4, 300);
        let key = CacheKey::build("x", &[], 1, None, None);
        cache.put(key, vec![hit("x")]);
        assert_eq!(cache.generation(), 0);
        cache.invalidate();
        assert_eq!(cache.generation(), 1);
        assert!(cache.get(&key).is_none());
    }

    #[test]
    fn cache_evicts_oldest_over_capacity() {
        let cache = RecallCache::new(2, 300);
        let k1 = CacheKey::build("1", &[], 1, None, None);
        let k2 = CacheKey::build("2", &[], 1, None, None);
        let k3 = CacheKey::build("3", &[], 1, None, None);
        cache.put(k1, vec![hit("a")]);
        cache.put(k2, vec![hit("b")]);
        cache.put(k3, vec![hit("c")]);
        assert!(cache.get(&k1).is_none(), "oldest should be evicted");
        assert!(cache.get(&k2).is_some());
        assert!(cache.get(&k3).is_some());
    }

    #[test]
    fn ttl_expires_entries() {
        let cache = RecallCache::new(2, 0);
        let k = CacheKey::build("x", &[], 1, None, None);
        cache.put(k, vec![hit("a")]);
        // TTL zero → immediate expiry on read.
        std::thread::sleep(Duration::from_millis(5));
        assert!(cache.get(&k).is_none());
    }
}
