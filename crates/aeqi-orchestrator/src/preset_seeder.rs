//! Preset idea seeder — first-boot hydration from `presets/seed_ideas/*.md`.
//!
//! AEQI ships with a small library of foundational ideas — skill primers for
//! the four primitives (create-idea, create-quest, create-event, spawn-subagent,
//! manage-tools, evolve-identity) and a vanilla baseline identity. They live as
//! markdown + frontmatter under `presets/seed_ideas/` so the text stays
//! human-editable and reviewable alongside the code.
//!
//! This module loads those files and inserts each as a **global** idea
//! (`agent_id = NULL`) with **insert-if-absent** semantics: if an idea with the
//! same name already exists we leave it alone so operator edits persist across
//! restarts. Tags come from frontmatter; the body is stored verbatim as the
//! idea's `content`.
//!
//! Intentional scope boundary: this module does NOT create events, wire
//! `session:start`, or auto-inject preset ideas into any agent's prompt. The
//! lifecycle-event seeder in `event_handler.rs` owns the firing contract; this
//! module only guarantees the ideas are *discoverable* via search, so a fresh
//! install has real content when the user types "how do I create a quest?".
//!
//! Also provides `purge_test_identity_ideas` — called by `aeqi seed
//! --reset-identities` — to clear junk identity ideas that accumulated during
//! testing (the magical-loli seed pack).

use std::path::{Path, PathBuf};

use aeqi_core::frontmatter::load_frontmatter;
use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use tracing::{info, warn};

use crate::event_handler::EventHandlerStore;

/// Frontmatter shape for `presets/seed_ideas/*.md`.
#[derive(Debug, Deserialize)]
struct SeedIdeaMeta {
    /// The idea's stable name (slug). Used for exact-match lookup and dedupe.
    name: String,
    /// Tags attached to the idea row. Common: `skill`, `identity`, `evergreen`.
    #[serde(default)]
    tags: Vec<String>,
    /// Human-readable one-liner. Not stored in the DB today — reserved for a
    /// future description column / catalogue UI.
    #[serde(default)]
    #[allow(dead_code)]
    description: String,
}

/// Locate the `presets/seed_ideas/` directory. Tries, in order:
/// 1. `$AEQI_PRESETS_DIR/seed_ideas/`
/// 2. `./presets/seed_ideas/` (cwd — dev workflow)
/// 3. `../presets/seed_ideas/` (running from a subdir like `apps/ui`)
/// 4. `<exe_dir>/presets/seed_ideas/` (shipped alongside the binary)
/// 5. `<exe_dir>/../share/aeqi/seed_ideas/` (system install)
pub fn locate_presets_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("AEQI_PRESETS_DIR") {
        let candidate = PathBuf::from(dir).join("seed_ideas");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("presets").join("seed_ideas");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if let Some(parent) = cwd.parent() {
            let candidate = parent.join("presets").join("seed_ideas");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }

    if let Ok(exe) = std::env::current_exe()
        && let Some(exe_dir) = exe.parent()
    {
        let candidate = exe_dir.join("presets").join("seed_ideas");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if let Some(install_root) = exe_dir.parent() {
            let candidate = install_root.join("share").join("aeqi").join("seed_ideas");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }

    None
}

/// Result summary for a single seed idea file — returned by `seed_preset_ideas`
/// for visibility. Kept simple: a status string is enough for startup logging.
#[derive(Debug, Clone)]
pub struct SeedResult {
    pub name: String,
    pub path: PathBuf,
    pub status: SeedStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeedStatus {
    /// The idea was inserted fresh.
    Inserted,
    /// An idea with this name already existed; left untouched so operator
    /// edits persist.
    AlreadyPresent,
    /// The file could not be parsed (missing frontmatter, bad yaml, etc.).
    Skipped(String),
}

/// Seed `presets/seed_ideas/*.md` into the global idea store.
///
/// Insert-if-absent: an existing idea with the same name (agent_id IS NULL) is
/// never overwritten. Tags are applied only on fresh inserts — once an idea
/// exists, the operator owns its taxonomy.
///
/// Returns the per-file result list so the caller can log a summary.
pub async fn seed_preset_ideas(store: &EventHandlerStore) -> Result<Vec<SeedResult>> {
    let Some(presets_dir) = locate_presets_dir() else {
        info!("presets/seed_ideas not found — skipping preset idea seeding");
        return Ok(Vec::new());
    };

    let mut results: Vec<SeedResult> = Vec::new();
    let entries = std::fs::read_dir(&presets_dir)
        .with_context(|| format!("read_dir failed: {}", presets_dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let result = seed_one_file(store, &path).await;
        let (name, status) = match result {
            Ok((name, status)) => (name, status),
            Err(e) => (
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("?")
                    .to_string(),
                SeedStatus::Skipped(e.to_string()),
            ),
        };

        if let SeedStatus::Skipped(reason) = &status {
            warn!(path = %path.display(), reason, "skipped preset idea");
        }

        results.push(SeedResult { name, path, status });
    }

    Ok(results)
}

/// Seed a single markdown file. Returns (idea name, status).
async fn seed_one_file(store: &EventHandlerStore, path: &Path) -> Result<(String, SeedStatus)> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("read_to_string: {}", path.display()))?;

    let (meta, body) = load_frontmatter::<SeedIdeaMeta>(&content)
        .with_context(|| format!("frontmatter parse failed: {}", path.display()))?;

    if meta.name.trim().is_empty() {
        return Ok((
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("?")
                .to_string(),
            SeedStatus::Skipped("frontmatter name is empty".into()),
        ));
    }
    if body.trim().is_empty() {
        return Ok((meta.name, SeedStatus::Skipped("body is empty".into())));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let db = store.db.lock().await;

    let existing: Option<String> = db
        .query_row(
            "SELECT id FROM ideas WHERE agent_id IS NULL AND name = ?1",
            rusqlite::params![&meta.name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .with_context(|| format!("lookup failed for seed idea '{}'", meta.name))?;

    if existing.is_some() {
        return Ok((meta.name, SeedStatus::AlreadyPresent));
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO ideas (id, name, content, scope, agent_id, created_at)
         VALUES (?1, ?2, ?3, 'domain', NULL, ?4)",
        rusqlite::params![&new_id, &meta.name, &body, &now],
    )
    .with_context(|| format!("insert failed for seed idea '{}'", meta.name))?;

    for tag in &meta.tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        db.execute(
            "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
            rusqlite::params![&new_id, tag],
        )
        .with_context(|| format!("tag insert failed for '{}' tag '{}'", meta.name, tag))?;
    }

    Ok((meta.name, SeedStatus::Inserted))
}

/// A purged idea row — what we deleted when `purge_test_identity_ideas` ran.
#[derive(Debug, Clone)]
pub struct PurgedIdea {
    pub id: String,
    pub name: String,
    /// Which heuristic matched (e.g. "name-substring:magical").
    pub reason: String,
}

/// Junk-name substrings — accumulated during test runs. Case-insensitive.
const JUNK_NAME_SUBSTRINGS: &[&str] = &[
    "magical",
    "loli",
    "isekai",
    "anime-isekai",
    "magical-transformation",
    "session-start-magical",
];

/// Junk-content markers — for ideas whose *content* says "magical loli" but
/// whose slug is innocuous.
const JUNK_CONTENT_SUBSTRINGS: &[&str] = &[
    "magical loli",
    "Magical Loli",
    "isekai assistant",
    "Magical Transformation Protocol",
];

/// Junk tags.
const JUNK_TAGS: &[&str] = &["isekai", "loli"];

/// Purge test-identity junk ideas — the magical-loli seed pack that leaked
/// into some developer DBs. Matches by name substring, content marker, or
/// junk tag; leaves everything else alone.
///
/// Returns the list of deleted rows so the caller can log what was cleared.
pub async fn purge_test_identity_ideas(store: &EventHandlerStore) -> Result<Vec<PurgedIdea>> {
    let db = store.db.lock().await;

    // Load candidate rows: every global idea that matches any junk heuristic.
    let mut matches: Vec<PurgedIdea> = Vec::new();

    // 1. Name substring matches.
    for needle in JUNK_NAME_SUBSTRINGS {
        let pattern = format!("%{needle}%");
        let mut stmt = db.prepare(
            "SELECT id, name FROM ideas WHERE agent_id IS NULL AND LOWER(name) LIKE LOWER(?1)",
        )?;
        let rows = stmt.query_map(rusqlite::params![&pattern], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            Ok((id, name))
        })?;
        for row in rows.flatten() {
            let (id, name) = row;
            if matches.iter().any(|m| m.id == id) {
                continue;
            }
            matches.push(PurgedIdea {
                id,
                name,
                reason: format!("name-substring:{needle}"),
            });
        }
    }

    // 2. Content substring matches.
    for needle in JUNK_CONTENT_SUBSTRINGS {
        let pattern = format!("%{needle}%");
        let mut stmt =
            db.prepare("SELECT id, name FROM ideas WHERE agent_id IS NULL AND content LIKE ?1")?;
        let rows = stmt.query_map(rusqlite::params![&pattern], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            Ok((id, name))
        })?;
        for row in rows.flatten() {
            let (id, name) = row;
            if matches.iter().any(|m| m.id == id) {
                continue;
            }
            matches.push(PurgedIdea {
                id,
                name,
                reason: format!("content-substring:{needle}"),
            });
        }
    }

    // 3. Junk tag matches.
    for tag in JUNK_TAGS {
        let mut stmt = db.prepare(
            "SELECT i.id, i.name FROM ideas i \
             INNER JOIN idea_tags t ON t.idea_id = i.id \
             WHERE i.agent_id IS NULL AND t.tag = ?1",
        )?;
        let rows = stmt.query_map(rusqlite::params![tag], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            Ok((id, name))
        })?;
        for row in rows.flatten() {
            let (id, name) = row;
            if matches.iter().any(|m| m.id == id) {
                continue;
            }
            matches.push(PurgedIdea {
                id,
                name,
                reason: format!("tag:{tag}"),
            });
        }
    }

    // Delete matched rows. idea_tags has ON DELETE CASCADE so tags disappear
    // with their owner idea. FTS triggers handle the ideas_fts index.
    for item in &matches {
        db.execute(
            "DELETE FROM ideas WHERE id = ?1",
            rusqlite::params![&item.id],
        )
        .with_context(|| format!("failed to delete junk idea '{}'", item.name))?;
    }

    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use tempfile::tempdir;

    async fn setup_store() -> (tempfile::TempDir, EventHandlerStore) {
        let tmp = tempdir().unwrap();
        let reg = AgentRegistry::open(tmp.path()).unwrap();
        let store = EventHandlerStore::new(reg.db());
        // Ensure the ideas tables exist — ordinarily created by the ideas
        // store migration. Run the bare DDL here so we don't need the
        // full ideas crate.
        let db = store.db.lock().await;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS ideas (\
                id TEXT PRIMARY KEY, \
                name TEXT NOT NULL, \
                content TEXT NOT NULL, \
                scope TEXT NOT NULL DEFAULT 'domain', \
                agent_id TEXT, \
                session_id TEXT, \
                created_at TEXT NOT NULL, \
                updated_at TEXT, \
                expires_at TEXT, \
                inheritance TEXT NOT NULL DEFAULT 'self', \
                tool_allow TEXT NOT NULL DEFAULT '[]', \
                tool_deny TEXT NOT NULL DEFAULT '[]', \
                content_hash TEXT, \
                source_kind TEXT, \
                source_ref TEXT, \
                managed INTEGER NOT NULL DEFAULT 0 \
             ); \
             CREATE TABLE IF NOT EXISTS idea_tags (\
                idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE, \
                tag TEXT NOT NULL, \
                PRIMARY KEY (idea_id, tag) \
             );",
        )
        .unwrap();
        drop(db);
        (tmp, store)
    }

    #[tokio::test]
    async fn seed_one_file_inserts_new_idea_with_tags() {
        let (_tmp, store) = setup_store().await;
        let dir = tempdir().unwrap();
        let file = dir.path().join("alpha.md");
        std::fs::write(
            &file,
            "---\nname: alpha-skill\ntags: [skill, evergreen]\ndescription: test\n---\n\nBody text.\n",
        )
        .unwrap();

        let (name, status) = seed_one_file(&store, &file).await.unwrap();
        assert_eq!(name, "alpha-skill");
        assert_eq!(status, SeedStatus::Inserted);

        // Second call is a no-op (idempotent).
        let (_, status) = seed_one_file(&store, &file).await.unwrap();
        assert_eq!(status, SeedStatus::AlreadyPresent);

        // Tags applied.
        let db = store.db.lock().await;
        let tag_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM idea_tags t JOIN ideas i ON i.id = t.idea_id \
                 WHERE i.name = 'alpha-skill'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag_count, 2);
    }

    #[tokio::test]
    async fn seed_one_file_skips_empty_body() {
        let (_tmp, store) = setup_store().await;
        let dir = tempdir().unwrap();
        let file = dir.path().join("blank.md");
        std::fs::write(
            &file,
            "---\nname: blank\ntags: [skill]\ndescription: empty\n---\n",
        )
        .unwrap();

        let (_name, status) = seed_one_file(&store, &file).await.unwrap();
        assert!(matches!(status, SeedStatus::Skipped(_)));
    }

    #[tokio::test]
    async fn seed_preset_ideas_handles_missing_dir() {
        let (_tmp, store) = setup_store().await;
        // Isolate the env so tests don't pick up the repo's own presets dir.
        unsafe {
            std::env::set_var("AEQI_PRESETS_DIR", "/nonexistent/path/that/does/not/exist");
        }
        let results = seed_preset_ideas(&store).await.unwrap();
        unsafe {
            std::env::remove_var("AEQI_PRESETS_DIR");
        }
        assert!(results.is_empty());
    }

    #[tokio::test]
    async fn purge_matches_magical_loli_pack_and_leaves_clean_ideas() {
        let (_tmp, store) = setup_store().await;
        let now = chrono::Utc::now().to_rfc3339();

        // Insert: 1 clean, 3 junk (by name, content, tag).
        {
            let db = store.db.lock().await;
            db.execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at) \
                 VALUES ('i1', 'clean-idea', 'normal content', 'domain', NULL, ?1)",
                rusqlite::params![&now],
            )
            .unwrap();
            db.execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at) \
                 VALUES ('i2', 'anime-isekai-loli-assistant', 'whatever', 'domain', NULL, ?1)",
                rusqlite::params![&now],
            )
            .unwrap();
            db.execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at) \
                 VALUES ('i3', 'session-start-prompt', 'Welcome, magical loli adventurer!', 'domain', NULL, ?1)",
                rusqlite::params![&now],
            )
            .unwrap();
            db.execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at) \
                 VALUES ('i4', 'innocuous-identity', 'just a regular identity', 'domain', NULL, ?1)",
                rusqlite::params![&now],
            )
            .unwrap();
            db.execute(
                "INSERT INTO idea_tags (idea_id, tag) VALUES ('i4', 'isekai')",
                [],
            )
            .unwrap();
        }

        let purged = purge_test_identity_ideas(&store).await.unwrap();
        let purged_ids: std::collections::HashSet<&str> =
            purged.iter().map(|p| p.id.as_str()).collect();

        assert!(
            purged_ids.contains("i2"),
            "name-substring junk should be purged"
        );
        assert!(
            purged_ids.contains("i3"),
            "content-substring junk should be purged"
        );
        assert!(purged_ids.contains("i4"), "tag junk should be purged");
        assert!(!purged_ids.contains("i1"), "clean idea must survive");

        let db = store.db.lock().await;
        let remaining: i64 = db
            .query_row("SELECT COUNT(*) FROM ideas", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 1);
    }
}
