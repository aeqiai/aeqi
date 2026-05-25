use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::cli::GraphAction;
use crate::helpers::load_config;

pub(crate) async fn cmd_graph(config_path: &Option<PathBuf>, action: GraphAction) -> Result<()> {
    match action {
        GraphAction::Index { root, full } => cmd_graph_index(config_path, &root, full),
        GraphAction::Stats { root } => cmd_graph_stats(config_path, &root),
        GraphAction::Audit { root, json } => cmd_graph_audit(config_path, root.as_deref(), json),
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
    let data_dir = config.data_dir();

    let db_path = data_dir.join("codegraph").join(format!("{project}.db"));
    if !db_path.exists() {
        eprintln!(
            "No graph DB for project '{project}'. Run `aeqi graph index -r {project}` first."
        );
        return Ok(());
    }

    let store = aeqi_graph::GraphStore::open(&db_path)?;
    let stats = store.stats()?;
    let health = load_graph_health(&store)?;
    let repo_path = health
        .repo_path
        .clone()
        .or_else(|| store.get_meta("repo_path").ok().flatten());

    println!("Project: {project}");
    println!("  Nodes:       {}", stats.node_count);
    println!("  Edges:       {}", stats.edge_count);
    println!("  Files:       {}", stats.file_count);
    println!("  Indexed at:  {}", display_or(&health.indexed_at, "never"));
    println!(
        "  Last commit: {}",
        display_or(&health.last_commit, "unknown")
    );
    if let Some(repo_path) = repo_path {
        println!("  Repo path:   {repo_path}");
    }
    if let Some(summary) = coverage_summary(&health) {
        println!("  Coverage:    {summary}");
    }
    println!("  Freshness:   {}", health.effective_freshness());
    if !health.missing_subtrees.is_empty() {
        println!("  Missing subtrees: {}", health.missing_subtrees.join(", "));
    }
    if !health.missing_files.is_empty() {
        println!(
            "  Missing files: {}",
            preview_list(&health.missing_files, 6)
        );
    }

    Ok(())
}

fn cmd_graph_audit(
    config_path: &Option<PathBuf>,
    root_filter: Option<&str>,
    json: bool,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let report = build_graph_audit_report(&config, root_filter)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    render_graph_audit_report(&report);
    Ok(())
}

fn build_graph_audit_report(
    config: &aeqi_core::AEQIConfig,
    root_filter: Option<&str>,
) -> Result<GraphAuditReport> {
    let graph_dir = config.data_dir().join("codegraph");
    let mut roots = Vec::new();

    for project in &config.agent_spawns {
        if let Some(filter) = root_filter
            && project.name != filter
        {
            continue;
        }
        roots.push(build_graph_root_report(config, &graph_dir, project)?);
    }

    if let Some(filter) = root_filter
        && roots.is_empty()
    {
        anyhow::bail!("project '{filter}' not found in config");
    }

    let mut healthy_count = 0usize;
    let mut stale_count = 0usize;
    let mut missing_count = 0usize;
    let mut error_count = 0usize;
    for root in &roots {
        match root.status.as_str() {
            "healthy" => healthy_count += 1,
            "stale" => stale_count += 1,
            "missing" => missing_count += 1,
            "error" => error_count += 1,
            _ => {}
        }
    }

    Ok(GraphAuditReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        root_filter: root_filter.map(str::to_string),
        project_count: roots.len(),
        healthy_count,
        stale_count,
        missing_count,
        error_count,
        roots,
    })
}

fn build_graph_root_report(
    config: &aeqi_core::AEQIConfig,
    graph_dir: &Path,
    project: &aeqi_core::config::AgentSpawnConfig,
) -> Result<GraphRootReport> {
    let configured_repo = config.resolve_repo(&project.repo);
    let repo_present = configured_repo.exists();
    let db_path = graph_dir.join(format!("{}.db", project.name));
    let db_present = db_path.exists();

    if !db_present {
        let mut notes = vec!["graph DB missing".to_string()];
        if !repo_present {
            notes.push("configured repo path missing".to_string());
        }
        return Ok(GraphRootReport {
            name: project.name.clone(),
            configured_repo: configured_repo.to_string_lossy().to_string(),
            indexed_repo_path: None,
            db_path: db_path.to_string_lossy().to_string(),
            repo_present,
            db_present,
            status: "missing".into(),
            freshness_state: "missing".into(),
            notes,
            stats: None,
            health: GraphHealthSnapshot::default(),
        });
    }

    let store = match aeqi_graph::GraphStore::open(&db_path) {
        Ok(store) => store,
        Err(error) => {
            return Ok(GraphRootReport {
                name: project.name.clone(),
                configured_repo: configured_repo.to_string_lossy().to_string(),
                indexed_repo_path: None,
                db_path: db_path.to_string_lossy().to_string(),
                repo_present,
                db_present,
                status: "error".into(),
                freshness_state: "error".into(),
                notes: vec![format!("failed to open graph DB: {error}")],
                stats: None,
                health: GraphHealthSnapshot::default(),
            });
        }
    };

    let stats = store.stats().ok();
    let health = load_graph_health(&store)?;
    let indexed_repo_path = health
        .repo_path
        .clone()
        .or_else(|| store.get_meta("repo_path").ok().flatten());

    let mut notes = Vec::new();
    let mut status = "healthy".to_string();
    let freshness_state = health.effective_freshness();

    if !repo_present {
        notes.push("configured repo path missing".to_string());
        status = "stale".to_string();
    }
    if let Some(indexed_repo_path) = &indexed_repo_path
        && !same_path(&configured_repo, Path::new(indexed_repo_path))
    {
        notes.push(format!("indexed from {}", indexed_repo_path));
        status = "stale".to_string();
    }
    if !health.dirty_files.is_empty() {
        notes.push(format!("{} dirty files recorded", health.dirty_files.len()));
        status = "stale".to_string();
    }
    if !health.missing_files.is_empty() {
        notes.push(format!(
            "{} missing files in health report",
            health.missing_files.len()
        ));
        status = "stale".to_string();
    }
    if !health.missing_subtrees.is_empty() {
        notes.push(format!(
            "missing subtrees: {}",
            health.missing_subtrees.join(", ")
        ));
        status = "stale".to_string();
    }
    if let Some(ratio) = health.coverage_ratio
        && ratio < 0.999
    {
        notes.push(format!("coverage {:.1}%", ratio * 100.0));
        status = "stale".to_string();
    }
    if health.indexed_at.is_none() {
        notes.push("indexed_at missing".to_string());
        status = "missing".to_string();
    }
    if status == "healthy" && !repo_present {
        status = "stale".to_string();
    }

    if notes.is_empty() {
        notes.push("graph appears healthy".to_string());
    }

    Ok(GraphRootReport {
        name: project.name.clone(),
        configured_repo: configured_repo.to_string_lossy().to_string(),
        indexed_repo_path,
        db_path: db_path.to_string_lossy().to_string(),
        repo_present,
        db_present,
        status,
        freshness_state,
        notes,
        stats,
        health,
    })
}

fn load_graph_health(store: &aeqi_graph::GraphStore) -> Result<GraphHealthSnapshot> {
    let mut health = GraphHealthSnapshot {
        repo_path: store.get_meta("repo_path")?,
        indexed_at: store.get_meta("indexed_at")?,
        last_commit: store.get_meta("last_commit")?,
        indexed_files: parse_u32_meta(&store.get_meta("indexed_files")?),
        expected_files: parse_u32_meta(&store.get_meta("expected_files")?),
        coverage_ratio: parse_f64_meta(&store.get_meta("coverage_ratio")?),
        missing_files: parse_string_list(store.get_meta("missing_files")?),
        missing_subtrees: parse_string_list(store.get_meta("missing_subtrees")?),
        dirty_files: parse_string_list(store.get_meta("dirty_files")?),
        freshness_state: store.get_meta("freshness_state")?,
    };

    if let Some(blob) = read_graph_health_blob(store)? {
        if health.repo_path.is_none() {
            health.repo_path = blob.repo_path;
        }
        if health.indexed_at.is_none() {
            health.indexed_at = blob.indexed_at;
        }
        if health.last_commit.is_none() {
            health.last_commit = blob.last_commit;
        }
        if health.indexed_files.is_none() {
            health.indexed_files = blob.indexed_files;
        }
        if health.expected_files.is_none() {
            health.expected_files = blob.expected_files;
        }
        if health.coverage_ratio.is_none() {
            health.coverage_ratio = blob.coverage_ratio;
        }
        if health.missing_files.is_empty() {
            health.missing_files = blob.missing_files.unwrap_or_default();
        }
        if health.missing_subtrees.is_empty() {
            health.missing_subtrees = blob.missing_subtrees.unwrap_or_default();
        }
        if health.dirty_files.is_empty() {
            health.dirty_files = blob.dirty_files.unwrap_or_default();
        }
        if health.freshness_state.is_none() {
            health.freshness_state = blob.freshness_state;
        }
    }

    Ok(health)
}

fn read_graph_health_blob(store: &aeqi_graph::GraphStore) -> Result<Option<GraphHealthBlob>> {
    for key in ["graph_health", "coverage_report", "health"] {
        if let Some(raw) = store.get_meta(key)? {
            if let Ok(blob) = serde_json::from_str::<GraphHealthBlob>(&raw) {
                return Ok(Some(blob));
            }
        }
    }
    Ok(None)
}

fn parse_string_list(raw: Option<String>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(items) = value.as_array() {
            return items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .filter(|item| !item.trim().is_empty())
                .collect();
        }
        if let Some(item) = value.as_str() {
            return vec![item.to_string()];
        }
    }

    trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_u32_meta(raw: &Option<String>) -> Option<u32> {
    raw.as_deref()?.trim().parse::<u32>().ok()
}

fn parse_f64_meta(raw: &Option<String>) -> Option<f64> {
    raw.as_deref()?.trim().parse::<f64>().ok()
}

fn coverage_summary(health: &GraphHealthSnapshot) -> Option<String> {
    match (
        health.coverage_ratio,
        health.indexed_files,
        health.expected_files,
    ) {
        (Some(ratio), Some(indexed), Some(expected)) if expected > 0 => {
            Some(format!("{:.1}% ({indexed}/{expected})", ratio * 100.0))
        }
        (Some(ratio), _, _) => Some(format!("{:.1}%", ratio * 100.0)),
        (None, Some(indexed), Some(expected)) if expected > 0 => {
            Some(format!("{indexed}/{expected}"))
        }
        _ => None,
    }
}

fn display_or(value: &Option<String>, fallback: &str) -> String {
    value.clone().unwrap_or_else(|| fallback.to_string())
}

fn preview_list(items: &[String], limit: usize) -> String {
    if items.len() <= limit {
        return items.join(", ");
    }
    let shown = items
        .iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    format!("{shown}, … (+{} more)", items.len() - limit)
}

fn same_path(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }

    let a = std::fs::canonicalize(a).unwrap_or_else(|_| a.to_path_buf());
    let b = std::fs::canonicalize(b).unwrap_or_else(|_| b.to_path_buf());
    a == b
}

fn render_graph_audit_report(report: &GraphAuditReport) {
    println!("Graph audit");
    println!(
        "  Roots: {} | healthy: {} | stale: {} | missing: {} | errors: {}",
        report.project_count,
        report.healthy_count,
        report.stale_count,
        report.missing_count,
        report.error_count,
    );

    for root in &report.roots {
        println!("  {} [{}]", root.name, root.status.to_uppercase());
        println!("    repo: {}", root.configured_repo);
        println!("    db:   {}", root.db_path);
        println!(
            "    repo present: {} | db present: {}",
            yes_no(root.repo_present),
            yes_no(root.db_present)
        );
        if let Some(stats) = &root.stats {
            println!(
                "    nodes: {} | edges: {} | files: {}",
                stats.node_count, stats.edge_count, stats.file_count
            );
        }
        println!("    freshness: {}", root.freshness_state);
        if let Some(indexed_at) = &root.health.indexed_at {
            println!("    indexed at: {indexed_at}");
        }
        if let Some(last_commit) = &root.health.last_commit {
            println!("    last commit: {last_commit}");
        }
        if let Some(summary) = coverage_summary(&root.health) {
            println!("    coverage: {summary}");
        }
        if !root.health.missing_subtrees.is_empty() {
            println!(
                "    missing subtrees: {}",
                root.health.missing_subtrees.join(", ")
            );
        }
        if !root.health.missing_files.is_empty() {
            println!(
                "    missing files: {}",
                preview_list(&root.health.missing_files, 6)
            );
        }
        if let Some(indexed_repo_path) = &root.indexed_repo_path {
            println!("    indexed repo: {indexed_repo_path}");
        }
        if !root.notes.is_empty() {
            println!("    note: {}", root.notes.join("; "));
        }
    }
}

fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

#[derive(Debug, Clone, Serialize)]
struct GraphAuditReport {
    generated_at: String,
    root_filter: Option<String>,
    project_count: usize,
    healthy_count: usize,
    stale_count: usize,
    missing_count: usize,
    error_count: usize,
    roots: Vec<GraphRootReport>,
}

#[derive(Debug, Clone, Serialize)]
struct GraphRootReport {
    name: String,
    configured_repo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    indexed_repo_path: Option<String>,
    db_path: String,
    repo_present: bool,
    db_present: bool,
    status: String,
    freshness_state: String,
    notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<aeqi_graph::GraphStats>,
    health: GraphHealthSnapshot,
}

#[derive(Debug, Clone, Default, Serialize)]
struct GraphHealthSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    repo_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    indexed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    indexed_files: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_files: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    coverage_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    missing_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    missing_subtrees: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    dirty_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    freshness_state: Option<String>,
}

impl GraphHealthSnapshot {
    fn effective_freshness(&self) -> String {
        let derived = if self.indexed_at.is_none() {
            "missing".to_string()
        } else if !self.dirty_files.is_empty()
            || !self.missing_files.is_empty()
            || !self.missing_subtrees.is_empty()
        {
            "stale".to_string()
        } else {
            match self.coverage_ratio {
                Some(ratio) if ratio < 0.999 => "partial".to_string(),
                _ => "fresh".to_string(),
            }
        };

        if let Some(state) = &self.freshness_state {
            let normalized = state.trim().to_lowercase();
            if normalized == "fresh" && derived != "fresh" {
                derived
            } else if normalized.is_empty() {
                derived
            } else {
                normalized
            }
        } else {
            derived
        }
    }
}

#[derive(Debug, Deserialize)]
struct GraphHealthBlob {
    #[serde(default)]
    repo_path: Option<String>,
    #[serde(default)]
    indexed_at: Option<String>,
    #[serde(default)]
    last_commit: Option<String>,
    #[serde(default)]
    indexed_files: Option<u32>,
    #[serde(default)]
    expected_files: Option<u32>,
    #[serde(default)]
    coverage_ratio: Option<f64>,
    #[serde(default)]
    missing_files: Option<Vec<String>>,
    #[serde(default)]
    missing_subtrees: Option<Vec<String>>,
    #[serde(default)]
    dirty_files: Option<Vec<String>>,
    #[serde(default)]
    freshness_state: Option<String>,
}
