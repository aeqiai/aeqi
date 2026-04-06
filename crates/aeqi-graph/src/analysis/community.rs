use std::collections::{HashMap, HashSet};
use tracing::debug;

use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

/// A detected community (functional cluster of related code).
#[derive(Debug, Clone)]
pub struct Community {
    pub id: String,
    pub label: String,
    pub members: Vec<String>,
    pub file_count: usize,
    pub symbol_count: usize,
    pub cohesion: f32,
    pub keywords: Vec<String>,
}

/// Detect communities using label propagation on CALLS/IMPLEMENTS/EXTENDS edges.
/// Returns communities with at least `min_size` members.
pub fn detect_communities(
    nodes: &[CodeNode],
    edges: &[CodeEdge],
    min_size: usize,
) -> Vec<Community> {
    // Filter to symbol nodes only (not File, Module, Community, Process)
    let symbol_ids: HashSet<&str> = nodes
        .iter()
        .filter(|n| {
            !matches!(
                n.label,
                NodeLabel::File | NodeLabel::Module | NodeLabel::Community | NodeLabel::Process
            )
        })
        .map(|n| n.id.as_str())
        .collect();

    // Build adjacency list from relevant edges (undirected)
    let mut adjacency: HashMap<&str, Vec<(&str, f32)>> = HashMap::new();
    for edge in edges {
        if !matches!(
            edge.edge_type,
            EdgeType::Calls | EdgeType::Implements | EdgeType::Extends | EdgeType::Uses
        ) {
            continue;
        }
        // Skip unresolved edges
        if edge.target_id.starts_with("unresolved:") {
            continue;
        }
        // Both ends must be symbols
        if !symbol_ids.contains(edge.source_id.as_str())
            || !symbol_ids.contains(edge.target_id.as_str())
        {
            continue;
        }
        // Skip low-confidence global matches
        if edge.confidence < 0.5 {
            continue;
        }
        let weight = edge.confidence;
        adjacency
            .entry(edge.source_id.as_str())
            .or_default()
            .push((edge.target_id.as_str(), weight));
        adjacency
            .entry(edge.target_id.as_str())
            .or_default()
            .push((edge.source_id.as_str(), weight));
    }

    // Initialize: each node in its own community
    let mut labels: HashMap<&str, usize> = HashMap::new();
    for (i, id) in symbol_ids.iter().enumerate() {
        labels.insert(id, i);
    }

    // Label propagation: iterate until convergence or max iterations
    let max_iterations = 20;
    for iteration in 0..max_iterations {
        let mut changed = 0usize;

        // Process nodes in arbitrary (but deterministic) order
        let mut node_list: Vec<&str> = symbol_ids.iter().copied().collect();
        node_list.sort();

        for &node_id in &node_list {
            let neighbors = match adjacency.get(node_id) {
                Some(n) => n,
                None => continue,
            };

            // Count weighted votes for each neighboring label
            let mut votes: HashMap<usize, f32> = HashMap::new();
            for &(neighbor, weight) in neighbors {
                if let Some(&neighbor_label) = labels.get(neighbor) {
                    *votes.entry(neighbor_label).or_default() += weight;
                }
            }

            if votes.is_empty() {
                continue;
            }

            // Pick the label with the highest weighted vote
            let best_label = votes
                .into_iter()
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
                .map(|(label, _)| label)
                .unwrap();

            if labels.get(node_id) != Some(&best_label) {
                labels.insert(node_id, best_label);
                changed += 1;
            }
        }

        if changed == 0 {
            debug!(iterations = iteration + 1, "label propagation converged");
            break;
        }
    }

    // Group nodes by community label
    let mut groups: HashMap<usize, Vec<&str>> = HashMap::new();
    for (&node_id, &label) in &labels {
        groups.entry(label).or_default().push(node_id);
    }

    // Build node lookup for naming
    let node_map: HashMap<&str, &CodeNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Convert groups to Community structs
    let mut communities: Vec<Community> = groups
        .into_iter()
        .filter(|(_, members)| members.len() >= min_size)
        .enumerate()
        .map(|(idx, (_, member_ids))| {
            let members: Vec<&CodeNode> = member_ids
                .iter()
                .filter_map(|id| node_map.get(id).copied())
                .collect();

            let files: HashSet<&str> = members.iter().map(|n| n.file_path.as_str()).collect();
            let symbol_count = members.len();

            // Generate label from dominant file path + top exported type names
            // Prefer: directory component (e.g. "middleware", "memory", "agent") + key type
            let mut dir_counts: HashMap<&str, usize> = HashMap::new();
            for f in &files {
                // Extract meaningful directory component (last non-filename part)
                let parts: Vec<&str> = f.split('/').collect();
                if parts.len() >= 2 {
                    let dir = parts[parts.len() - 2];
                    if !matches!(dir, "src" | "lib" | "crates" | "components" | "pages") {
                        *dir_counts.entry(dir).or_default() += 1;
                    }
                }
            }

            // Top exported type/trait/struct names (not generic method names)
            let mut type_names: Vec<&str> = members
                .iter()
                .filter(|m| {
                    m.is_exported
                        && matches!(
                            m.label,
                            NodeLabel::Struct
                                | NodeLabel::Trait
                                | NodeLabel::Enum
                                | NodeLabel::Class
                                | NodeLabel::Interface
                                | NodeLabel::Contract
                        )
                })
                .map(|m| m.name.as_str())
                .collect();
            type_names.sort();
            type_names.dedup();

            let label = if !type_names.is_empty() {
                type_names[..type_names.len().min(3)].join(", ")
            } else {
                // Fallback: dominant directory name
                let mut sorted_dirs: Vec<_> = dir_counts.into_iter().collect();
                sorted_dirs.sort_by(|a, b| b.1.cmp(&a.1));
                sorted_dirs
                    .first()
                    .map(|(d, _)| d.to_string())
                    .unwrap_or_else(|| format!("community_{idx}"))
            };

            // Compute cohesion: ratio of internal edges to possible internal edges
            let member_set: HashSet<&str> = member_ids.iter().copied().collect();
            let mut internal_edges = 0usize;
            let mut total_edges = 0usize;
            for &mid in &member_ids {
                if let Some(neighbors) = adjacency.get(mid) {
                    for (neighbor, _) in neighbors {
                        total_edges += 1;
                        if member_set.contains(neighbor) {
                            internal_edges += 1;
                        }
                    }
                }
            }
            let cohesion = if total_edges > 0 {
                internal_edges as f32 / total_edges as f32
            } else {
                0.0
            };

            let keywords: Vec<String> = type_names.iter().map(|s| s.to_string()).collect();

            Community {
                id: format!("comm_{idx}"),
                label,
                members: member_ids.into_iter().map(String::from).collect(),
                file_count: files.len(),
                symbol_count,
                cohesion,
                keywords,
            }
        })
        .collect();

    communities.sort_by(|a, b| b.symbol_count.cmp(&a.symbol_count));

    debug!(
        communities = communities.len(),
        "community detection complete"
    );

    communities
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;

    #[test]
    fn detects_two_clusters() {
        // Two groups of functions that call each other internally
        let nodes = vec![
            CodeNode::new(
                NodeLabel::Function,
                "auth_login",
                "src/auth.rs",
                1,
                10,
                "rust",
            ),
            CodeNode::new(
                NodeLabel::Function,
                "auth_verify",
                "src/auth.rs",
                11,
                20,
                "rust",
            ),
            CodeNode::new(
                NodeLabel::Function,
                "auth_hash",
                "src/auth.rs",
                21,
                30,
                "rust",
            ),
            CodeNode::new(
                NodeLabel::Function,
                "db_connect",
                "src/db.rs",
                1,
                10,
                "rust",
            ),
            CodeNode::new(NodeLabel::Function, "db_query", "src/db.rs", 11, 20, "rust"),
            CodeNode::new(
                NodeLabel::Function,
                "db_migrate",
                "src/db.rs",
                21,
                30,
                "rust",
            ),
        ];

        let edges = vec![
            // Auth cluster: login <-> verify <-> hash
            CodeEdge::new(&nodes[0].id, &nodes[1].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[1].id, &nodes[2].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[0].id, &nodes[2].id, EdgeType::Calls).with_confidence(0.9),
            // DB cluster: connect <-> query <-> migrate
            CodeEdge::new(&nodes[3].id, &nodes[4].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[4].id, &nodes[5].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[3].id, &nodes[5].id, EdgeType::Calls).with_confidence(0.9),
            // One weak cross-cluster edge
            CodeEdge::new(&nodes[0].id, &nodes[4].id, EdgeType::Calls).with_confidence(0.6),
        ];

        let communities = detect_communities(&nodes, &edges, 2);
        assert!(
            communities.len() >= 2,
            "should detect at least 2 communities, got {}",
            communities.len()
        );
    }

    #[test]
    fn single_cluster_with_high_cohesion() {
        let nodes = vec![
            CodeNode::new(NodeLabel::Function, "a", "src/lib.rs", 1, 5, "rust"),
            CodeNode::new(NodeLabel::Function, "b", "src/lib.rs", 6, 10, "rust"),
            CodeNode::new(NodeLabel::Function, "c", "src/lib.rs", 11, 15, "rust"),
        ];
        let edges = vec![
            CodeEdge::new(&nodes[0].id, &nodes[1].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[1].id, &nodes[2].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[0].id, &nodes[2].id, EdgeType::Calls).with_confidence(0.9),
        ];

        let communities = detect_communities(&nodes, &edges, 2);
        assert_eq!(communities.len(), 1);
        assert_eq!(communities[0].symbol_count, 3);
        assert!(
            communities[0].cohesion > 0.9,
            "fully connected graph should have high cohesion"
        );
    }

    #[test]
    fn skips_file_nodes() {
        let nodes = vec![
            CodeNode::new(NodeLabel::File, "lib.rs", "src/lib.rs", 1, 100, "rust"),
            CodeNode::new(NodeLabel::Function, "a", "src/lib.rs", 1, 5, "rust"),
        ];
        let edges = vec![];
        let communities = detect_communities(&nodes, &edges, 1);
        // File node shouldn't appear in any community
        for c in &communities {
            assert!(
                !c.members.iter().any(|m| m.contains("file")),
                "file nodes should not be in communities"
            );
        }
    }
}
