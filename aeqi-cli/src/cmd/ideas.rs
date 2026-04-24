use aeqi_core::traits::IdeaStore;
use aeqi_ideas::obsidian::{ParsedIdea, merge_provenance_tags, scan_vault_parsed};
use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags, params};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tracing::{debug, info, warn};

use crate::cli::IdeasAction;
use crate::helpers::{daemon_ipc_request, load_config, open_ideas};

pub(crate) async fn cmd_ideas(config_path: &Option<PathBuf>, action: IdeasAction) -> Result<()> {
    match action {
        IdeasAction::Search { query, root, top_k } => {
            cmd_ideas_search(config_path, &query, root.as_deref(), top_k).await
        }
        IdeasAction::Store {
            name,
            content,
            root,
        } => cmd_ideas_store(config_path, &name, &content, root.as_deref()).await,
        IdeasAction::Export { vault } => cmd_ideas_export(config_path, &vault).await,
        IdeasAction::Import { vault, no_daemon } => {
            cmd_ideas_import(config_path, &vault, no_daemon).await
        }
        IdeasAction::RecoverTags {
            from,
            r#match,
            dry_run,
            yes,
        } => cmd_ideas_recover_tags(config_path, &from, &r#match, dry_run, yes).await,
    }
}

async fn cmd_ideas_search(
    config_path: &Option<PathBuf>,
    query: &str,
    _root: Option<&str>,
    top_k: usize,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let results = ideas
        .search(&aeqi_core::traits::IdeaQuery::new(query, top_k))
        .await?;

    if results.is_empty() {
        println!("No ideas found for: {query}");
    } else {
        for (i, entry) in results.iter().enumerate() {
            let age = chrono::Utc::now() - entry.created_at;
            let age_str = if age.num_days() > 0 {
                format!("{}d ago", age.num_days())
            } else if age.num_hours() > 0 {
                format!("{}h ago", age.num_hours())
            } else {
                format!("{}m ago", age.num_minutes())
            };
            println!(
                "{}. [{}] ({:.2}) {} — {}",
                i + 1,
                age_str,
                entry.score,
                entry.name,
                entry.content
            );
        }
    }
    Ok(())
}

async fn cmd_ideas_store(
    config_path: &Option<PathBuf>,
    name: &str,
    content: &str,
    root: Option<&str>,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let id = ideas
        .store(name, content, &["fact".to_string()], None)
        .await?;
    let scope = root.unwrap_or("global");
    println!("Stored idea {id} [{scope}] {name}");
    Ok(())
}

async fn cmd_ideas_export(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let count = aeqi_ideas::obsidian::export(&ideas, vault).await?;
    println!("Exported {count} ideas to {}", vault.display());
    Ok(())
}

/// Import ideas from an Obsidian vault.
///
/// Tries the daemon IPC path first so the full dedup / embed / tag-policy /
/// edge-reconciliation pipeline fires on every imported idea. If the
/// daemon isn't running (or `--no-daemon` is passed), falls back to a
/// direct SQLite write via `obsidian::import` — that path still applies
/// redaction + deterministic IDs but skips dedup and async embedding.
async fn cmd_ideas_import(
    config_path: &Option<PathBuf>,
    vault: &Path,
    no_daemon: bool,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let socket_path = config.data_dir().join("rm.sock");

    if no_daemon {
        info!("--no-daemon: falling back to direct SQLite write (dedup/embed pipeline skipped)");
        return cmd_ideas_import_direct(config_path, vault).await;
    }

    if !socket_path.exists() {
        warn!(
            socket = %socket_path.display(),
            "daemon IPC socket not found; falling back to direct SQLite write (dedup/embed pipeline skipped). Start the daemon with `aeqi daemon start` to get the full pipeline."
        );
        return cmd_ideas_import_direct(config_path, vault).await;
    }

    cmd_ideas_import_via_ipc(config_path, vault).await
}

async fn cmd_ideas_import_direct(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let (imported, skipped) = aeqi_ideas::obsidian::import(&ideas, vault).await?;
    println!(
        "Imported {imported} ideas ({skipped} skipped, direct SQLite) from {}",
        vault.display()
    );
    Ok(())
}

async fn cmd_ideas_import_via_ipc(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let parsed: Vec<ParsedIdea> = scan_vault_parsed(vault)?;
    if parsed.is_empty() {
        println!("No idea files found in {}", vault.display());
        return Ok(());
    }

    let mut created = 0_usize;
    let mut merged = 0_usize;
    let mut skipped = 0_usize;
    let mut superseded = 0_usize;
    let mut failed = 0_usize;

    // First pass: store every idea through the daemon so dedup/embedding/
    // policy all fire. We intentionally don't try to restore edges from
    // the ## Relations section on this path — the daemon's inline-link
    // parser already reconciles `[[X]]` / typed prefixes from the body,
    // and the UI-level "adjacent" relation belongs to a different flow.
    for mem in &parsed {
        let tags = merge_provenance_tags(&mem.tags, mem.source_path.as_deref());
        let req = serde_json::json!({
            "cmd": "store_idea",
            "name": mem.name,
            "content": mem.content,
            "tags": tags,
            "agent_id": mem.agent_id,
            "authored_by": "import",
        });

        let resp = match daemon_ipc_request(config_path, &req).await {
            Ok(r) => r,
            Err(e) => {
                warn!(name = %mem.name, err = %e, "IPC store_idea failed");
                failed += 1;
                continue;
            }
        };

        let ok = resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            let err = resp
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            warn!(name = %mem.name, err = %err, "daemon rejected store_idea");
            failed += 1;
            continue;
        }

        match resp.get("action").and_then(|v| v.as_str()).unwrap_or("") {
            "create" => {
                debug!(name = %mem.name, "imported (create)");
                created += 1;
            }
            "merge" => {
                debug!(name = %mem.name, "imported (merge)");
                merged += 1;
            }
            "supersede" => {
                debug!(name = %mem.name, "imported (supersede)");
                superseded += 1;
            }
            "skip" => {
                debug!(name = %mem.name, "skipped (dedup)");
                skipped += 1;
            }
            other => {
                debug!(name = %mem.name, action = %other, "imported (unknown action)");
                created += 1;
            }
        }
    }

    println!(
        "Imported {} ideas via daemon from {} ({} created, {} merged, {} superseded, {} skipped, {} failed)",
        created + merged + superseded,
        vault.display(),
        created,
        merged,
        superseded,
        skipped,
        failed,
    );
    Ok(())
}

/// How to match snapshot ideas against the live DB.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MatchMode {
    Name,
    Id,
}

impl MatchMode {
    fn parse(s: &str) -> Result<Self> {
        match s {
            "name" => Ok(MatchMode::Name),
            "id" => Ok(MatchMode::Id),
            other => anyhow::bail!("--match must be 'name' or 'id', got '{other}'"),
        }
    }
}

/// Summary returned by the in-process merger so the CLI and tests share logic.
#[derive(Debug, Default, PartialEq, Eq)]
struct RecoverSummary {
    snapshot_ideas: usize,
    live_ideas: usize,
    matched: usize,
    unmatched: usize,
    tags_added: usize,
    tags_already_present: usize,
}

async fn cmd_ideas_recover_tags(
    config_path: &Option<PathBuf>,
    snapshot: &Path,
    match_mode: &str,
    dry_run: bool,
    yes: bool,
) -> Result<()> {
    let mode = MatchMode::parse(match_mode)?;

    if !snapshot.exists() {
        anyhow::bail!("snapshot DB not found: {}", snapshot.display());
    }

    let (config, _) = load_config(config_path)?;
    let live_db_path = config.data_dir().join("aeqi.db");
    if !live_db_path.exists() {
        anyhow::bail!(
            "live idea DB not found: {}. Run `aeqi setup` or start the daemon first.",
            live_db_path.display()
        );
    }

    // Refuse no-ops — confirm that snapshot and live aren't literally the same file.
    if snapshot.canonicalize().ok() == live_db_path.canonicalize().ok() {
        anyhow::bail!("--from resolves to the live DB; refusing to merge a DB into itself");
    }

    if !dry_run && !yes {
        confirm_interactive(snapshot, &live_db_path)?;
    }

    let summary = recover_tags_merge(snapshot, &live_db_path, mode, dry_run)?;

    let prefix = if dry_run { "[dry-run] " } else { "" };
    println!(
        "{prefix}recover-tags: snapshot={} ideas, live={} ideas, matched={}, unmatched={}, tags +{} added, {} already present",
        summary.snapshot_ideas,
        summary.live_ideas,
        summary.matched,
        summary.unmatched,
        summary.tags_added,
        summary.tags_already_present,
    );
    Ok(())
}

fn confirm_interactive(snapshot: &Path, live: &Path) -> Result<()> {
    print!(
        "About to merge tags from {} → {}. Continue? [y/N] ",
        snapshot.display(),
        live.display(),
    );
    io::stdout().flush().ok();
    let stdin = io::stdin();
    let mut line = String::new();
    stdin
        .lock()
        .read_line(&mut line)
        .context("reading confirmation")?;
    let answer = line.trim().to_lowercase();
    if answer != "y" && answer != "yes" {
        anyhow::bail!("aborted by user — pass --yes to skip this prompt");
    }
    Ok(())
}

/// Open the snapshot read-only so the caller can't corrupt it and so
/// rusqlite won't try to create a journal file next to it.
fn open_snapshot(path: &Path) -> Result<Connection> {
    let uri = format!("file:{}?mode=ro", path.display());
    let conn = Connection::open_with_flags(
        &uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .with_context(|| format!("open snapshot read-only: {}", path.display()))?;
    Ok(conn)
}

/// Open the live DB for writing with a generous busy timeout so concurrent
/// daemon writers get their turn instead of erroring out.
fn open_live(path: &Path) -> Result<Connection> {
    let conn =
        Connection::open(path).with_context(|| format!("open live DB: {}", path.display()))?;
    conn.busy_timeout(Duration::from_secs(10))?;
    Ok(conn)
}

/// Core merge routine — kept free of CLI side-effects so the unit test can
/// drive it against in-memory DBs without spinning up the daemon.
fn recover_tags_merge(
    snapshot_path: &Path,
    live_path: &Path,
    mode: MatchMode,
    dry_run: bool,
) -> Result<RecoverSummary> {
    let snap = open_snapshot(snapshot_path)?;
    let mut live = open_live(live_path)?;
    recover_tags_merge_conns(&snap, &mut live, mode, dry_run)
}

/// Connection-level core — exists so tests can hand in `:memory:` connections
/// without round-tripping through the filesystem.
fn recover_tags_merge_conns(
    snap: &Connection,
    live: &mut Connection,
    mode: MatchMode,
    dry_run: bool,
) -> Result<RecoverSummary> {
    // Snapshot: harvest (key, [tags]) in a single pass. Filter out empty-tag
    // ideas so the "matched" counter only reflects ideas that actually had
    // tags to contribute.
    let (snapshot_ideas, snap_tags) = harvest_snapshot_tags(snap, mode)?;
    let live_count = count_live_ideas(live)?;

    // Guardrail: refuse if the snapshot has more ideas than live — that's the
    // common operator mistake of swapping the two flags.
    if snapshot_ideas > live_count.saturating_add(live_count / 10) {
        anyhow::bail!(
            "snapshot has {} ideas but live only has {}. Refusing to merge — did you swap the DBs?",
            snapshot_ideas,
            live_count
        );
    }

    let mut summary = RecoverSummary {
        snapshot_ideas,
        live_ideas: live_count,
        ..RecoverSummary::default()
    };

    let tx = live.transaction()?;
    {
        let mut insert_stmt =
            tx.prepare("INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)")?;
        for (key, tags) in &snap_tags {
            let live_id = match resolve_live_id(&tx, mode, key)? {
                Some(id) => id,
                None => {
                    summary.unmatched += 1;
                    debug!(key = %key, "no live match for snapshot idea");
                    continue;
                }
            };
            summary.matched += 1;

            for tag in tags {
                let changes = insert_stmt.execute(params![live_id, tag])?;
                if changes > 0 {
                    summary.tags_added += 1;
                } else {
                    summary.tags_already_present += 1;
                }
            }
        }
    }

    if dry_run {
        tx.rollback()?;
    } else {
        tx.commit()?;
    }

    Ok(summary)
}

fn count_live_ideas(live: &Connection) -> Result<usize> {
    let count: i64 = live.query_row("SELECT COUNT(*) FROM ideas", [], |row| row.get(0))?;
    Ok(count as usize)
}

/// Pull (match_key, tags) pairs out of the snapshot DB. `match_key` is either
/// the idea name or id depending on `mode`. Returns (total_ideas_with_tags,
/// map<key, tags>) — ideas with no tags are skipped because there's nothing
/// to contribute.
fn harvest_snapshot_tags(
    snap: &Connection,
    mode: MatchMode,
) -> Result<(usize, HashMap<String, Vec<String>>)> {
    let col = match mode {
        MatchMode::Name => "name",
        MatchMode::Id => "id",
    };
    let sql = format!(
        "SELECT i.{col}, t.tag
         FROM ideas i
         JOIN idea_tags t ON t.idea_id = i.id"
    );
    let mut stmt = snap.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (key, tag) = row?;
        map.entry(key).or_default().push(tag);
    }
    Ok((map.len(), map))
}

/// Look up the live idea_id for a given snapshot key. Matching by id is a
/// trivial existence check; matching by name prefers an `active` row.
fn resolve_live_id(
    live: &rusqlite::Transaction<'_>,
    mode: MatchMode,
    key: &str,
) -> Result<Option<String>> {
    let id_opt: Option<String> = match mode {
        MatchMode::Id => live
            .query_row("SELECT id FROM ideas WHERE id = ?1", params![key], |row| {
                row.get(0)
            })
            .ok(),
        MatchMode::Name => live
            .query_row(
                "SELECT id FROM ideas
                 WHERE name = ?1
                 ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
                 LIMIT 1",
                params![key],
                |row| row.get(0),
            )
            .ok(),
    };
    Ok(id_opt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn seed_schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE ideas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
             );
             CREATE TABLE idea_tags (
                idea_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (idea_id, tag)
             );",
        )
        .unwrap();
    }

    fn seed_idea(conn: &Connection, id: &str, name: &str, tags: &[&str]) {
        conn.execute(
            "INSERT INTO ideas (id, name) VALUES (?1, ?2)",
            params![id, name],
        )
        .unwrap();
        for tag in tags {
            conn.execute(
                "INSERT INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                params![id, tag],
            )
            .unwrap();
        }
    }

    #[test]
    fn recovers_tags_by_name_match() {
        let snap = Connection::open_in_memory().unwrap();
        let mut live = Connection::open_in_memory().unwrap();
        seed_schema(&snap);
        seed_schema(&live);

        // Snapshot has 3 ideas, 2 tags each — 6 total.
        seed_idea(&snap, "s1", "alpha", &["red", "blue"]);
        seed_idea(&snap, "s2", "beta", &["green", "yellow"]);
        seed_idea(&snap, "s3", "gamma", &["black", "white"]);

        // Live has matching names but different ids and zero tags.
        seed_idea(&live, "live-1", "alpha", &[]);
        seed_idea(&live, "live-2", "beta", &[]);
        seed_idea(&live, "live-3", "gamma", &[]);

        let summary = recover_tags_merge_conns(&snap, &mut live, MatchMode::Name, false).unwrap();
        assert_eq!(summary.snapshot_ideas, 3);
        assert_eq!(summary.live_ideas, 3);
        assert_eq!(summary.matched, 3);
        assert_eq!(summary.unmatched, 0);
        assert_eq!(summary.tags_added, 6);
        assert_eq!(summary.tags_already_present, 0);

        // Live DB now has 6 tag rows.
        let tag_count: i64 = live
            .query_row("SELECT COUNT(*) FROM idea_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tag_count, 6);
    }

    #[test]
    fn dry_run_does_not_mutate() {
        let snap = Connection::open_in_memory().unwrap();
        let mut live = Connection::open_in_memory().unwrap();
        seed_schema(&snap);
        seed_schema(&live);
        seed_idea(&snap, "s1", "alpha", &["red"]);
        seed_idea(&live, "live-1", "alpha", &[]);

        let summary = recover_tags_merge_conns(&snap, &mut live, MatchMode::Name, true).unwrap();
        assert_eq!(
            summary.tags_added, 1,
            "dry-run still reports what it would do"
        );

        let tag_count: i64 = live
            .query_row("SELECT COUNT(*) FROM idea_tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tag_count, 0, "dry-run did not write any rows");
    }

    #[test]
    fn unmatched_ideas_are_counted_not_errored() {
        let snap = Connection::open_in_memory().unwrap();
        let mut live = Connection::open_in_memory().unwrap();
        seed_schema(&snap);
        seed_schema(&live);
        seed_idea(&snap, "s1", "alpha", &["red"]);
        seed_idea(&snap, "s2", "orphan", &["blue"]); // No live match.
        // Seed enough live ideas so the "snapshot bigger than live" guardrail
        // doesn't trip — an orphan snapshot row is the normal case, not an error.
        seed_idea(&live, "live-1", "alpha", &[]);
        seed_idea(&live, "live-2", "unrelated-1", &[]);
        seed_idea(&live, "live-3", "unrelated-2", &[]);

        let summary = recover_tags_merge_conns(&snap, &mut live, MatchMode::Name, false).unwrap();
        assert_eq!(summary.matched, 1);
        assert_eq!(summary.unmatched, 1);
        assert_eq!(summary.tags_added, 1);
    }

    #[test]
    fn existing_tags_are_not_duplicated() {
        let snap = Connection::open_in_memory().unwrap();
        let mut live = Connection::open_in_memory().unwrap();
        seed_schema(&snap);
        seed_schema(&live);
        seed_idea(&snap, "s1", "alpha", &["red", "blue"]);
        // Live already has one of the two tags.
        seed_idea(&live, "live-1", "alpha", &["red"]);

        let summary = recover_tags_merge_conns(&snap, &mut live, MatchMode::Name, false).unwrap();
        assert_eq!(summary.tags_added, 1, "only the missing tag is inserted");
        assert_eq!(summary.tags_already_present, 1);
    }

    #[test]
    fn id_match_mode_works() {
        let snap = Connection::open_in_memory().unwrap();
        let mut live = Connection::open_in_memory().unwrap();
        seed_schema(&snap);
        seed_schema(&live);
        // Same id in both — id-match path exercises this.
        seed_idea(&snap, "shared-id", "name-a", &["t1"]);
        seed_idea(&live, "shared-id", "name-b", &[]);

        let summary = recover_tags_merge_conns(&snap, &mut live, MatchMode::Id, false).unwrap();
        assert_eq!(summary.matched, 1);
        assert_eq!(summary.tags_added, 1);
    }

    #[test]
    fn refuses_when_snapshot_bigger_than_live() {
        let snap = Connection::open_in_memory().unwrap();
        let mut live = Connection::open_in_memory().unwrap();
        seed_schema(&snap);
        seed_schema(&live);
        // Snapshot has 10 ideas with tags, live has 1.
        for i in 0..10 {
            seed_idea(&snap, &format!("s{i}"), &format!("n{i}"), &["tag"]);
        }
        seed_idea(&live, "live-1", "n0", &[]);

        let err = recover_tags_merge_conns(&snap, &mut live, MatchMode::Name, false)
            .expect_err("should refuse");
        assert!(err.to_string().contains("Refusing to merge"), "err = {err}");
    }

    #[test]
    fn match_mode_parser() {
        assert_eq!(MatchMode::parse("name").unwrap(), MatchMode::Name);
        assert_eq!(MatchMode::parse("id").unwrap(), MatchMode::Id);
        assert!(MatchMode::parse("garbage").is_err());
    }
}
