use std::collections::HashMap;
use tracing::debug;

use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel, ResolutionTier};

/// Lookup structure mapping symbol names to node IDs, scoped by file and globally.
#[derive(Debug, Default)]
pub struct SymbolTable {
    /// file_path → name → Vec<node_id> (same-file resolution, tier 1)
    by_file: HashMap<String, HashMap<String, Vec<String>>>,
    /// name → Vec<(node_id, file_path, is_exported)> (cross-file resolution, tiers 2-3)
    global: HashMap<String, Vec<SymbolEntry>>,
}

#[derive(Debug, Clone)]
struct SymbolEntry {
    node_id: String,
    file_path: String,
    is_exported: bool,
    label: NodeLabel,
}

impl SymbolTable {
    pub fn new() -> Self {
        Self::default()
    }

    /// Index all nodes into the symbol table.
    pub fn index(&mut self, nodes: &[CodeNode]) {
        for node in nodes {
            // Skip structural/synthetic nodes
            if matches!(
                node.label,
                NodeLabel::File | NodeLabel::Module | NodeLabel::Community | NodeLabel::Process
            ) {
                continue;
            }

            // File-scoped index
            self.by_file
                .entry(node.file_path.clone())
                .or_default()
                .entry(node.name.clone())
                .or_default()
                .push(node.id.clone());

            // Global index
            self.global
                .entry(node.name.clone())
                .or_default()
                .push(SymbolEntry {
                    node_id: node.id.clone(),
                    file_path: node.file_path.clone(),
                    is_exported: node.is_exported,
                    label: node.label,
                });
        }
    }

    /// Tier 1: same-file lookup.
    fn resolve_same_file(&self, name: &str, file_path: &str) -> Option<&str> {
        self.by_file
            .get(file_path)?
            .get(name)?
            .first()
            .map(|s| s.as_str())
    }

    /// Tier 2: exported symbols matching by name (cross-file).
    fn resolve_exported(&self, name: &str) -> Option<&SymbolEntry> {
        let entries = self.global.get(name)?;
        // Prefer exported symbols
        entries
            .iter()
            .find(|e| e.is_exported)
            .or_else(|| entries.first())
    }

    /// Tier 3: any symbol matching by name (global fallback).
    fn resolve_any(&self, name: &str) -> Option<&SymbolEntry> {
        self.global.get(name)?.first()
    }

    /// Resolve a symbol name with 3-tier fallback. Returns (node_id, tier).
    pub fn resolve(&self, name: &str, from_file: &str) -> Option<(String, ResolutionTier)> {
        // Tier 1: same file
        if let Some(id) = self.resolve_same_file(name, from_file) {
            return Some((id.to_string(), ResolutionTier::SameFile));
        }

        // Tier 2: exported cross-file
        if let Some(entry) = self.resolve_exported(name)
            && entry.is_exported
        {
            return Some((entry.node_id.clone(), ResolutionTier::ImportScoped));
        }

        // Tier 3: global fallback
        if let Some(entry) = self.resolve_any(name) {
            return Some((entry.node_id.clone(), ResolutionTier::Global));
        }

        None
    }

    /// Resolve specifically looking for a trait by name.
    pub fn resolve_trait(&self, name: &str) -> Option<String> {
        let entries = self.global.get(name)?;
        entries
            .iter()
            .find(|e| e.label == NodeLabel::Trait)
            .map(|e| e.node_id.clone())
    }

    /// Resolve a method name when we know the receiver type.
    /// Looks for a Method node with the given name that belongs to the given type.
    pub fn resolve_method_on_type(
        &self,
        method_name: &str,
        type_name: &str,
    ) -> Option<(String, ResolutionTier)> {
        // Look for method_name entries that are Methods
        let entries = self.global.get(method_name)?;
        for entry in entries {
            if entry.label == NodeLabel::Method {
                // Check if this method's file also contains the type
                // (crude heuristic: same file as a struct/trait/impl of the same name)
                if let Some(type_entries) = self.global.get(type_name) {
                    for te in type_entries {
                        if te.file_path == entry.file_path {
                            return Some((entry.node_id.clone(), ResolutionTier::ImportScoped));
                        }
                    }
                }
            }
        }
        None
    }

    pub fn node_count(&self) -> usize {
        self.global.values().map(|v| v.len()).sum()
    }
}

/// Resolve all unresolved edges in the graph using the symbol table and type environments.
/// Returns (resolved_edges, unresolved_count).
pub fn resolve_graph(
    nodes: &[CodeNode],
    edges: Vec<CodeEdge>,
    type_envs: &HashMap<String, crate::extract::types::TypeEnv>,
) -> (Vec<CodeEdge>, usize) {
    let mut table = SymbolTable::new();
    table.index(nodes);

    // Build lookups: node_id → file_path, node_id → node_name (for scope resolution)
    let node_file: HashMap<&str, &str> = nodes
        .iter()
        .map(|n| (n.id.as_str(), n.file_path.as_str()))
        .collect();
    let node_name: HashMap<&str, &str> = nodes
        .iter()
        .map(|n| (n.id.as_str(), n.name.as_str()))
        .collect();

    let mut resolved = Vec::with_capacity(edges.len());
    let mut unresolved_count = 0usize;
    let mut type_resolved_count = 0usize;

    for edge in edges {
        if !edge.target_id.starts_with("unresolved:") {
            resolved.push(edge);
            continue;
        }

        let source_file = node_file
            .get(edge.source_id.as_str())
            .copied()
            .unwrap_or("");
        let source_name = node_name
            .get(edge.source_id.as_str())
            .copied()
            .unwrap_or("");

        let parts: Vec<&str> = edge.target_id.splitn(3, ':').collect();
        if parts.len() < 3 {
            unresolved_count += 1;
            continue;
        }
        let kind = parts[1];
        let name = parts[2];

        match kind {
            "trait" => {
                if let Some(trait_id) = table.resolve_trait(name) {
                    resolved.push(CodeEdge {
                        target_id: trait_id,
                        confidence: ResolutionTier::ImportScoped.confidence(),
                        tier: Some(ResolutionTier::ImportScoped.as_str().to_string()),
                        ..edge
                    });
                } else {
                    unresolved_count += 1;
                    debug!(name, "unresolved trait");
                }
            }
            "call" => {
                // Try standard name-based resolution first
                if let Some((target_id, tier)) = table.resolve(name, source_file) {
                    resolved.push(CodeEdge {
                        target_id,
                        confidence: tier.confidence(),
                        tier: Some(tier.as_str().to_string()),
                        ..edge
                    });
                }
                // If standard resolution fails or gets Global tier, try type-aware resolution
                else if let Some(env) = type_envs.get(source_file) {
                    // The caller is source_name (a method/function). Check if "self" has a known type
                    // in that scope, which means this is a method call on self's type.
                    let receiver_type = env.resolve_type(source_name, "self");
                    if let Some(type_name) = receiver_type
                        && let Some((target_id, tier)) =
                            table.resolve_method_on_type(name, type_name)
                    {
                        resolved.push(CodeEdge {
                            target_id,
                            confidence: tier.confidence(),
                            tier: Some(tier.as_str().to_string()),
                            ..edge
                        });
                        type_resolved_count += 1;
                        continue;
                    }
                    unresolved_count += 1;
                } else {
                    unresolved_count += 1;
                }
            }
            "import" => {
                // Use declarations — extract the imported name(s) and link
                // "use crate::foo::Bar" → resolve "Bar"
                // "use crate::foo::{Bar, Baz}" → resolve each
                let import_names = extract_import_names(name);
                for import_name in import_names {
                    if let Some((target_id, tier)) = table.resolve(&import_name, source_file) {
                        resolved.push(
                            CodeEdge::new(&edge.source_id, &target_id, EdgeType::Imports)
                                .with_tier(tier),
                        );
                    }
                }
                // Don't count import resolution failures — many imports are for external crates
            }
            _ => {
                unresolved_count += 1;
            }
        }
    }

    debug!(
        resolved = resolved.len(),
        unresolved = unresolved_count,
        type_resolved = type_resolved_count,
        "graph resolution complete"
    );

    (resolved, unresolved_count)
}

/// Extract individual symbol names from a Rust use declaration.
/// "use crate::traits::{Observer, Provider}" → ["Observer", "Provider"]
/// "use std::sync::Arc" → ["Arc"]
/// "use super::*" → [] (wildcard, can't resolve statically)
fn extract_import_names(use_text: &str) -> Vec<String> {
    let text = use_text
        .trim()
        .trim_start_matches("use ")
        .trim_end_matches(';');

    // Wildcard import — can't resolve statically
    if text.ends_with("::*") {
        return vec![];
    }

    // Group import: "crate::foo::{Bar, Baz as B}"
    if let Some(brace_start) = text.find('{')
        && let Some(brace_end) = text.rfind('}')
    {
        let inner = &text[brace_start + 1..brace_end];
        return inner
            .split(',')
            .filter_map(|item| {
                let item = item.trim();
                if item.is_empty() {
                    return None;
                }
                // Handle "Foo as Bar" — the local name is "Bar"
                if let Some((_orig, alias)) = item.split_once(" as ") {
                    Some(alias.trim().to_string())
                } else {
                    Some(item.to_string())
                }
            })
            .collect();
    }

    // Simple import: "std::sync::Arc" → "Arc"
    // Or: "crate::foo::Bar as Baz" → "Baz"
    if let Some((_path, alias)) = text.split_once(" as ") {
        return vec![alias.trim().to_string()];
    }

    if let Some(last) = text.rsplit("::").next()
        && !last.is_empty()
    {
        return vec![last.to_string()];
    }

    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::*;

    #[test]
    fn symbol_table_same_file_resolution() {
        let mut table = SymbolTable::new();
        let nodes = vec![
            CodeNode::new(NodeLabel::Function, "helper", "src/lib.rs", 1, 10, "rust"),
            CodeNode::new(NodeLabel::Function, "main", "src/lib.rs", 12, 20, "rust"),
        ];
        table.index(&nodes);

        let (id, tier) = table.resolve("helper", "src/lib.rs").unwrap();
        assert_eq!(id, nodes[0].id);
        assert_eq!(tier, ResolutionTier::SameFile);
    }

    #[test]
    fn symbol_table_cross_file_resolution() {
        let mut table = SymbolTable::new();
        let nodes = vec![
            CodeNode::new(NodeLabel::Trait, "Observer", "src/traits.rs", 1, 50, "rust")
                .with_exported(true),
            CodeNode::new(NodeLabel::Function, "main", "src/main.rs", 1, 10, "rust"),
        ];
        table.index(&nodes);

        // From a different file, resolves via exported (tier 2)
        let (id, tier) = table.resolve("Observer", "src/main.rs").unwrap();
        assert_eq!(id, nodes[0].id);
        assert_eq!(tier, ResolutionTier::ImportScoped);
    }

    #[test]
    fn symbol_table_trait_resolution() {
        let mut table = SymbolTable::new();
        let nodes = vec![
            CodeNode::new(NodeLabel::Trait, "Observer", "src/traits.rs", 1, 50, "rust"),
            CodeNode::new(NodeLabel::Struct, "Observer", "src/other.rs", 1, 10, "rust"),
        ];
        table.index(&nodes);

        // resolve_trait should find the Trait, not the Struct
        let trait_id = table.resolve_trait("Observer").unwrap();
        assert_eq!(trait_id, nodes[0].id);
    }

    #[test]
    fn resolve_graph_calls() {
        let nodes = vec![
            CodeNode::new(NodeLabel::Function, "main", "src/main.rs", 1, 10, "rust"),
            CodeNode::new(NodeLabel::Function, "helper", "src/lib.rs", 1, 10, "rust")
                .with_exported(true),
        ];
        let edges = vec![
            CodeEdge::new(&nodes[0].id, "unresolved:call:helper", EdgeType::Calls)
                .with_confidence(0.5),
        ];

        let (resolved, unresolved) = resolve_graph(&nodes, edges, &HashMap::new());
        assert_eq!(unresolved, 0);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].target_id, nodes[1].id);
        assert!(resolved[0].confidence > 0.8); // Should be ImportScoped (0.9)
    }

    #[test]
    fn resolve_graph_trait_impl() {
        let nodes = vec![
            CodeNode::new(NodeLabel::Trait, "Observer", "src/traits.rs", 1, 50, "rust")
                .with_exported(true),
            CodeNode::new(
                NodeLabel::Impl,
                "Observer for LogObserver",
                "src/log.rs",
                1,
                30,
                "rust",
            ),
        ];
        let edges = vec![
            CodeEdge::new(
                &nodes[1].id,
                "unresolved:trait:Observer",
                EdgeType::Implements,
            )
            .with_confidence(0.5),
        ];

        let (resolved, unresolved) = resolve_graph(&nodes, edges, &HashMap::new());
        assert_eq!(unresolved, 0);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].target_id, nodes[0].id);
        assert_eq!(resolved[0].edge_type, EdgeType::Implements);
    }

    #[test]
    fn resolve_graph_imports() {
        let nodes = vec![
            CodeNode::new(NodeLabel::File, "main.rs", "src/main.rs", 1, 100, "rust"),
            CodeNode::new(NodeLabel::Trait, "Observer", "src/traits.rs", 1, 50, "rust")
                .with_exported(true),
            CodeNode::new(
                NodeLabel::Struct,
                "LogObserver",
                "src/traits.rs",
                52,
                60,
                "rust",
            )
            .with_exported(true),
        ];
        let edges = vec![CodeEdge::new(
            &nodes[0].id,
            "unresolved:import:use crate::traits::{Observer, LogObserver}",
            EdgeType::Imports,
        )];

        let (resolved, _) = resolve_graph(&nodes, edges, &HashMap::new());
        // Should produce 2 resolved import edges
        let import_edges: Vec<_> = resolved
            .iter()
            .filter(|e| e.edge_type == EdgeType::Imports)
            .collect();
        assert_eq!(import_edges.len(), 2);
    }

    #[test]
    fn extract_import_names_group() {
        let names = extract_import_names("use crate::traits::{Observer, Provider, Tool}");
        assert_eq!(names, vec!["Observer", "Provider", "Tool"]);
    }

    #[test]
    fn extract_import_names_alias() {
        let names = extract_import_names("use crate::traits::Observer as Obs");
        assert_eq!(names, vec!["Obs"]);
    }

    #[test]
    fn extract_import_names_simple() {
        let names = extract_import_names("use std::sync::Arc");
        assert_eq!(names, vec!["Arc"]);
    }

    #[test]
    fn extract_import_names_wildcard() {
        let names = extract_import_names("use super::*");
        assert!(names.is_empty());
    }

    #[test]
    fn extract_import_names_group_with_alias() {
        let names =
            extract_import_names("use crate::middleware::{ToolCall as MwToolCall, ToolResult}");
        assert_eq!(names, vec!["MwToolCall", "ToolResult"]);
    }
}
