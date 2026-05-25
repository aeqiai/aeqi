use aeqi_core::config::AEQIConfig;
use anyhow::{Context, Result};
use std::path::PathBuf;

use crate::cli::GraphAction;
use crate::helpers::load_config;
use aeqi_graph::{GraphFreshnessState, GraphHealth};

pub(crate) async fn cmd_graph(config_path: &Option<PathBuf>, action: GraphAction) -> Result<()> {
    match action {
        GraphAction::Index { root, full } => cmd_graph_index(config_path, &root, full),
        GraphAction::Stats { root } => cmd_graph_stats(config_path, &root),
        GraphAction::Health { root } => cmd_graph_health(config_path, &root),
        GraphAction::Audit => cmd_graph_audit(config_path),
    }
}

fn cmd_graph_index(config_path: &Option<PathBuf>, project: &str, full: bool) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let data_dir = config.data_dir();

    let repo_path = config
        .agent_spawns
        .iter()
        .find(|p| p.name == project)
        .map(|p| {
            let r = p
                .repo
                .replace('~', &dirs::home_dir().unwrap_or_default().to_string_lossy());
            PathBuf::from(r)
        })
        .with_context(|| format!("project '{project}' not found in config"))?;

    let graph_dir = data_dir.join("codegraph");
    std::fs::create_dir_all(&graph_dir).ok();
    let db_path = graph_dir.join(format!("{project}.db"));

    let store = aeqi_graph::GraphStore::open(&db_path)
        .with_context(|| format!("failed to open graph DB at {}", db_path.display()))?;
    let indexer = aeqi_graph::Indexer::new();

    let result = if full {
        eprintln!("Full indexing {project} at {} ...", repo_path.display());
        indexer.index(&repo_path, &store)?
    } else {
        eprintln!(
            "Incremental indexing {project} at {} ...",
            repo_path.display()
        );
        indexer.index_incremental(&repo_path, &store)?
    };

    eprintln!(
        "  files: {}, nodes: {}, edges: {}, communities: {}, processes: {}",
        result.files_parsed, result.nodes, result.edges, result.communities, result.processes,
    );
    if result.parse_errors > 0 {
        eprintln!("  parse errors: {}", result.parse_errors);
    }
    if result.unresolved > 0 {
        eprintln!("  unresolved symbols: {}", result.unresolved);
    }

    Ok(())
}

fn cmd_graph_stats(config_path: &Option<PathBuf>, project: &str) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let (_db_path, store) = open_graph_store(&config, project)?;
    let stats = store.stats()?;
    let indexed_at = store.get_meta("indexed_at")?.unwrap_or_default();
    let last_commit = store.get_meta("last_commit")?.unwrap_or_default();

    println!("Project: {project}");
    println!("  Nodes:       {}", stats.node_count);
    println!("  Edges:       {}", stats.edge_count);
    println!("  Files:       {}", stats.file_count);
    println!(
        "  Indexed at:  {}",
        if indexed_at.is_empty() {
            "never"
        } else {
            &indexed_at
        }
    );
    println!(
        "  Last commit: {}",
        if last_commit.is_empty() {
            "unknown"
        } else {
            &last_commit
        }
    );

    Ok(())
}

fn cmd_graph_health(config_path: &Option<PathBuf>, project: &str) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let (db_path, store) = open_graph_store(&config, project)?;
    let repo_path = resolve_repo_path(&config, project)?;
    let health = aeqi_graph::Indexer::new().health(&repo_path, &store)?;
    print_health(project, &db_path, &health);
    Ok(())
}

fn cmd_graph_audit(config_path: &Option<PathBuf>) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    if config.agent_spawns.is_empty() {
        eprintln!("No [[projects]] entries configured.");
        return Ok(());
    }

    println!("Graph audit:");
    for project_cfg in &config.agent_spawns {
        let project = &project_cfg.name;
        let repo_path = resolve_repo_path(&config, project)?;
        let db_path = graph_db_path(&config, project);
        if !db_path.exists() {
            println!("  {project}: missing graph DB at {}", db_path.display());
            continue;
        }

        let store = aeqi_graph::GraphStore::open(&db_path)?;
        let health = aeqi_graph::Indexer::new().health(&repo_path, &store)?;
        println!(
            "  {project}: {} | {:.1}% coverage | {} missing | {} dirty",
            freshness_label(health.freshness_state),
            health.coverage_ratio * 100.0,
            health.missing_file_count,
            health.dirty_file_count
        );
    }

    Ok(())
}

fn print_health(project: &str, db_path: &std::path::Path, health: &GraphHealth) {
    println!("Project: {project}");
    println!("  Graph DB:   {}", db_path.display());
    println!(
        "  Repo path:  {}",
        health.repo_path.as_deref().unwrap_or(&health.project_dir)
    );
    println!("  State:      {}", freshness_label(health.freshness_state));
    println!("  Coverage:   {:.1}%", health.coverage_ratio * 100.0);
    println!(
        "  Files:      {} indexed / {} expected ({} missing)",
        health.indexed_file_count, health.expected_file_count, health.missing_file_count
    );
    println!("  Dirty:      {}", health.dirty_file_count);
    println!(
        "  Indexed at: {}",
        health
            .indexed_at
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("never")
    );
    println!(
        "  Last commit:{}",
        health
            .last_commit
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(" unknown")
    );
    if !health.missing_files.is_empty() {
        let preview = health
            .missing_files
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>();
        println!("  Missing:    {}", preview.join(", "));
    }
}

fn freshness_label(state: GraphFreshnessState) -> &'static str {
    match state {
        GraphFreshnessState::Fresh => "fresh",
        GraphFreshnessState::Partial => "partial",
        GraphFreshnessState::Stale => "stale",
        GraphFreshnessState::Missing => "missing",
    }
}

fn resolve_repo_path(config: &AEQIConfig, project: &str) -> Result<PathBuf> {
    config
        .agent_spawns
        .iter()
        .find(|p| p.name == project)
        .map(|p| {
            let r = p
                .repo
                .replace('~', &dirs::home_dir().unwrap_or_default().to_string_lossy());
            PathBuf::from(r)
        })
        .with_context(|| format!("project '{project}' not found in config"))
}

fn graph_db_path(config: &AEQIConfig, project: &str) -> PathBuf {
    config
        .data_dir()
        .join("codegraph")
        .join(format!("{project}.db"))
}

fn open_graph_store(
    config: &AEQIConfig,
    project: &str,
) -> Result<(PathBuf, aeqi_graph::GraphStore)> {
    let db_path = graph_db_path(config, project);
    if !db_path.exists() {
        anyhow::bail!(
            "No graph DB for project '{project}'. Run `aeqi graph index -r {project}` first."
        );
    }
    let store = aeqi_graph::GraphStore::open(&db_path)
        .with_context(|| format!("failed to open graph DB at {}", db_path.display()))?;
    Ok((db_path, store))
}
