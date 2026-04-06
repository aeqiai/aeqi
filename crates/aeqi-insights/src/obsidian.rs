//! Obsidian vault export/import for the insight store.
//!
//! Each insight becomes a `.md` file with YAML frontmatter.
//! Graph edges become `[[wikilinks]]` — Obsidian's graph view
//! renders the memory graph for free.
//!
//! ## Vault layout
//!
//! ```text
//! vault/
//!   fact/
//!     auth-system.md
//!   procedure/
//!     deploy-process.md
//!   preference/
//!     ...
//!   context/
//!     ...
//!   evergreen/
//!     ...
//! ```

use crate::graph::MemoryEdge;
use crate::sqlite::SqliteInsights;
use aeqi_core::traits::{InsightCategory, InsightEntry};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;
use tracing::{debug, info, warn};

// ── Export ──────────────────────────────────────────────────────────────────

/// Export all memories to an Obsidian vault directory.
///
/// Returns the number of files written.
pub fn export(store: &SqliteInsights, vault_dir: &Path) -> Result<usize> {
    let entries = store.list_all()?;
    if entries.is_empty() {
        info!("no memories to export");
        return Ok(0);
    }

    // Build ID → key lookup for wikilinks.
    let id_to_key: HashMap<&str, &str> = entries
        .iter()
        .map(|e| (e.id.as_str(), e.key.as_str()))
        .collect();

    // Fetch all edges.
    let all_ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
    let edges = store.fetch_edges_for_set(&all_ids).unwrap_or_default();

    // Group edges by source/target ID for quick lookup.
    let mut edges_by_id: HashMap<&str, Vec<&MemoryEdge>> = HashMap::new();
    for edge in &edges {
        edges_by_id
            .entry(edge.source_id.as_str())
            .or_default()
            .push(edge);
        edges_by_id
            .entry(edge.target_id.as_str())
            .or_default()
            .push(edge);
    }

    let mut written = 0;
    for entry in &entries {
        let cat_dir = category_dir(&entry.category);
        let dir = vault_dir.join(cat_dir);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create dir: {}", dir.display()))?;

        let filename = sanitize_filename(&entry.key);
        let path = dir.join(format!("{filename}.md"));

        let entry_edges = edges_by_id.get(entry.id.as_str());
        let md = render_markdown(entry, entry_edges, &id_to_key);

        std::fs::write(&path, md).with_context(|| format!("failed to write {}", path.display()))?;
        debug!(key = %entry.key, path = %path.display(), "exported memory");
        written += 1;
    }

    info!(count = written, vault = %vault_dir.display(), "obsidian export complete");
    Ok(written)
}

/// Render a single insight as Obsidian-compatible markdown.
fn render_markdown(
    entry: &InsightEntry,
    edges: Option<&Vec<&MemoryEdge>>,
    id_to_key: &HashMap<&str, &str>,
) -> String {
    let cat = category_str(&entry.category);
    let agent = entry
        .agent_id
        .as_deref()
        .map(|a| format!("\"{a}\""))
        .unwrap_or_else(|| "null".to_string());
    let created = entry.created_at.to_rfc3339();

    let mut md = format!(
        "---\n\
         id: \"{}\"\n\
         key: \"{}\"\n\
         category: {cat}\n\
         agent_id: {agent}\n\
         created_at: \"{created}\"\n\
         tags:\n\
         - aeqi\n\
         - {cat}\n\
         ---\n\n\
         {}\n",
        entry.id, entry.key, entry.content
    );

    // Append relations as wikilinks.
    if let Some(edge_list) = edges
        && !edge_list.is_empty()
    {
        md.push_str("\n---\n\n## Relations\n\n");
        for edge in edge_list {
            let (other_id, direction) = if edge.source_id == entry.id {
                (edge.target_id.as_str(), "→")
            } else {
                (edge.source_id.as_str(), "←")
            };
            let other_key = id_to_key.get(other_id).copied().unwrap_or(other_id);
            md.push_str(&format!(
                "- {direction} [[{other_key}]] — {} ({:.2})\n",
                edge.relation, edge.strength
            ));
        }
    }

    md
}

// ── Import ─────────────────────────────────────────────────────────────────

/// A parsed Obsidian memory file ready for ingestion.
#[derive(Debug)]
pub struct ParsedMemory {
    pub id: Option<String>,
    pub key: String,
    pub content: String,
    pub category: InsightCategory,
    pub agent_id: Option<String>,
    pub relations: Vec<ParsedRelation>,
}

#[derive(Debug)]
pub struct ParsedRelation {
    pub target_key: String,
    pub relation: String,
    pub strength: f32,
}

/// Import memories from an Obsidian vault into the store.
///
/// Returns (imported, skipped) counts.
pub async fn import(store: &SqliteInsights, vault_dir: &Path) -> Result<(usize, usize)> {
    use aeqi_core::traits::Insight;

    let parsed = scan_vault(vault_dir)?;
    if parsed.is_empty() {
        info!("no memory files found in vault");
        return Ok((0, 0));
    }

    let mut imported = 0;
    let mut skipped = 0;

    // First pass: store all memories.
    let mut key_to_id: HashMap<String, String> = HashMap::new();

    for mem in &parsed {
        match store
            .store(
                &mem.key,
                &mem.content,
                mem.category.clone(),
                mem.agent_id.as_deref(),
            )
            .await
        {
            Ok(id) if id.is_empty() => {
                debug!(key = %mem.key, "skipped (duplicate)");
                skipped += 1;
            }
            Ok(id) => {
                debug!(key = %mem.key, id = %id, "imported");
                key_to_id.insert(mem.key.clone(), id);
                imported += 1;
            }
            Err(e) => {
                warn!(key = %mem.key, err = %e, "failed to import");
                skipped += 1;
            }
        }
    }

    // Second pass: restore edges using key→ID mapping.
    // Also include existing memories for edge resolution.
    let existing = store.list_all()?;
    for entry in &existing {
        key_to_id
            .entry(entry.key.clone())
            .or_insert_with(|| entry.id.clone());
    }

    for mem in &parsed {
        if mem.relations.is_empty() {
            continue;
        }
        let Some(source_id) = key_to_id.get(&mem.key) else {
            continue;
        };
        for rel in &mem.relations {
            let Some(target_id) = key_to_id.get(&rel.target_key) else {
                debug!(
                    source = %mem.key,
                    target = %rel.target_key,
                    "skipping edge — target not found"
                );
                continue;
            };
            if let Err(e) = store
                .store_insight_edge(source_id, target_id, &rel.relation, rel.strength)
                .await
            {
                warn!(
                    source = %mem.key,
                    target = %rel.target_key,
                    err = %e,
                    "failed to store edge"
                );
            }
        }
    }

    info!(imported, skipped, vault = %vault_dir.display(), "obsidian import complete");
    Ok((imported, skipped))
}

/// Scan an Obsidian vault directory for memory markdown files.
fn scan_vault(vault_dir: &Path) -> Result<Vec<ParsedMemory>> {
    let mut results = Vec::new();

    for cat_name in &["fact", "procedure", "preference", "context", "evergreen"] {
        let cat_dir = vault_dir.join(cat_name);
        if !cat_dir.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(&cat_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            match parse_memory_file(&path) {
                Ok(mem) => results.push(mem),
                Err(e) => warn!(path = %path.display(), err = %e, "failed to parse"),
            }
        }
    }

    // Also scan root-level .md files (flat vault layout).
    if vault_dir.is_dir() {
        for entry in std::fs::read_dir(vault_dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            // Skip if already parsed from a category subdirectory.
            if results.iter().any(|m| {
                let fname = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                m.key == fname
            }) {
                continue;
            }
            match parse_memory_file(&path) {
                Ok(mem) => results.push(mem),
                Err(e) => warn!(path = %path.display(), err = %e, "failed to parse"),
            }
        }
    }

    Ok(results)
}

/// Parse a single Obsidian markdown file into a `ParsedMemory`.
fn parse_memory_file(path: &Path) -> Result<ParsedMemory> {
    let raw =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;

    let (frontmatter, body) = split_frontmatter(&raw);

    // Extract fields from frontmatter.
    let id = extract_field(&frontmatter, "id");
    let key = extract_field(&frontmatter, "key").unwrap_or_else(|| {
        // Fall back to filename.
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string()
    });
    let category = extract_field(&frontmatter, "category")
        .and_then(|c| parse_category(&c))
        .unwrap_or(InsightCategory::Fact);
    let agent_id = extract_field(&frontmatter, "agent_id").filter(|s| s != "null" && !s.is_empty());

    // Split body into content and relations.
    let (content, relations) = split_relations(&body);

    Ok(ParsedMemory {
        id,
        key,
        content: content.trim().to_string(),
        category,
        agent_id,
        relations,
    })
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn category_dir(cat: &InsightCategory) -> &'static str {
    match cat {
        InsightCategory::Fact => "fact",
        InsightCategory::Procedure => "procedure",
        InsightCategory::Preference => "preference",
        InsightCategory::Context => "context",
        InsightCategory::Evergreen => "evergreen",
    }
}

fn category_str(cat: &InsightCategory) -> &'static str {
    category_dir(cat)
}

fn parse_category(s: &str) -> Option<InsightCategory> {
    match s.trim().to_lowercase().as_str() {
        "fact" => Some(InsightCategory::Fact),
        "procedure" => Some(InsightCategory::Procedure),
        "preference" => Some(InsightCategory::Preference),
        "context" => Some(InsightCategory::Context),
        "evergreen" => Some(InsightCategory::Evergreen),
        _ => None,
    }
}

fn sanitize_filename(key: &str) -> String {
    key.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Split `---\nfrontmatter\n---\nbody` into (frontmatter_lines, body).
fn split_frontmatter(raw: &str) -> (String, String) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return (String::new(), raw.to_string());
    }
    // Skip the opening "---"
    let after_open = &trimmed[3..];
    if let Some(close_pos) = after_open.find("\n---") {
        let fm = after_open[..close_pos].trim().to_string();
        let body = after_open[close_pos + 4..].to_string();
        (fm, body)
    } else {
        (String::new(), raw.to_string())
    }
}

/// Extract a simple `key: value` or `key: "value"` from YAML-like frontmatter.
fn extract_field(frontmatter: &str, field: &str) -> Option<String> {
    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(&format!("{field}:")) {
            let val = rest.trim().trim_matches('"').to_string();
            if val.is_empty() || val == "null" {
                return None;
            }
            return Some(val);
        }
    }
    None
}

/// Split body into content (before `## Relations`) and parsed relations.
fn split_relations(body: &str) -> (String, Vec<ParsedRelation>) {
    if let Some(pos) = body.find("## Relations") {
        let content = body[..pos].trim_end().to_string();
        let relations_section = &body[pos..];
        let relations = parse_relations(relations_section);
        (content, relations)
    } else {
        (body.to_string(), Vec::new())
    }
}

/// Parse `- → [[key]] — relation (0.80)` lines.
fn parse_relations(section: &str) -> Vec<ParsedRelation> {
    let mut relations = Vec::new();
    for line in section.lines() {
        let line = line.trim();
        if !line.starts_with("- ") {
            continue;
        }
        // Extract [[key]]
        let Some(open) = line.find("[[") else {
            continue;
        };
        let Some(close) = line[open..].find("]]") else {
            continue;
        };
        let target_key = line[open + 2..open + close].to_string();

        // Extract relation and strength after " — "
        let after_link = &line[open + close + 2..];
        if let Some(dash_pos) = after_link.find(" — ") {
            let rest = &after_link[dash_pos + " — ".len()..];
            // Parse "relation (0.80)"
            if let Some(paren_pos) = rest.find(" (") {
                let relation = rest[..paren_pos].trim().to_string();
                let strength_str = rest[paren_pos + 2..].trim_end_matches(')').trim();
                let strength = strength_str.parse::<f32>().unwrap_or(0.5);
                relations.push(ParsedRelation {
                    target_key,
                    relation,
                    strength,
                });
            } else {
                relations.push(ParsedRelation {
                    target_key,
                    relation: rest.trim().to_string(),
                    strength: 0.5,
                });
            }
        } else {
            relations.push(ParsedRelation {
                target_key,
                relation: "related_to".to_string(),
                strength: 0.5,
            });
        }
    }
    relations
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_frontmatter() {
        let raw = "---\nkey: test\ncategory: fact\n---\n\nHello world\n";
        let (fm, body) = split_frontmatter(raw);
        assert!(fm.contains("key: test"));
        assert!(body.contains("Hello world"));
    }

    #[test]
    fn test_extract_field() {
        let fm = "id: \"abc-123\"\nkey: \"my-key\"\ncategory: fact\nagent_id: null";
        assert_eq!(extract_field(fm, "id"), Some("abc-123".to_string()));
        assert_eq!(extract_field(fm, "key"), Some("my-key".to_string()));
        assert_eq!(extract_field(fm, "category"), Some("fact".to_string()));
        assert_eq!(extract_field(fm, "agent_id"), None); // null → None
    }

    #[test]
    fn test_parse_relations() {
        let section = "## Relations\n\n- → [[auth-system]] — caused_by (0.80)\n- ← [[user-schema]] — related_to (0.50)\n";
        let rels = parse_relations(section);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].target_key, "auth-system");
        assert_eq!(rels[0].relation, "caused_by");
        assert!((rels[0].strength - 0.80).abs() < 0.01);
        assert_eq!(rels[1].target_key, "user-schema");
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("auth-system"), "auth-system");
        assert_eq!(sanitize_filename("my key/here"), "my-key-here");
        assert_eq!(sanitize_filename("test_v2"), "test_v2");
    }

    #[test]
    fn test_roundtrip_markdown() {
        let entry = InsightEntry {
            id: "abc-123".to_string(),
            key: "test-key".to_string(),
            content: "Some test content".to_string(),
            category: InsightCategory::Fact,
            agent_id: None,
            created_at: chrono::Utc::now(),
            session_id: None,
            score: 1.0,
        };

        let md = render_markdown(&entry, None, &HashMap::new());
        let (fm, body) = split_frontmatter(&md);

        assert_eq!(extract_field(&fm, "id"), Some("abc-123".to_string()));
        assert_eq!(extract_field(&fm, "key"), Some("test-key".to_string()));
        assert_eq!(extract_field(&fm, "category"), Some("fact".to_string()));
        assert!(body.contains("Some test content"));
    }

    #[tokio::test]
    async fn test_export_import_roundtrip() {
        use crate::sqlite::SqliteInsights;
        use aeqi_core::traits::Insight;

        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let vault_dir = dir.path().join("vault");

        // Create store with some memories.
        let store = SqliteInsights::open(&db_path, 30.0).unwrap();
        store
            .store(
                "auth-system",
                "JWT with 24h expiry",
                InsightCategory::Fact,
                None,
            )
            .await
            .unwrap();
        store
            .store(
                "deploy-process",
                "Merge to main, auto-deploy",
                InsightCategory::Procedure,
                None,
            )
            .await
            .unwrap();
        store
            .store(
                "code-style",
                "Use snake_case everywhere",
                InsightCategory::Preference,
                Some("eng-001"),
            )
            .await
            .unwrap();

        // Export.
        let exported = export(&store, &vault_dir).unwrap();
        assert_eq!(exported, 3);

        // Verify files exist.
        assert!(vault_dir.join("fact/auth-system.md").exists());
        assert!(vault_dir.join("procedure/deploy-process.md").exists());
        assert!(vault_dir.join("preference/code-style.md").exists());

        // Import into a fresh DB.
        let db2_path = dir.path().join("test2.db");
        let store2 = SqliteInsights::open(&db2_path, 30.0).unwrap();
        let (imported, skipped) = import(&store2, &vault_dir).await.unwrap();
        assert_eq!(imported, 3);
        assert_eq!(skipped, 0);

        // Verify all memories are searchable.
        let results = store2
            .search(&aeqi_core::traits::InsightQuery::new("JWT auth", 10))
            .await
            .unwrap();
        assert!(!results.is_empty());
        assert!(results[0].content.contains("JWT"));
    }
}
