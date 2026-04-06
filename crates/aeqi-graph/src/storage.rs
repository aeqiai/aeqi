use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

/// SQLite-backed code graph storage. One database per project.
pub struct GraphStore {
    conn: Connection,
}

impl GraphStore {
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.init()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.init()?;
        Ok(store)
    }

    fn init(&self) -> Result<()> {
        self.conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=-8000;
             PRAGMA temp_store=MEMORY;",
        )?;

        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS code_nodes (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                language TEXT NOT NULL,
                is_exported BOOLEAN NOT NULL DEFAULT 0,
                signature TEXT,
                doc_comment TEXT,
                community_id TEXT
            );

            CREATE TABLE IF NOT EXISTS code_edges (
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                edge_type TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 1.0,
                tier TEXT,
                step INTEGER,
                PRIMARY KEY (source_id, target_id, edge_type)
            );

            CREATE TABLE IF NOT EXISTS communities (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                file_count INTEGER NOT NULL DEFAULT 0,
                symbol_count INTEGER NOT NULL DEFAULT 0,
                cohesion REAL NOT NULL DEFAULT 0.0,
                keywords TEXT
            );

            CREATE TABLE IF NOT EXISTS processes (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                process_type TEXT NOT NULL,
                entry_id TEXT,
                terminal_id TEXT,
                step_count INTEGER NOT NULL DEFAULT 0,
                trace TEXT
            );

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_file ON code_nodes(file_path);
            CREATE INDEX IF NOT EXISTS idx_nodes_label ON code_nodes(label);
            CREATE INDEX IF NOT EXISTS idx_nodes_name ON code_nodes(name);
            CREATE INDEX IF NOT EXISTS idx_nodes_community ON code_nodes(community_id);
            CREATE INDEX IF NOT EXISTS idx_edges_source ON code_edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON code_edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_type ON code_edges(edge_type);

            CREATE VIRTUAL TABLE IF NOT EXISTS code_nodes_fts USING fts5(
                name, file_path, doc_comment,
                content='code_nodes',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS code_nodes_ai AFTER INSERT ON code_nodes BEGIN
                INSERT INTO code_nodes_fts(rowid, name, file_path, doc_comment)
                VALUES (new.rowid, new.name, new.file_path, new.doc_comment);
            END;

            CREATE TRIGGER IF NOT EXISTS code_nodes_ad AFTER DELETE ON code_nodes BEGIN
                INSERT INTO code_nodes_fts(code_nodes_fts, rowid, name, file_path, doc_comment)
                VALUES ('delete', old.rowid, old.name, old.file_path, old.doc_comment);
            END;

            CREATE TRIGGER IF NOT EXISTS code_nodes_au AFTER UPDATE ON code_nodes BEGIN
                INSERT INTO code_nodes_fts(code_nodes_fts, rowid, name, file_path, doc_comment)
                VALUES ('delete', old.rowid, old.name, old.file_path, old.doc_comment);
                INSERT INTO code_nodes_fts(rowid, name, file_path, doc_comment)
                VALUES (new.rowid, new.name, new.file_path, new.doc_comment);
            END;",
        )?;

        Ok(())
    }

    // --- Write operations ---

    pub fn upsert_node(&self, node: &CodeNode) -> Result<()> {
        self.conn.execute(
            "INSERT INTO code_nodes (id, label, name, file_path, start_line, end_line, language, is_exported, signature, doc_comment, community_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                label=excluded.label, name=excluded.name, file_path=excluded.file_path,
                start_line=excluded.start_line, end_line=excluded.end_line,
                is_exported=excluded.is_exported, signature=excluded.signature,
                doc_comment=excluded.doc_comment, community_id=excluded.community_id",
            params![
                node.id,
                node.label.as_str(),
                node.name,
                node.file_path,
                node.start_line,
                node.end_line,
                node.language,
                node.is_exported,
                node.signature,
                node.doc_comment,
                node.community_id,
            ],
        )?;
        Ok(())
    }

    pub fn upsert_edge(&self, edge: &CodeEdge) -> Result<()> {
        self.conn.execute(
            "INSERT INTO code_edges (source_id, target_id, edge_type, confidence, tier, step)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(source_id, target_id, edge_type) DO UPDATE SET
                confidence=MAX(excluded.confidence, code_edges.confidence),
                tier=excluded.tier, step=excluded.step",
            params![
                edge.source_id,
                edge.target_id,
                edge.edge_type.as_str(),
                edge.confidence,
                edge.tier,
                edge.step,
            ],
        )?;
        Ok(())
    }

    pub fn delete_file_nodes(&self, file_path: &str) -> Result<()> {
        // Delete edges where either end is in this file
        self.conn.execute(
            "DELETE FROM code_edges WHERE source_id IN (SELECT id FROM code_nodes WHERE file_path = ?1)
             OR target_id IN (SELECT id FROM code_nodes WHERE file_path = ?1)",
            params![file_path],
        )?;
        self.conn.execute(
            "DELETE FROM code_nodes WHERE file_path = ?1",
            params![file_path],
        )?;
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM code_edges;
             DELETE FROM code_nodes;
             DELETE FROM communities;
             DELETE FROM processes;
             DELETE FROM meta;",
        )?;
        Ok(())
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM meta WHERE key = ?1")?;
        let result = stmt.query_row(params![key], |row| row.get(0)).ok();
        Ok(result)
    }

    // --- Batch write (transaction) ---

    pub fn batch_insert(&self, nodes: &[CodeNode], edges: &[CodeEdge]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for node in nodes {
            tx.execute(
                "INSERT OR REPLACE INTO code_nodes (id, label, name, file_path, start_line, end_line, language, is_exported, signature, doc_comment, community_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    node.id, node.label.as_str(), node.name, node.file_path,
                    node.start_line, node.end_line, node.language, node.is_exported,
                    node.signature, node.doc_comment, node.community_id,
                ],
            )?;
        }
        for edge in edges {
            tx.execute(
                "INSERT OR REPLACE INTO code_edges (source_id, target_id, edge_type, confidence, tier, step)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    edge.source_id, edge.target_id, edge.edge_type.as_str(),
                    edge.confidence, edge.tier, edge.step,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // --- Read operations ---

    pub fn node_by_id(&self, id: &str) -> Result<Option<CodeNode>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, name, file_path, start_line, end_line, language, is_exported, signature, doc_comment, community_id
             FROM code_nodes WHERE id = ?1",
        )?;
        let result = stmt.query_row(params![id], |row| Ok(row_to_node(row))).ok();
        Ok(result)
    }

    pub fn nodes_in_file(&self, file_path: &str) -> Result<Vec<CodeNode>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, name, file_path, start_line, end_line, language, is_exported, signature, doc_comment, community_id
             FROM code_nodes WHERE file_path = ?1 ORDER BY start_line",
        )?;
        let nodes = stmt
            .query_map(params![file_path], |row| Ok(row_to_node(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(nodes)
    }

    pub fn search_nodes(&self, query: &str, limit: usize) -> Result<Vec<CodeNode>> {
        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.label, n.name, n.file_path, n.start_line, n.end_line, n.language, n.is_exported, n.signature, n.doc_comment, n.community_id
             FROM code_nodes_fts f
             JOIN code_nodes n ON n.rowid = f.rowid
             WHERE code_nodes_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let nodes = stmt
            .query_map(params![query, limit as u32], |row| Ok(row_to_node(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(nodes)
    }

    pub fn outgoing_edges(&self, node_id: &str) -> Result<Vec<(CodeEdge, Option<CodeNode>)>> {
        let mut stmt = self.conn.prepare(
            "SELECT e.source_id, e.target_id, e.edge_type, e.confidence, e.tier, e.step,
                    n.id, n.label, n.name, n.file_path, n.start_line, n.end_line, n.language, n.is_exported, n.signature, n.doc_comment, n.community_id
             FROM code_edges e
             LEFT JOIN code_nodes n ON n.id = e.target_id
             WHERE e.source_id = ?1",
        )?;
        let results = stmt
            .query_map(params![node_id], |row| {
                let edge = row_to_edge(row, 0);
                let node = if row.get::<_, Option<String>>(6)?.is_some() {
                    Some(row_to_node_offset(row, 6))
                } else {
                    None
                };
                Ok((edge, node))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }

    pub fn incoming_edges(&self, node_id: &str) -> Result<Vec<(CodeEdge, Option<CodeNode>)>> {
        let mut stmt = self.conn.prepare(
            "SELECT e.source_id, e.target_id, e.edge_type, e.confidence, e.tier, e.step,
                    n.id, n.label, n.name, n.file_path, n.start_line, n.end_line, n.language, n.is_exported, n.signature, n.doc_comment, n.community_id
             FROM code_edges e
             LEFT JOIN code_nodes n ON n.id = e.source_id
             WHERE e.target_id = ?1",
        )?;
        let results = stmt
            .query_map(params![node_id], |row| {
                let edge = row_to_edge(row, 0);
                let node = if row.get::<_, Option<String>>(6)?.is_some() {
                    Some(row_to_node_offset(row, 6))
                } else {
                    None
                };
                Ok((edge, node))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }

    /// 360° context: outgoing + incoming edges for a node.
    pub fn context(&self, node_id: &str) -> Result<NodeContext> {
        let node = self.node_by_id(node_id)?.context("node not found")?;
        let outgoing = self.outgoing_edges(node_id)?;
        let incoming = self.incoming_edges(node_id)?;

        let callers: Vec<_> = incoming
            .iter()
            .filter(|(e, _)| e.edge_type == EdgeType::Calls)
            .filter_map(|(_, n)| n.clone())
            .collect();
        let callees: Vec<_> = outgoing
            .iter()
            .filter(|(e, _)| e.edge_type == EdgeType::Calls)
            .filter_map(|(_, n)| n.clone())
            .collect();
        let implementors: Vec<_> = incoming
            .iter()
            .filter(|(e, _)| e.edge_type == EdgeType::Implements)
            .filter_map(|(_, n)| n.clone())
            .collect();

        Ok(NodeContext {
            node,
            callers,
            callees,
            implementors,
            outgoing_count: outgoing.len(),
            incoming_count: incoming.len(),
        })
    }

    /// Impact analysis: BFS outward from a set of nodes, collecting affected nodes.
    pub fn impact(&self, start_ids: &[&str], max_depth: u32) -> Result<Vec<ImpactEntry>> {
        let mut visited = std::collections::HashSet::new();
        let mut queue = std::collections::VecDeque::new();
        let mut results = Vec::new();

        for id in start_ids {
            visited.insert(id.to_string());
            queue.push_back((id.to_string(), 0u32));
        }

        while let Some((node_id, depth)) = queue.pop_front() {
            if depth > 0
                && let Some(node) = self.node_by_id(&node_id)?
            {
                results.push(ImpactEntry { node, depth });
            }
            if depth >= max_depth {
                continue;
            }
            let incoming = self.incoming_edges(&node_id)?;
            for (edge, _) in incoming {
                if matches!(
                    edge.edge_type,
                    EdgeType::Calls | EdgeType::Imports | EdgeType::Uses | EdgeType::Implements
                ) && edge.confidence >= 0.5
                    && !visited.contains(&edge.source_id)
                {
                    visited.insert(edge.source_id.clone());
                    queue.push_back((edge.source_id, depth + 1));
                }
            }
        }

        results.sort_by_key(|e| e.depth);
        Ok(results)
    }

    /// Compact one-line summary of a file's contents for hook injection.
    pub fn file_summary(&self, file_path: &str) -> Result<Option<String>> {
        let nodes = self.nodes_in_file(file_path)?;
        if nodes.is_empty() {
            return Ok(None);
        }

        let symbols: Vec<&CodeNode> = nodes
            .iter()
            .filter(|n| {
                !matches!(
                    n.label,
                    NodeLabel::File | NodeLabel::Module | NodeLabel::Community | NodeLabel::Process
                )
            })
            .collect();

        if symbols.is_empty() {
            return Ok(None);
        }

        // Count by type
        let mut type_counts: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::new();
        for s in &symbols {
            *type_counts.entry(s.label.as_str()).or_default() += 1;
        }
        let mut counts: Vec<_> = type_counts.into_iter().collect();
        counts.sort_by(|a, b| b.1.cmp(&a.1));
        let type_summary: Vec<String> = counts
            .iter()
            .take(4)
            .map(|(label, count)| format!("{count} {label}s"))
            .collect();

        // Top exported symbols
        let exported: Vec<&str> = symbols
            .iter()
            .filter(|s| s.is_exported)
            .take(5)
            .map(|s| s.name.as_str())
            .collect();

        // Count incoming edges for this file's symbols
        let node_ids: Vec<&str> = symbols.iter().map(|s| s.id.as_str()).collect();
        let mut total_callers = 0usize;
        for id in &node_ids {
            let incoming = self.incoming_edges(id)?;
            total_callers += incoming
                .iter()
                .filter(|(e, _)| e.edge_type == EdgeType::Calls)
                .count();
        }

        let mut parts = vec![type_summary.join(", ")];
        if !exported.is_empty() {
            parts.push(format!("exports: {}", exported.join(", ")));
        }
        if total_callers > 0 {
            parts.push(format!("{total_callers} callers"));
        }

        Ok(Some(parts.join(" | ")))
    }

    /// Find symbols that overlap with given line ranges (for diff-to-symbol mapping).
    pub fn symbols_at_lines(
        &self,
        file_path: &str,
        line_ranges: &[(u32, u32)],
    ) -> Result<Vec<CodeNode>> {
        let nodes = self.nodes_in_file(file_path)?;
        let mut matched = Vec::new();
        let mut seen = std::collections::HashSet::new();

        for node in &nodes {
            if matches!(
                node.label,
                NodeLabel::File | NodeLabel::Module | NodeLabel::Community | NodeLabel::Process
            ) {
                continue;
            }
            for &(start, end) in line_ranges {
                // Symbol overlaps if it starts before range end AND ends after range start
                if node.start_line <= end && node.end_line >= start && !seen.contains(&node.id) {
                    seen.insert(node.id.clone());
                    matched.push(node.clone());
                }
            }
        }

        Ok(matched)
    }

    pub fn stats(&self) -> Result<GraphStats> {
        let node_count: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM code_nodes", [], |r| r.get(0))?;
        let edge_count: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM code_edges", [], |r| r.get(0))?;
        let file_count: u32 = self.conn.query_row(
            "SELECT COUNT(DISTINCT file_path) FROM code_nodes",
            [],
            |r| r.get(0),
        )?;
        Ok(GraphStats {
            node_count,
            edge_count,
            file_count,
        })
    }
}

/// 360° context around a single node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeContext {
    pub node: CodeNode,
    pub callers: Vec<CodeNode>,
    pub callees: Vec<CodeNode>,
    pub implementors: Vec<CodeNode>,
    pub outgoing_count: usize,
    pub incoming_count: usize,
}

/// An affected node from impact analysis.
#[derive(Debug, Clone)]
pub struct ImpactEntry {
    pub node: CodeNode,
    pub depth: u32,
}

/// Basic graph statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphStats {
    pub node_count: u32,
    pub edge_count: u32,
    pub file_count: u32,
}

// --- Row mapping helpers ---

fn row_to_node(row: &rusqlite::Row) -> CodeNode {
    row_to_node_offset(row, 0)
}

fn row_to_node_offset(row: &rusqlite::Row, offset: usize) -> CodeNode {
    let label_str: String = row.get(offset + 1).unwrap_or_default();
    CodeNode {
        id: row.get(offset).unwrap_or_default(),
        label: serde_json::from_str(&format!("\"{}\"", label_str)).unwrap_or(NodeLabel::Function),
        name: row.get(offset + 2).unwrap_or_default(),
        file_path: row.get(offset + 3).unwrap_or_default(),
        start_line: row.get(offset + 4).unwrap_or(0),
        end_line: row.get(offset + 5).unwrap_or(0),
        language: row.get(offset + 6).unwrap_or_default(),
        is_exported: row.get(offset + 7).unwrap_or(false),
        signature: row.get(offset + 8).unwrap_or(None),
        doc_comment: row.get(offset + 9).unwrap_or(None),
        community_id: row.get(offset + 10).unwrap_or(None),
    }
}

fn row_to_edge(row: &rusqlite::Row, offset: usize) -> CodeEdge {
    let edge_type_str: String = row.get(offset + 2).unwrap_or_default();
    CodeEdge {
        source_id: row.get(offset).unwrap_or_default(),
        target_id: row.get(offset + 1).unwrap_or_default(),
        edge_type: serde_json::from_str(&format!("\"{}\"", edge_type_str))
            .unwrap_or(EdgeType::Uses),
        confidence: row.get(offset + 3).unwrap_or(1.0),
        tier: row.get(offset + 4).unwrap_or(None),
        step: row.get(offset + 5).unwrap_or(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;

    #[test]
    fn create_and_query_nodes() {
        let store = GraphStore::open_in_memory().unwrap();

        let node = CodeNode::new(
            NodeLabel::Function,
            "my_function",
            "src/main.rs",
            10,
            25,
            "rust",
        )
        .with_exported(true)
        .with_signature("fn my_function(x: u32) -> bool");

        store.upsert_node(&node).unwrap();

        let found = store.nodes_in_file("src/main.rs").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "my_function");
        assert!(found[0].is_exported);
    }

    #[test]
    fn edges_and_context() {
        let store = GraphStore::open_in_memory().unwrap();

        let caller = CodeNode::new(NodeLabel::Function, "main", "src/main.rs", 1, 10, "rust");
        let callee = CodeNode::new(NodeLabel::Function, "helper", "src/lib.rs", 5, 15, "rust");

        store.upsert_node(&caller).unwrap();
        store.upsert_node(&callee).unwrap();

        let edge = CodeEdge::new(&caller.id, &callee.id, EdgeType::Calls)
            .with_tier(ResolutionTier::ImportScoped);
        store.upsert_edge(&edge).unwrap();

        let ctx = store.context(&callee.id).unwrap();
        assert_eq!(ctx.callers.len(), 1);
        assert_eq!(ctx.callers[0].name, "main");
    }

    #[test]
    fn fts_search() {
        let store = GraphStore::open_in_memory().unwrap();

        store
            .upsert_node(
                &CodeNode::new(NodeLabel::Trait, "Observer", "src/traits.rs", 1, 50, "rust")
                    .with_doc("Observability trait for metrics"),
            )
            .unwrap();
        store
            .upsert_node(&CodeNode::new(
                NodeLabel::Function,
                "observe_metrics",
                "src/lib.rs",
                10,
                20,
                "rust",
            ))
            .unwrap();

        let results = store.search_nodes("Observer", 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].name, "Observer");
    }

    #[test]
    fn impact_analysis() {
        let store = GraphStore::open_in_memory().unwrap();

        let a = CodeNode::new(NodeLabel::Trait, "Observer", "core.rs", 1, 10, "rust");
        let b = CodeNode::new(NodeLabel::Struct, "LogObserver", "log.rs", 1, 10, "rust");
        let c = CodeNode::new(
            NodeLabel::Function,
            "setup_logging",
            "setup.rs",
            1,
            10,
            "rust",
        );

        store.upsert_node(&a).unwrap();
        store.upsert_node(&b).unwrap();
        store.upsert_node(&c).unwrap();

        store
            .upsert_edge(&CodeEdge::new(&b.id, &a.id, EdgeType::Implements).with_confidence(0.95))
            .unwrap();
        store
            .upsert_edge(&CodeEdge::new(&c.id, &b.id, EdgeType::Calls).with_confidence(0.9))
            .unwrap();

        let impact = store.impact(&[&a.id], 3).unwrap();
        assert_eq!(impact.len(), 2);
        assert_eq!(impact[0].node.name, "LogObserver");
        assert_eq!(impact[0].depth, 1);
        assert_eq!(impact[1].node.name, "setup_logging");
        assert_eq!(impact[1].depth, 2);
    }

    #[test]
    fn batch_insert_and_stats() {
        let store = GraphStore::open_in_memory().unwrap();

        let nodes = vec![
            CodeNode::new(NodeLabel::Function, "a", "f.rs", 1, 5, "rust"),
            CodeNode::new(NodeLabel::Function, "b", "f.rs", 6, 10, "rust"),
        ];
        let edges = vec![CodeEdge::new(&nodes[0].id, &nodes[1].id, EdgeType::Calls)];

        store.batch_insert(&nodes, &edges).unwrap();

        let stats = store.stats().unwrap();
        assert_eq!(stats.node_count, 2);
        assert_eq!(stats.edge_count, 1);
        assert_eq!(stats.file_count, 1);
    }

    #[test]
    fn delete_file_cascades() {
        let store = GraphStore::open_in_memory().unwrap();

        let a = CodeNode::new(NodeLabel::Function, "a", "keep.rs", 1, 5, "rust");
        let b = CodeNode::new(NodeLabel::Function, "b", "delete.rs", 1, 5, "rust");
        store.upsert_node(&a).unwrap();
        store.upsert_node(&b).unwrap();
        store
            .upsert_edge(&CodeEdge::new(&a.id, &b.id, EdgeType::Calls))
            .unwrap();

        store.delete_file_nodes("delete.rs").unwrap();

        let stats = store.stats().unwrap();
        assert_eq!(stats.node_count, 1);
        assert_eq!(stats.edge_count, 0);
    }
}
