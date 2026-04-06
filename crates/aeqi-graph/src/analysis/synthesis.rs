use std::collections::HashMap;

use crate::analysis::community::Community;
use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

/// A synthesized prompt document generated from community analysis.
#[derive(Debug, Clone)]
pub struct SynthesizedPrompt {
    pub name: String,
    pub description: String,
    pub content: String,
}

/// Synthesize a prompt document from a community's structure.
/// Analyzes the community's symbols, call patterns, file distribution,
/// and generates a structured knowledge document.
pub fn synthesize_prompt(
    community: &Community,
    all_nodes: &[CodeNode],
    all_edges: &[CodeEdge],
) -> SynthesizedPrompt {
    let member_set: std::collections::HashSet<&str> =
        community.members.iter().map(|s| s.as_str()).collect();

    // Collect community nodes
    let members: Vec<&CodeNode> = all_nodes
        .iter()
        .filter(|n| member_set.contains(n.id.as_str()))
        .collect();

    // Group by type
    let mut by_label: HashMap<NodeLabel, Vec<&CodeNode>> = HashMap::new();
    for m in &members {
        by_label.entry(m.label).or_default().push(m);
    }

    // Find files involved
    let files: Vec<&str> = members
        .iter()
        .map(|n| n.file_path.as_str())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // Find key exported symbols (likely the community's public API)
    let mut exported: Vec<&CodeNode> = members.iter().filter(|n| n.is_exported).copied().collect();
    exported.sort_by(|a, b| a.name.cmp(&b.name));

    // Find internal call patterns (edges within the community)
    let internal_calls: Vec<(&str, &str)> = all_edges
        .iter()
        .filter(|e| {
            e.edge_type == EdgeType::Calls
                && member_set.contains(e.source_id.as_str())
                && member_set.contains(e.target_id.as_str())
                && e.confidence >= 0.5
        })
        .filter_map(|e| {
            let source = all_nodes.iter().find(|n| n.id == e.source_id)?;
            let target = all_nodes.iter().find(|n| n.id == e.target_id)?;
            Some((source.name.as_str(), target.name.as_str()))
        })
        .collect();

    // Find entry points (called from outside the community)
    let entry_points: Vec<&str> = all_edges
        .iter()
        .filter(|e| {
            e.edge_type == EdgeType::Calls
                && !member_set.contains(e.source_id.as_str())
                && member_set.contains(e.target_id.as_str())
                && e.confidence >= 0.5
        })
        .filter_map(|e| {
            all_nodes
                .iter()
                .find(|n| n.id == e.target_id)
                .map(|n| n.name.as_str())
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    // Build the prompt document
    let name = slugify(&community.label);
    let description = format!(
        "Auto-generated knowledge for the {} domain ({} symbols across {} files)",
        community.label,
        community.symbol_count,
        files.len()
    );

    let mut content = String::new();

    // Header
    content.push_str(&format!("# {}\n\n", community.label));
    content.push_str(&format!(
        "{} symbols across {} files. Cohesion: {:.0}%.\n\n",
        community.symbol_count,
        files.len(),
        community.cohesion * 100.0
    ));

    // Key types
    let type_nodes: Vec<&&CodeNode> = exported
        .iter()
        .filter(|n| {
            matches!(
                n.label,
                NodeLabel::Struct
                    | NodeLabel::Trait
                    | NodeLabel::Enum
                    | NodeLabel::Class
                    | NodeLabel::Interface
                    | NodeLabel::Contract
            )
        })
        .collect();

    if !type_nodes.is_empty() {
        content.push_str("## Key Types\n\n");
        for node in &type_nodes {
            let sig = node.signature.as_deref().unwrap_or(&node.name);
            let doc = node
                .doc_comment
                .as_deref()
                .map(|d| format!(" — {d}"))
                .unwrap_or_default();
            content.push_str(&format!(
                "- **{}** (`{}:{}`) {}{}\n",
                node.name, node.file_path, node.start_line, sig, doc
            ));
        }
        content.push('\n');
    }

    // Key functions
    let key_funcs: Vec<&&CodeNode> = exported
        .iter()
        .filter(|n| matches!(n.label, NodeLabel::Function | NodeLabel::Method))
        .take(15)
        .collect();

    if !key_funcs.is_empty() {
        content.push_str("## Key Functions\n\n");
        for node in &key_funcs {
            let sig = node.signature.as_deref().unwrap_or(&node.name);
            content.push_str(&format!(
                "- `{}` (`{}:{}`)\n",
                sig, node.file_path, node.start_line
            ));
        }
        content.push('\n');
    }

    // Call patterns
    if !internal_calls.is_empty() {
        content.push_str("## Internal Call Patterns\n\n");
        let mut seen = std::collections::HashSet::new();
        for (from, to) in internal_calls.iter().take(20) {
            let key = format!("{from} → {to}");
            if seen.insert(key.clone()) {
                content.push_str(&format!("- {key}\n"));
            }
        }
        content.push('\n');
    }

    // Entry points
    if !entry_points.is_empty() {
        content.push_str("## Entry Points (called from outside)\n\n");
        for ep in entry_points.iter().take(10) {
            content.push_str(&format!("- `{ep}`\n"));
        }
        content.push('\n');
    }

    // Files
    content.push_str("## Files\n\n");
    for file in files.iter().take(20) {
        content.push_str(&format!("- `{file}`\n"));
    }

    SynthesizedPrompt {
        name,
        description,
        content,
    }
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;

    #[test]
    fn synthesize_from_community() {
        let nodes = vec![
            CodeNode::new(
                NodeLabel::Trait,
                "Observer",
                "src/observer.rs",
                1,
                50,
                "rust",
            )
            .with_exported(true)
            .with_doc("Observability trait"),
            CodeNode::new(
                NodeLabel::Struct,
                "LogObserver",
                "src/observer.rs",
                52,
                60,
                "rust",
            )
            .with_exported(true),
            CodeNode::new(
                NodeLabel::Method,
                "record",
                "src/observer.rs",
                55,
                58,
                "rust",
            )
            .with_exported(true)
            .with_signature("fn record(&self, event: Event)"),
        ];

        let edges = vec![
            CodeEdge::new(&nodes[1].id, &nodes[0].id, EdgeType::Implements).with_confidence(0.9),
        ];

        let community = Community {
            id: "comm_0".to_string(),
            label: "Observer System".to_string(),
            members: nodes.iter().map(|n| n.id.clone()).collect(),
            file_count: 1,
            symbol_count: 3,
            cohesion: 0.85,
            keywords: vec!["Observer".to_string()],
        };

        let p = synthesize_prompt(&community, &nodes, &edges);
        assert_eq!(p.name, "observer-system");
        assert!(p.content.contains("Observer"));
        assert!(p.content.contains("LogObserver"));
        assert!(p.content.contains("Key Types"));
    }
}
