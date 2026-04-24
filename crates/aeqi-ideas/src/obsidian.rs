//! Obsidian vault export/import for the idea store.
//!
//! Each idea becomes a `.md` file with YAML frontmatter.
//! Graph edges become `[[wikilinks]]` — Obsidian's graph view
//! renders the idea graph for free.
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

use crate::sqlite::SqliteIdeas;
use aeqi_core::traits::{Idea, IdeaGraphEdge, IdeaStore};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;
use tracing::{debug, info, warn};

// ── Export ──────────────────────────────────────────────────────────────────

/// Export all memories to an Obsidian vault directory.
///
/// Returns the number of files written.
///
/// Uses `IdeaStore::edges_between` (string-typed relations) rather than the
/// enum-typed `fetch_edges_for_set` so typed inline-link edges such as
/// `supersedes` / `contradicts` / `supports` / `distilled_into` survive the
/// round-trip — the enum in `IdeaRelation` only knows three relations, and
/// any other string is silently dropped by the filter_map in `fetch_edges`.
pub async fn export(store: &SqliteIdeas, vault_dir: &Path) -> Result<usize> {
    let entries = store.list_all()?;
    if entries.is_empty() {
        info!("no memories to export");
        return Ok(0);
    }

    // Build ID → name lookup for wikilinks.
    let id_to_name: HashMap<&str, &str> = entries
        .iter()
        .map(|e| (e.id.as_str(), e.name.as_str()))
        .collect();

    // Fetch all edges via the string-typed interface so typed relations
    // (supersedes, contradicts, supports, distilled_into, co_retrieved)
    // aren't dropped by the 3-variant `IdeaRelation` enum.
    let all_ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
    let edges = store.edges_between(&all_ids).await.unwrap_or_default();

    // Group edges by source/target ID for quick lookup.
    let mut edges_by_id: HashMap<&str, Vec<&IdeaGraphEdge>> = HashMap::new();
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
        let tag_dir = tag_dir(entry.tags.first().map(|s| s.as_str()).unwrap_or("untagged"));
        let dir = vault_dir.join(tag_dir);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create dir: {}", dir.display()))?;

        let filename = sanitize_filename(&entry.name);
        let path = dir.join(format!("{filename}.md"));

        let entry_edges = edges_by_id.get(entry.id.as_str());
        let md = render_markdown(entry, entry_edges, &id_to_name);

        std::fs::write(&path, md).with_context(|| format!("failed to write {}", path.display()))?;
        debug!(name = %entry.name, path = %path.display(), "exported idea");
        written += 1;
    }

    info!(count = written, vault = %vault_dir.display(), "obsidian export complete");
    Ok(written)
}

/// Render a single idea as Obsidian-compatible markdown.
fn render_markdown(
    entry: &Idea,
    edges: Option<&Vec<&IdeaGraphEdge>>,
    id_to_name: &HashMap<&str, &str>,
) -> String {
    let tags = if entry.tags.is_empty() {
        vec!["untagged".to_string()]
    } else {
        entry.tags.clone()
    };
    let primary_tag = tag_str(tags.first().map(|s| s.as_str()).unwrap_or("untagged"));
    let agent = entry
        .agent_id
        .as_deref()
        .map(|a| format!("\"{a}\""))
        .unwrap_or_else(|| "null".to_string());
    let created = entry.created_at.to_rfc3339();
    let rendered_tags = std::iter::once("aeqi".to_string())
        .chain(tags.iter().cloned())
        .map(|tag| format!("         - {tag}\n"))
        .collect::<String>();

    let mut md = format!(
        "---\n\
         id: \"{}\"\n\
         key: \"{}\"\n\
         primary_tag: {primary_tag}\n\
         agent_id: {agent}\n\
         created_at: \"{created}\"\n\
         tags:\n\
{rendered_tags}\
         ---\n\n\
         {}\n",
        entry.id, entry.name, entry.content
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
            let other_key = id_to_name.get(other_id).copied().unwrap_or(other_id);
            md.push_str(&format!(
                "- {direction} [[{other_key}]] — {} ({:.2})\n",
                edge.relation, edge.strength
            ));
        }
    }

    md
}

// ── Import ─────────────────────────────────────────────────────────────────

/// A parsed Obsidian idea file ready for ingestion.
#[derive(Debug)]
pub struct ParsedIdea {
    pub id: Option<String>,
    pub name: String,
    pub content: String,
    pub tags: Vec<String>,
    pub agent_id: Option<String>,
    pub relations: Vec<ParsedRelation>,
    /// Path relative to the vault root (e.g. `fact/auth-system.md`).
    /// Used to emit the `source:markdown:<path>` provenance tag so imported
    /// ideas carry an unambiguous origin marker — the v3 schema dropped the
    /// `source_kind` / `source_ref` columns in favour of these tags.
    pub source_path: Option<String>,
}

#[derive(Debug)]
pub struct ParsedRelation {
    pub target_key: String,
    pub relation: String,
    pub strength: f32,
}

/// Import memories from an Obsidian vault into the store.
///
/// **Fallback path** — this bypasses the daemon dedup / embed / policy
/// pipeline. The CLI should prefer routing through the daemon IPC
/// (`cmd_ideas_import` in `aeqi-cli`); this function exists so tests and
/// the no-daemon fallback keep working.
///
/// Returns (imported, skipped) counts.
pub async fn import(store: &SqliteIdeas, vault_dir: &Path) -> Result<(usize, usize)> {
    let parsed = scan_vault(vault_dir)?;
    if parsed.is_empty() {
        info!("no idea files found in vault");
        return Ok((0, 0));
    }

    let mut imported = 0;
    let mut skipped = 0;

    // First pass: store all memories.
    let mut key_to_id: HashMap<String, String> = HashMap::new();

    for mem in &parsed {
        let tags = merge_provenance_tags(&mem.tags, mem.source_path.as_deref());
        match store
            .store(&mem.name, &mem.content, &tags, mem.agent_id.as_deref())
            .await
        {
            Ok(id) if id.is_empty() => {
                debug!(name = %mem.name, "skipped (duplicate)");
                skipped += 1;
            }
            Ok(id) => {
                debug!(name = %mem.name, id = %id, "imported");
                key_to_id.insert(mem.name.clone(), id);
                imported += 1;
            }
            Err(e) => {
                warn!(name = %mem.name, err = %e, "failed to import");
                skipped += 1;
            }
        }
    }

    // Second pass: restore edges using key→ID mapping.
    // Also include existing memories for edge resolution.
    let existing = store.list_all()?;
    for entry in &existing {
        key_to_id
            .entry(entry.name.clone())
            .or_insert_with(|| entry.id.clone());
    }

    for mem in &parsed {
        if mem.relations.is_empty() {
            continue;
        }
        let Some(source_id) = key_to_id.get(&mem.name) else {
            continue;
        };
        for rel in &mem.relations {
            let Some(target_id) = key_to_id.get(&rel.target_key) else {
                debug!(
                    source = %mem.name,
                    target = %rel.target_key,
                    "skipping edge — target not found"
                );
                continue;
            };
            if let Err(e) = store
                .store_idea_edge(source_id, target_id, &rel.relation, rel.strength)
                .await
            {
                warn!(
                    source = %mem.name,
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

/// Scan an Obsidian vault directory for idea markdown files and return
/// parsed `ParsedIdea` structs. Public because the CLI's IPC-routed
/// importer parses locally, then dispatches each entry through the
/// daemon's `store_idea` handler.
pub fn scan_vault_parsed(vault_dir: &Path) -> Result<Vec<ParsedIdea>> {
    scan_vault(vault_dir)
}

/// Scan an Obsidian vault directory for idea markdown files.
fn scan_vault(vault_dir: &Path) -> Result<Vec<ParsedIdea>> {
    let mut results = Vec::new();

    // Scan all subdirectories (each subdirectory name is treated as the primary tag).
    if vault_dir.is_dir() {
        for dir_entry in std::fs::read_dir(vault_dir)? {
            let dir_entry = dir_entry?;
            let tag_dir = dir_entry.path();
            if !tag_dir.is_dir() {
                continue;
            }
            for entry in std::fs::read_dir(&tag_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let rel = relative_to(&path, vault_dir);
                match parse_idea_file(&path, rel) {
                    Ok(mem) => results.push(mem),
                    Err(e) => warn!(path = %path.display(), err = %e, "failed to parse"),
                }
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
            // Skip if already parsed from a tag subdirectory.
            if results.iter().any(|m| {
                let fname = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                m.name == fname
            }) {
                continue;
            }
            let rel = relative_to(&path, vault_dir);
            match parse_idea_file(&path, rel) {
                Ok(mem) => results.push(mem),
                Err(e) => warn!(path = %path.display(), err = %e, "failed to parse"),
            }
        }
    }

    Ok(results)
}

/// Compute a POSIX-style relative path (`<tag>/<file>.md` or `<file>.md`).
/// Falls back to the file name alone if stripping the vault prefix fails.
fn relative_to(path: &Path, vault_dir: &Path) -> Option<String> {
    let rel = path.strip_prefix(vault_dir).ok()?;
    let s = rel
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");
    if s.is_empty() { None } else { Some(s) }
}

/// Parse a single Obsidian markdown file into a `ParsedIdea`.
fn parse_idea_file(path: &Path, source_path: Option<String>) -> Result<ParsedIdea> {
    let raw =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;

    let (frontmatter, body) = split_frontmatter(&raw);

    // Extract fields from frontmatter.
    let id = extract_field(&frontmatter, "id");
    let name = extract_field(&frontmatter, "key").unwrap_or_else(|| {
        // Fall back to filename.
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string()
    });
    let mut tags = extract_tags(&frontmatter);
    if tags.is_empty() {
        if let Some(primary_tag) = extract_field(&frontmatter, "primary_tag") {
            tags.push(primary_tag);
        } else {
            tags.push("fact".to_string());
        }
    }
    let agent_id = extract_field(&frontmatter, "agent_id").filter(|s| s != "null" && !s.is_empty());

    // Split body into content and relations.
    let (content, relations) = split_relations(&body);

    Ok(ParsedIdea {
        id,
        name,
        content: content.trim().to_string(),
        tags,
        agent_id,
        relations,
        source_path,
    })
}

/// Merge the parsed frontmatter tags with the synthetic provenance tags
/// emitted on every import. Dedupe case-insensitively, preserving the
/// order of first appearance so the user's declared tags stay in front
/// of machine-generated ones.
pub fn merge_provenance_tags(
    frontmatter_tags: &[String],
    source_path: Option<&str>,
) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(frontmatter_tags.len() + 2);
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let push =
        |tag: String, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>| {
            let key = tag.to_lowercase();
            if !key.is_empty() && seen.insert(key) {
                out.push(tag);
            }
        };
    for tag in frontmatter_tags {
        push(tag.clone(), &mut out, &mut seen);
    }
    push("source:obsidian".to_string(), &mut out, &mut seen);
    if let Some(path) = source_path {
        push(format!("source:markdown:{path}"), &mut out, &mut seen);
    }
    out
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn tag_dir(tag: &str) -> &str {
    tag
}

fn tag_str(tag: &str) -> &str {
    tag
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
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

fn extract_tags(frontmatter: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_tags = false;

    for raw_line in frontmatter.lines() {
        let line = raw_line.trim();
        if !in_tags {
            if line == "tags:" {
                in_tags = true;
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("- ") {
            let tag = rest.trim().trim_matches('"');
            if !tag.is_empty() && tag != "aeqi" {
                tags.push(tag.to_string());
            }
            continue;
        }

        if line.is_empty() {
            continue;
        }

        break;
    }

    tags
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

/// Map any legacy or unknown relation name to one of the relations the
/// store recognises. The taxonomy tracks the `inline_links` parser:
/// `mentions`, `embeds`, `supersedes`, `contradicts`, `supports`,
/// `distilled_into` — plus `adjacent` for UI-added edges. Everything else
/// (legacy `caused_by`, `related_to`, `triggered_by`, …) collapses to
/// `adjacent` so old vaults round-trip without reintroducing retired
/// relation names.
fn normalize_relation(raw: &str) -> String {
    match raw.trim() {
        "mentions" => "mentions".to_string(),
        "embeds" => "embeds".to_string(),
        "supersedes" => "supersedes".to_string(),
        "contradicts" => "contradicts".to_string(),
        "supports" => "supports".to_string(),
        "distilled_into" => "distilled_into".to_string(),
        "adjacent" => "adjacent".to_string(),
        _ => "adjacent".to_string(),
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
                let relation = normalize_relation(rest[..paren_pos].trim());
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
                    relation: normalize_relation(rest.trim()),
                    strength: 0.5,
                });
            }
        } else {
            relations.push(ParsedRelation {
                target_key,
                relation: "adjacent".to_string(),
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
        let raw = "---\nkey: test\ntags:\n- fact\n---\n\nHello world\n";
        let (fm, body) = split_frontmatter(raw);
        assert!(fm.contains("key: test"));
        assert!(body.contains("Hello world"));
    }

    #[test]
    fn test_extract_field() {
        let fm = "id: \"abc-123\"\nkey: \"my-key\"\nprimary_tag: fact\nagent_id: null";
        assert_eq!(extract_field(fm, "id"), Some("abc-123".to_string()));
        assert_eq!(extract_field(fm, "key"), Some("my-key".to_string()));
        assert_eq!(extract_field(fm, "primary_tag"), Some("fact".to_string()));
        assert_eq!(extract_field(fm, "agent_id"), None); // null → None
    }

    #[test]
    fn test_extract_tags() {
        let fm = "key: test\ntags:\n- aeqi\n- fact\n- evergreen\nagent_id: null";
        assert_eq!(
            extract_tags(fm),
            vec!["fact".to_string(), "evergreen".to_string()]
        );
    }

    #[test]
    fn test_parse_relations() {
        // Legacy relation names (caused_by, related_to) must be mapped to
        // `adjacent` so round-trip export→import doesn't reintroduce the
        // old taxonomy.
        let section = "## Relations\n\n- → [[auth-system]] — caused_by (0.80)\n- ← [[user-schema]] — related_to (0.50)\n";
        let rels = parse_relations(section);
        assert_eq!(rels.len(), 2);
        assert_eq!(rels[0].target_key, "auth-system");
        assert_eq!(rels[0].relation, "adjacent");
        assert!((rels[0].strength - 0.80).abs() < 0.01);
        assert_eq!(rels[1].target_key, "user-schema");
        assert_eq!(rels[1].relation, "adjacent");
    }

    #[test]
    fn test_parse_relations_preserves_new_taxonomy() {
        let section = "## Relations\n\n- → [[a]] — mentions (0.50)\n- → [[b]] — embeds (1.00)\n- → [[c]] — adjacent (0.50)\n";
        let rels = parse_relations(section);
        assert_eq!(rels.len(), 3);
        assert_eq!(rels[0].relation, "mentions");
        assert_eq!(rels[1].relation, "embeds");
        assert_eq!(rels[2].relation, "adjacent");
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("auth-system"), "auth-system");
        assert_eq!(sanitize_filename("my key/here"), "my-key-here");
        assert_eq!(sanitize_filename("test_v2"), "test_v2");
    }

    #[test]
    fn test_roundtrip_markdown() {
        let entry = Idea::recalled(
            "abc-123".to_string(),
            "test-key".to_string(),
            "Some test content".to_string(),
            vec!["fact".to_string()],
            None,
            chrono::Utc::now(),
            None,
            1.0,
        );

        let md = render_markdown(&entry, None, &HashMap::new());
        let (fm, body) = split_frontmatter(&md);

        assert_eq!(extract_field(&fm, "id"), Some("abc-123".to_string()));
        assert_eq!(extract_field(&fm, "key"), Some("test-key".to_string()));
        assert_eq!(extract_field(&fm, "primary_tag"), Some("fact".to_string()));
        assert_eq!(extract_tags(&fm), vec!["fact".to_string()]);
        assert!(body.contains("Some test content"));
    }

    #[tokio::test]
    async fn test_export_import_roundtrip() {
        use crate::sqlite::SqliteIdeas;
        use aeqi_core::traits::IdeaStore;

        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let vault_dir = dir.path().join("vault");

        // Create store with some memories.
        let store = SqliteIdeas::open(&db_path, 30.0).unwrap();
        store
            .store(
                "auth-system",
                "JWT with 24h expiry",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();
        store
            .store(
                "deploy-process",
                "Merge to main, auto-deploy",
                &["procedure".to_string()],
                None,
            )
            .await
            .unwrap();
        store
            .store(
                "code-style",
                "Use snake_case everywhere",
                &["preference".to_string()],
                Some("eng-001"),
            )
            .await
            .unwrap();

        // Export.
        let exported = export(&store, &vault_dir).await.unwrap();
        assert_eq!(exported, 3);

        // Verify files exist.
        assert!(vault_dir.join("fact/auth-system.md").exists());
        assert!(vault_dir.join("procedure/deploy-process.md").exists());
        assert!(vault_dir.join("preference/code-style.md").exists());

        // Import into a fresh DB.
        let db2_path = dir.path().join("test2.db");
        let store2 = SqliteIdeas::open(&db2_path, 30.0).unwrap();
        let (imported, skipped) = import(&store2, &vault_dir).await.unwrap();
        assert_eq!(imported, 3);
        assert_eq!(skipped, 0);

        // Verify all memories are searchable.
        let results = store2
            .search(&aeqi_core::traits::IdeaQuery::new("JWT auth", 10))
            .await
            .unwrap();
        assert!(!results.is_empty());
        assert!(results[0].content.contains("JWT"));

        // Imported ideas must carry provenance tags so the v3 schema's
        // dropped `source_kind`/`source_ref` columns have a tag equivalent.
        let imported_all = store2.list_all().unwrap();
        for idea in &imported_all {
            assert!(
                idea.tags.iter().any(|t| t == "source:obsidian"),
                "imported idea {} missing source:obsidian tag: {:?}",
                idea.name,
                idea.tags,
            );
            assert!(
                idea.tags.iter().any(|t| t.starts_with("source:markdown:")),
                "imported idea {} missing source:markdown:<path> tag: {:?}",
                idea.name,
                idea.tags,
            );
        }
    }

    #[test]
    fn test_merge_provenance_tags_appends_source_markers() {
        let input = vec!["fact".to_string(), "evergreen".to_string()];
        let out = merge_provenance_tags(&input, Some("fact/auth-system.md"));
        assert_eq!(
            out,
            vec![
                "fact".to_string(),
                "evergreen".to_string(),
                "source:obsidian".to_string(),
                "source:markdown:fact/auth-system.md".to_string(),
            ]
        );
    }

    #[test]
    fn test_merge_provenance_tags_no_path_only_source_obsidian() {
        let input = vec!["fact".to_string()];
        let out = merge_provenance_tags(&input, None);
        assert_eq!(out, vec!["fact".to_string(), "source:obsidian".to_string()]);
    }

    #[test]
    fn test_merge_provenance_tags_dedupes_case_insensitive() {
        // If the frontmatter already carried a source:obsidian marker
        // (e.g. because the user hand-edited), don't emit a duplicate.
        let input = vec![
            "fact".to_string(),
            "Source:Obsidian".to_string(),
            "source:markdown:fact/x.md".to_string(),
        ];
        let out = merge_provenance_tags(&input, Some("fact/x.md"));
        assert_eq!(out.len(), 3, "tag list must dedupe: {out:?}");
        assert!(out.iter().any(|t| t == "fact"));
        assert!(out.iter().any(|t| t == "Source:Obsidian"));
        assert!(out.iter().any(|t| t == "source:markdown:fact/x.md"));
    }

    #[test]
    fn test_parse_relations_preserves_typed_prefixes() {
        // Round-trip for supersedes / contradicts / supports / distilled_into —
        // these are emitted in the exporter now and must survive re-import.
        let section = "## Relations\n\n\
             - → [[Old Plan]] — supersedes (1.00)\n\
             - → [[Stale Fact]] — contradicts (0.80)\n\
             - → [[Main Claim]] — supports (0.90)\n\
             - → [[Summary]] — distilled_into (1.00)\n";
        let rels = parse_relations(section);
        assert_eq!(rels.len(), 4);
        assert_eq!(rels[0].relation, "supersedes");
        assert_eq!(rels[1].relation, "contradicts");
        assert_eq!(rels[2].relation, "supports");
        assert_eq!(rels[3].relation, "distilled_into");
    }
}
