use std::collections::{HashMap, HashSet, VecDeque};
use tracing::debug;

use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

/// A detected execution flow (process trace).
#[derive(Debug, Clone)]
pub struct Process {
    pub id: String,
    pub label: String,
    pub process_type: ProcessType,
    pub entry_id: String,
    pub terminal_id: String,
    pub step_count: usize,
    pub trace: Vec<String>,
    pub communities: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessType {
    IntraCommunity,
    CrossCommunity,
}

impl ProcessType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::IntraCommunity => "intra_community",
            Self::CrossCommunity => "cross_community",
        }
    }
}

/// Detect execution flow processes via BFS from entry points.
pub fn detect_processes(
    nodes: &[CodeNode],
    edges: &[CodeEdge],
    max_depth: usize,
    max_processes: usize,
) -> Vec<Process> {
    let node_map: HashMap<&str, &CodeNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    // Build forward adjacency (CALLS edges only, confidence >= 0.5)
    let mut forward: HashMap<&str, Vec<(&str, f32)>> = HashMap::new();
    let mut incoming_count: HashMap<&str, usize> = HashMap::new();

    for edge in edges {
        if edge.edge_type != EdgeType::Calls || edge.confidence < 0.5 {
            continue;
        }
        if edge.target_id.starts_with("unresolved:") {
            continue;
        }
        forward
            .entry(edge.source_id.as_str())
            .or_default()
            .push((edge.target_id.as_str(), edge.confidence));
        *incoming_count.entry(edge.target_id.as_str()).or_default() += 1;
    }

    // Find entry points: symbols with outgoing CALLS but few/no incoming CALLS
    let mut entry_points: Vec<(&str, f32)> = Vec::new();
    for node in nodes {
        if matches!(
            node.label,
            NodeLabel::File
                | NodeLabel::Module
                | NodeLabel::Community
                | NodeLabel::Process
                | NodeLabel::Impl
        ) {
            continue;
        }

        let has_outgoing = forward.contains_key(node.id.as_str());
        if !has_outgoing {
            continue;
        }

        let in_count = incoming_count.get(node.id.as_str()).copied().unwrap_or(0);
        let out_count = forward.get(node.id.as_str()).map(|v| v.len()).unwrap_or(0);

        // Score: lower incoming relative to outgoing = more likely entry point
        let score = if in_count == 0 {
            1.0
        } else {
            out_count as f32 / (in_count as f32 + out_count as f32)
        };

        // Entry point heuristics
        let name_boost = if matches!(
            node.name.as_str(),
            "main" | "run" | "start" | "init" | "execute" | "handle" | "serve" | "cmd_"
        ) || node.name.starts_with("cmd_")
            || node.name.starts_with("handle_")
            || node.name.starts_with("route_")
        {
            0.3
        } else {
            0.0
        };

        // Exported functions are more likely entry points
        let export_boost = if node.is_exported { 0.2 } else { 0.0 };

        let final_score = score + name_boost + export_boost;
        if final_score > 0.4 {
            entry_points.push((node.id.as_str(), final_score));
        }
    }

    // Sort by score descending
    entry_points.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // BFS from each entry point to trace execution flows
    let mut processes: Vec<Process> = Vec::new();
    let mut seen_traces: HashSet<String> = HashSet::new();

    for (entry_id, _score) in entry_points.iter().take(max_processes * 2) {
        let traces = bfs_traces(entry_id, &forward, max_depth);

        for trace in traces {
            if trace.len() < 2 {
                continue;
            }

            // Dedup by (entry, terminal) pair
            let dedup_key = format!("{}→{}", trace.first().unwrap(), trace.last().unwrap());
            if seen_traces.contains(&dedup_key) {
                continue;
            }
            seen_traces.insert(dedup_key);

            let entry_node = node_map.get(trace[0].as_str());
            let terminal_node = node_map.get(trace.last().unwrap().as_str());

            let label = format!(
                "{} → {}",
                entry_node.map(|n| n.name.as_str()).unwrap_or("?"),
                terminal_node.map(|n| n.name.as_str()).unwrap_or("?"),
            );

            // Determine if cross-community
            let communities: Vec<String> = trace
                .iter()
                .filter_map(|id| node_map.get(id.as_str()))
                .filter_map(|n| n.community_id.clone())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();

            let process_type = if communities.len() > 1 {
                ProcessType::CrossCommunity
            } else {
                ProcessType::IntraCommunity
            };

            processes.push(Process {
                id: format!("proc_{}", processes.len()),
                label,
                process_type,
                entry_id: trace[0].clone(),
                terminal_id: trace.last().unwrap().clone(),
                step_count: trace.len(),
                trace,
                communities,
            });

            if processes.len() >= max_processes {
                break;
            }
        }

        if processes.len() >= max_processes {
            break;
        }
    }

    // Sort by length (longest = most interesting)
    processes.sort_by(|a, b| b.step_count.cmp(&a.step_count));

    debug!(processes = processes.len(), "process detection complete");

    processes
}

/// BFS from an entry point, collecting the longest traces (max 4 branches per node).
fn bfs_traces(
    start: &str,
    forward: &HashMap<&str, Vec<(&str, f32)>>,
    max_depth: usize,
) -> Vec<Vec<String>> {
    let mut results: Vec<Vec<String>> = Vec::new();
    let mut queue: VecDeque<(Vec<String>, HashSet<String>)> = VecDeque::new();

    let mut initial_visited = HashSet::new();
    initial_visited.insert(start.to_string());
    queue.push_back((vec![start.to_string()], initial_visited));

    while let Some((path, visited)) = queue.pop_front() {
        if path.len() > max_depth {
            results.push(path);
            continue;
        }

        let current = path.last().unwrap().as_str();
        let neighbors = match forward.get(current) {
            Some(n) => n,
            None => {
                // Terminal node — save the trace
                if path.len() >= 2 {
                    results.push(path);
                }
                continue;
            }
        };

        // Take top 4 neighbors by confidence (limit branching)
        let mut sorted_neighbors = neighbors.clone();
        sorted_neighbors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut expanded = false;
        for (neighbor, _confidence) in sorted_neighbors.iter().take(4) {
            if visited.contains(*neighbor) {
                continue;
            }
            let mut new_path = path.clone();
            new_path.push(neighbor.to_string());
            let mut new_visited = visited.clone();
            new_visited.insert(neighbor.to_string());
            queue.push_back((new_path, new_visited));
            expanded = true;
        }

        if !expanded && path.len() >= 2 {
            results.push(path);
        }
    }

    // Keep only the longest traces, dedup subsets
    results.sort_by_key(|a| std::cmp::Reverse(a.len()));
    let mut kept: Vec<Vec<String>> = Vec::new();
    'outer: for trace in results {
        for existing in &kept {
            // Skip if trace is a prefix of an existing longer trace
            if existing.len() >= trace.len() && existing[..trace.len()] == trace[..] {
                continue 'outer;
            }
        }
        kept.push(trace);
    }

    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;

    #[test]
    fn detects_linear_process() {
        let nodes = vec![
            CodeNode::new(
                NodeLabel::Function,
                "handle_request",
                "src/api.rs",
                1,
                10,
                "rust",
            )
            .with_exported(true),
            CodeNode::new(
                NodeLabel::Function,
                "validate",
                "src/api.rs",
                11,
                20,
                "rust",
            ),
            CodeNode::new(NodeLabel::Function, "process", "src/api.rs", 21, 30, "rust"),
            CodeNode::new(NodeLabel::Function, "respond", "src/api.rs", 31, 40, "rust"),
        ];

        let edges = vec![
            CodeEdge::new(&nodes[0].id, &nodes[1].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[1].id, &nodes[2].id, EdgeType::Calls).with_confidence(0.9),
            CodeEdge::new(&nodes[2].id, &nodes[3].id, EdgeType::Calls).with_confidence(0.9),
        ];

        let processes = detect_processes(&nodes, &edges, 10, 50);
        assert!(!processes.is_empty(), "should detect at least one process");

        let longest = &processes[0];
        assert!(
            longest.step_count >= 3,
            "trace should have at least 3 steps, got {}",
            longest.step_count
        );
        assert!(longest.label.contains("handle_request"));
    }

    #[test]
    fn entry_point_scoring_prefers_exported() {
        let nodes = vec![
            CodeNode::new(NodeLabel::Function, "main", "src/main.rs", 1, 10, "rust")
                .with_exported(true),
            CodeNode::new(NodeLabel::Function, "helper", "src/lib.rs", 1, 10, "rust"),
        ];

        let edges =
            vec![CodeEdge::new(&nodes[0].id, &nodes[1].id, EdgeType::Calls).with_confidence(0.9)];

        let processes = detect_processes(&nodes, &edges, 10, 50);
        assert!(!processes.is_empty());
        assert_eq!(
            processes[0].entry_id, nodes[0].id,
            "main should be the entry point"
        );
    }

    #[test]
    fn skips_low_confidence_calls() {
        let nodes = vec![
            CodeNode::new(NodeLabel::Function, "a", "src/lib.rs", 1, 5, "rust"),
            CodeNode::new(NodeLabel::Function, "b", "src/lib.rs", 6, 10, "rust"),
        ];
        let edges =
            vec![CodeEdge::new(&nodes[0].id, &nodes[1].id, EdgeType::Calls).with_confidence(0.3)];
        let processes = detect_processes(&nodes, &edges, 10, 50);
        assert!(
            processes.is_empty(),
            "low confidence calls should be ignored"
        );
    }
}
