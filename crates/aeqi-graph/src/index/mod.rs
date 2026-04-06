use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

use crate::analysis::{community::detect_communities, process::detect_processes};
use crate::extract::resolve::resolve_graph;
use crate::parser::LanguageProvider;
use crate::parser::rust::RustProvider;
use crate::parser::solidity::SolidityProvider;
use crate::parser::typescript::TypeScriptProvider;
use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};
use crate::storage::GraphStore;

/// Index a project directory into a code graph.
pub struct Indexer {
    providers: Vec<Box<dyn LanguageProvider>>,
}

impl Indexer {
    pub fn new() -> Self {
        Self {
            providers: vec![
                Box::new(RustProvider::new()),
                Box::new(TypeScriptProvider::new()),
                Box::new(SolidityProvider::new()),
            ],
        }
    }

    /// Full index of a project directory. Parses all supported files,
    /// resolves symbols, detects communities and processes, stores everything.
    pub fn index(&self, project_dir: &Path, store: &GraphStore) -> Result<IndexResult> {
        info!(dir = %project_dir.display(), "indexing project");

        store.clear()?;

        // Phase 1: Collect source files
        let files = self.collect_files(project_dir)?;
        info!(files = files.len(), "found source files");

        // Phase 2: Parse all files
        let mut all_nodes: Vec<CodeNode> = Vec::new();
        let mut all_edges: Vec<CodeEdge> = Vec::new();
        let mut parse_errors = 0usize;

        for (file_path, rel_path, provider_idx) in &files {
            let source = match std::fs::read_to_string(file_path) {
                Ok(s) => s,
                Err(e) => {
                    warn!(file = %rel_path, error = %e, "failed to read file");
                    parse_errors += 1;
                    continue;
                }
            };

            match self.providers[*provider_idx].extract(&source, rel_path) {
                Ok(extraction) => {
                    all_nodes.extend(extraction.nodes);
                    all_edges.extend(extraction.edges);
                }
                Err(e) => {
                    warn!(file = %rel_path, error = %e, "parse failed");
                    parse_errors += 1;
                }
            }
        }

        info!(
            nodes = all_nodes.len(),
            edges = all_edges.len(),
            errors = parse_errors,
            "parsing complete"
        );

        // Phase 2.5: Build type environments for Rust files (enables type-aware call resolution)
        let mut type_envs = std::collections::HashMap::new();
        for (file_path, rel_path, provider_idx) in &files {
            if self.providers[*provider_idx].language_id() == "rust"
                && let Ok(source) = std::fs::read_to_string(file_path)
            {
                let env = crate::extract::types::build_type_env_rust(&source, rel_path);
                if env.binding_count() > 0 {
                    type_envs.insert(rel_path.clone(), env);
                }
            }
        }
        if !type_envs.is_empty() {
            info!(
                files_with_types = type_envs.len(),
                "type environments built"
            );
        }

        // Phase 3: Resolve symbols (with type-aware resolution)
        let (resolved_edges, unresolved_count) = resolve_graph(&all_nodes, all_edges, &type_envs);
        info!(
            resolved = resolved_edges.len(),
            unresolved = unresolved_count,
            "resolution complete"
        );

        // Phase 4: Community detection
        let communities = detect_communities(&all_nodes, &resolved_edges, 3);
        info!(
            communities = communities.len(),
            "community detection complete"
        );

        // Assign community IDs to nodes
        for community in &communities {
            for member_id in &community.members {
                if let Some(node) = all_nodes.iter_mut().find(|n| n.id == *member_id) {
                    node.community_id = Some(community.id.clone());
                }
            }
        }

        // Phase 5: Process detection
        let processes = detect_processes(&all_nodes, &resolved_edges, 10, 75);
        info!(processes = processes.len(), "process detection complete");

        // Phase 6: Store everything
        store.batch_insert(&all_nodes, &resolved_edges)?;

        // Store communities
        for community in &communities {
            store.upsert_node(&CodeNode {
                id: community.id.clone(),
                label: NodeLabel::Community,
                name: community.label.clone(),
                file_path: String::new(),
                start_line: 0,
                end_line: 0,
                language: String::new(),
                is_exported: false,
                signature: None,
                doc_comment: Some(format!(
                    "{} files, {} symbols, cohesion: {:.2}",
                    community.file_count, community.symbol_count, community.cohesion
                )),
                community_id: None,
            })?;
        }

        // Store processes
        for process in &processes {
            store.upsert_node(&CodeNode {
                id: process.id.clone(),
                label: NodeLabel::Process,
                name: process.label.clone(),
                file_path: String::new(),
                start_line: 0,
                end_line: 0,
                language: String::new(),
                is_exported: false,
                signature: None,
                doc_comment: Some(format!(
                    "{} steps, type: {}",
                    process.step_count,
                    process.process_type.as_str()
                )),
                community_id: None,
            })?;

            // Create STEP_IN_PROCESS edges
            for (step, node_id) in process.trace.iter().enumerate() {
                store.upsert_edge(
                    &CodeEdge::new(node_id, &process.id, EdgeType::StepInProcess)
                        .with_step(step as u32 + 1),
                )?;
            }
        }

        // Store metadata + git commit for incremental tracking
        store.set_meta("indexed_at", &chrono::Utc::now().to_rfc3339())?;
        store.set_meta("file_count", &files.len().to_string())?;
        if let Some(commit) = std::process::Command::new("git")
            .args(["rev-parse", "--short", "HEAD"])
            .current_dir(project_dir)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        {
            store.set_meta("last_commit", &commit)?;
        }

        let stats = store.stats()?;
        info!(
            nodes = stats.node_count,
            edges = stats.edge_count,
            files = stats.file_count,
            "indexing complete"
        );

        Ok(IndexResult {
            files_parsed: files.len(),
            parse_errors,
            nodes: stats.node_count as usize,
            edges: stats.edge_count as usize,
            communities: communities.len(),
            processes: processes.len(),
            unresolved: unresolved_count,
        })
    }

    /// Walk the project directory and collect all supported source files.
    fn collect_files(&self, root: &Path) -> Result<Vec<(PathBuf, String, usize)>> {
        let mut files = Vec::new();
        self.walk_dir(root, root, &mut files)?;
        Ok(files)
    }

    fn walk_dir(
        &self,
        dir: &Path,
        root: &Path,
        files: &mut Vec<(PathBuf, String, usize)>,
    ) -> Result<()> {
        let entries = std::fs::read_dir(dir)
            .with_context(|| format!("reading directory: {}", dir.display()))?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden dirs, target/, node_modules/, .git
            if name.starts_with('.')
                || name == "target"
                || name == "node_modules"
                || name == "vendor"
                || name == ".git"
            {
                continue;
            }

            if path.is_dir() {
                self.walk_dir(&path, root, files)?;
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                for (idx, provider) in self.providers.iter().enumerate() {
                    if provider.extensions().contains(&ext) {
                        let rel_path = path
                            .strip_prefix(root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .to_string();
                        files.push((path.clone(), rel_path, idx));
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    /// Incremental index: only re-parse files changed since last indexed commit.
    /// Falls back to full index if no previous commit is stored.
    pub fn index_incremental(&self, project_dir: &Path, store: &GraphStore) -> Result<IndexResult> {
        let last_commit = store.get_meta("last_commit")?;

        // Get current HEAD
        let head = std::process::Command::new("git")
            .args(["rev-parse", "--short", "HEAD"])
            .current_dir(project_dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });

        let head_commit = match &head {
            Some(h) => h.as_str(),
            None => return self.index(project_dir, store), // No git, full index
        };

        let last = match &last_commit {
            Some(c) if !c.is_empty() => c.as_str(),
            _ => return self.index(project_dir, store), // No previous index, full
        };

        if last == head_commit {
            info!(
                "graph is current (commit {}), skipping re-index",
                head_commit
            );
            let stats = store.stats()?;
            return Ok(IndexResult {
                files_parsed: 0,
                parse_errors: 0,
                nodes: stats.node_count as usize,
                edges: stats.edge_count as usize,
                communities: 0,
                processes: 0,
                unresolved: 0,
            });
        }

        // Get changed files since last indexed commit
        let diff_output = std::process::Command::new("git")
            .args(["diff", "--name-only", last, head_commit])
            .current_dir(project_dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).to_string())
                } else {
                    None
                }
            });

        let changed_files: Vec<String> = match diff_output {
            Some(output) => output.lines().map(String::from).collect(),
            None => return self.index(project_dir, store), // diff failed, full index
        };

        if changed_files.is_empty() {
            store.set_meta("last_commit", head_commit)?;
            let stats = store.stats()?;
            return Ok(IndexResult {
                files_parsed: 0,
                parse_errors: 0,
                nodes: stats.node_count as usize,
                edges: stats.edge_count as usize,
                communities: 0,
                processes: 0,
                unresolved: 0,
            });
        }

        info!(
            changed = changed_files.len(),
            from = last,
            to = head_commit,
            "incremental index"
        );

        // Delete nodes/edges for changed files
        for file in &changed_files {
            store.delete_file_nodes(file)?;
        }

        // Re-parse changed files
        let mut new_nodes = Vec::new();
        let mut new_edges = Vec::new();
        let mut parse_errors = 0;

        for rel_path in &changed_files {
            let abs_path = project_dir.join(rel_path);
            if !abs_path.exists() {
                continue; // File was deleted
            }

            let ext = abs_path.extension().and_then(|e| e.to_str()).unwrap_or("");

            for provider in &self.providers {
                if provider.extensions().contains(&ext) {
                    let source = match std::fs::read_to_string(&abs_path) {
                        Ok(s) => s,
                        Err(_) => {
                            parse_errors += 1;
                            continue;
                        }
                    };
                    match provider.extract(&source, rel_path) {
                        Ok(extraction) => {
                            new_nodes.extend(extraction.nodes);
                            new_edges.extend(extraction.edges);
                        }
                        Err(_) => parse_errors += 1,
                    }
                    break;
                }
            }
        }

        // Resolve new symbols against existing + new nodes
        // For incremental, we need all existing nodes for the symbol table
        let all_files: Vec<String> = {
            let mut stmt = store.conn().prepare(
                "SELECT DISTINCT file_path FROM code_nodes WHERE label != 'community' AND label != 'process'"
            )?;
            stmt.query_map([], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let mut existing_nodes = Vec::new();
        for fp in &all_files {
            existing_nodes.extend(store.nodes_in_file(fp)?);
        }
        existing_nodes.extend(new_nodes.iter().cloned());

        let (resolved, unresolved) = resolve_graph(
            &existing_nodes,
            new_edges,
            &std::collections::HashMap::new(),
        );

        // Store the new nodes and resolved edges
        store.batch_insert(&new_nodes, &resolved)?;

        store.set_meta("last_commit", head_commit)?;
        store.set_meta("indexed_at", &chrono::Utc::now().to_rfc3339())?;

        let stats = store.stats()?;
        info!(
            changed = changed_files.len(),
            new_nodes = new_nodes.len(),
            new_edges = resolved.len(),
            "incremental index complete"
        );

        Ok(IndexResult {
            files_parsed: changed_files.len(),
            parse_errors,
            nodes: stats.node_count as usize,
            edges: stats.edge_count as usize,
            communities: 0, // Skip community/process re-detection on incremental
            processes: 0,
            unresolved,
        })
    }

    /// Compute impact of current uncommitted changes (git diff → symbols → blast radius).
    pub fn diff_impact(
        &self,
        project_dir: &Path,
        store: &GraphStore,
        max_depth: u32,
    ) -> Result<DiffImpact> {
        // Get unstaged + staged diff
        let diff_output = std::process::Command::new("git")
            .args(["diff", "--unified=0", "HEAD"])
            .current_dir(project_dir)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        if diff_output.is_empty() {
            return Ok(DiffImpact {
                changed_files: vec![],
                changed_symbols: vec![],
                affected: vec![],
            });
        }

        // Parse diff hunks to get file + line ranges
        let mut file_changes: Vec<(String, Vec<(u32, u32)>)> = Vec::new();
        let mut current_file = String::new();
        let mut current_ranges: Vec<(u32, u32)> = Vec::new();

        for line in diff_output.lines() {
            if let Some(file) = line.strip_prefix("+++ b/") {
                if !current_file.is_empty() {
                    file_changes.push((current_file.clone(), current_ranges.clone()));
                    current_ranges.clear();
                }
                current_file = file.to_string();
            } else if line.starts_with("@@ ") {
                // Parse hunk header: @@ -old,count +new,count @@
                if let Some(plus) = line.find('+') {
                    let rest = &line[plus + 1..];
                    if let Some(space) = rest.find(' ') {
                        let range_str = &rest[..space];
                        let parts: Vec<&str> = range_str.split(',').collect();
                        let start: u32 = parts[0].parse().unwrap_or(0);
                        let count: u32 = parts.get(1).and_then(|c| c.parse().ok()).unwrap_or(1);
                        if start > 0 {
                            current_ranges.push((start, start + count.max(1) - 1));
                        }
                    }
                }
            }
        }
        if !current_file.is_empty() {
            file_changes.push((current_file, current_ranges));
        }

        // Map changed lines to symbols
        let mut changed_symbols = Vec::new();
        let mut changed_files = Vec::new();
        for (file, ranges) in &file_changes {
            changed_files.push(file.clone());
            if !ranges.is_empty() {
                let symbols = store.symbols_at_lines(file, ranges)?;
                changed_symbols.extend(symbols);
            }
        }

        // Compute blast radius from all changed symbols
        let symbol_ids: Vec<&str> = changed_symbols.iter().map(|s| s.id.as_str()).collect();
        let affected = if !symbol_ids.is_empty() {
            store.impact(&symbol_ids, max_depth)?
        } else {
            vec![]
        };

        Ok(DiffImpact {
            changed_files,
            changed_symbols,
            affected,
        })
    }
}

impl Default for Indexer {
    fn default() -> Self {
        Self::new()
    }
}

/// Result of diff-aware impact analysis.
#[derive(Debug, Clone)]
pub struct DiffImpact {
    pub changed_files: Vec<String>,
    pub changed_symbols: Vec<CodeNode>,
    pub affected: Vec<crate::storage::ImpactEntry>,
}

/// Result of a project indexing operation.
#[derive(Debug, Clone)]
pub struct IndexResult {
    pub files_parsed: usize,
    pub parse_errors: usize,
    pub nodes: usize,
    pub edges: usize,
    pub communities: usize,
    pub processes: usize,
    pub unresolved: usize,
}

impl std::fmt::Display for IndexResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} files, {} nodes, {} edges, {} communities, {} processes ({} unresolved)",
            self.files_parsed,
            self.nodes,
            self.edges,
            self.communities,
            self.processes,
            self.unresolved,
        )
    }
}
