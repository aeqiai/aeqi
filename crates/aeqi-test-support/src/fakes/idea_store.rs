use aeqi_core::traits::{Idea, IdeaQuery, IdeaStore};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Mutex;

/// An in-memory [`IdeaStore`] for tests.
///
/// Seeds a fixed set of ideas, supports prefix search (used by channel
/// migrations) and delete (used by anything that tears down seeded data).
/// Tracks deleted ids so tests can assert side effects.
///
/// No FTS, no scoring, no graph — this is a test double, not a replacement
/// for the real SQLite-backed store.
///
/// Prior to this, the same ~50 lines of trait boilerplate were copy-pasted
/// into every test module that needed an `IdeaStore`. Please don't reinstate
/// the duplication.
pub struct InMemoryIdeaStore {
    ideas: Mutex<Vec<Idea>>,
    deleted: Mutex<Vec<String>>,
}

impl InMemoryIdeaStore {
    /// Create an empty store.
    pub fn new() -> Self {
        Self {
            ideas: Mutex::new(Vec::new()),
            deleted: Mutex::new(Vec::new()),
        }
    }

    /// Seed with a fixed set of ideas. The order is preserved for
    /// prefix-search results so tests can assert on it.
    pub fn seeded(ideas: Vec<Idea>) -> Self {
        Self {
            ideas: Mutex::new(ideas),
            deleted: Mutex::new(Vec::new()),
        }
    }

    /// Return a clone of every id that has been passed to `delete()`,
    /// in call order. Tests use this to assert the migration deleted the
    /// expected rows.
    pub fn deleted_ids(&self) -> Vec<String> {
        self.deleted.lock().unwrap().clone()
    }

    /// Read the current set of ideas.
    pub fn snapshot(&self) -> Vec<Idea> {
        self.ideas.lock().unwrap().clone()
    }

    /// Push a fully-built idea onto the backing set. Use this when a test
    /// needs to inject a new idea mid-flow (e.g. to simulate a stray write
    /// that appears after a migration already marked itself done).
    ///
    /// For the common case of starting with a seeded set, prefer
    /// [`Self::seeded`].
    pub fn push(&self, idea: Idea) {
        self.ideas.lock().unwrap().push(idea);
    }
}

impl Default for InMemoryIdeaStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl IdeaStore for InMemoryIdeaStore {
    async fn store(
        &self,
        _name: &str,
        _content: &str,
        _tags: &[String],
        _agent_id: Option<&str>,
    ) -> Result<String> {
        // Tests that exercise store() should build an Idea via IdeaBuilder
        // and push it onto the seeded set directly. This method returns a
        // stable stub id so callers that don't care about the stored shape
        // still work.
        Ok("stub".into())
    }

    async fn search(&self, _query: &IdeaQuery) -> Result<Vec<Idea>> {
        Ok(Vec::new())
    }

    fn search_by_prefix(&self, prefix: &str, _limit: usize) -> Result<Vec<Idea>> {
        Ok(self
            .ideas
            .lock()
            .unwrap()
            .iter()
            .filter(|i| i.name.starts_with(prefix))
            .cloned()
            .collect())
    }

    async fn delete(&self, id: &str) -> Result<()> {
        self.deleted.lock().unwrap().push(id.to_string());
        self.ideas.lock().unwrap().retain(|i| i.id != id);
        Ok(())
    }

    fn name(&self) -> &str {
        "in-memory-test"
    }
}
