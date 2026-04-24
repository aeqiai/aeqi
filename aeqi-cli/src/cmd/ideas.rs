use aeqi_core::traits::IdeaStore;
use aeqi_ideas::obsidian::{ParsedIdea, merge_provenance_tags, scan_vault_parsed};
use anyhow::Result;
use std::path::{Path, PathBuf};
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
