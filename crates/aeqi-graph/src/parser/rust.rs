use anyhow::{Context, Result};
use tree_sitter::{Language, Parser};

use super::{FileExtraction, LanguageProvider};
use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

pub struct RustProvider {
    language: Language,
}

impl RustProvider {
    pub fn new() -> Self {
        Self {
            language: tree_sitter_rust::LANGUAGE.into(),
        }
    }
}

impl Default for RustProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageProvider for RustProvider {
    fn language_id(&self) -> &str {
        "rust"
    }

    fn extensions(&self) -> &[&str] {
        &["rs"]
    }

    fn extract(&self, source: &str, file_path: &str) -> Result<FileExtraction> {
        let mut parser = Parser::new();
        parser.set_language(&self.language)?;

        let tree = parser
            .parse(source, None)
            .context("tree-sitter parse failed")?;

        let root = tree.root_node();
        let mut extraction = FileExtraction::default();
        let lines: Vec<&str> = source.lines().collect();

        // File node
        let file_node = CodeNode::new(
            NodeLabel::File,
            file_path.rsplit('/').next().unwrap_or(file_path),
            file_path,
            1,
            lines.len() as u32,
            "rust",
        );
        let file_id = file_node.id.clone();
        extraction.nodes.push(file_node);

        // Walk the AST
        extract_items(root, source, file_path, &file_id, &mut extraction);

        Ok(extraction)
    }
}

fn extract_items(
    node: tree_sitter::Node,
    source: &str,
    file_path: &str,
    parent_id: &str,
    extraction: &mut FileExtraction,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_item" => {
                if let Some(code_node) = extract_function(&child, source, file_path) {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_calls(&child, source, file_path, &id, extraction);
                }
            }
            "struct_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Struct)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_fields(&child, source, file_path, &id, extraction);
                }
            }
            "enum_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Enum)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "trait_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Trait)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_trait_methods(&child, source, file_path, &id, extraction);
                }
            }
            "impl_item" => {
                extract_impl(&child, source, file_path, parent_id, extraction);
            }
            "type_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::TypeAlias)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "const_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Const)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "static_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Static)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "macro_definition" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Macro)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "use_declaration" => {
                extract_use(&child, source, file_path, parent_id, extraction);
            }
            "mod_item" => {
                if let Some(code_node) =
                    extract_named_item(&child, source, file_path, NodeLabel::Module)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    // Recurse into inline module body
                    if let Some(body) = child.child_by_field_name("body") {
                        extract_items(body, source, file_path, &id, extraction);
                    }
                }
            }
            _ => {}
        }
    }
}

fn extract_function(node: &tree_sitter::Node, source: &str, file_path: &str) -> Option<CodeNode> {
    let name_node = node.child_by_field_name("name")?;
    let name = name_node.utf8_text(source.as_bytes()).ok()?;
    let start = node.start_position().row as u32 + 1;
    let end = node.end_position().row as u32 + 1;

    let is_pub = node
        .children(&mut node.walk())
        .any(|c| c.kind() == "visibility_modifier");

    // Build signature from function header (up to the body)
    let sig = if let Some(params) = node.child_by_field_name("parameters") {
        let ret = node
            .child_by_field_name("return_type")
            .and_then(|r| r.utf8_text(source.as_bytes()).ok())
            .unwrap_or("");
        let params_text = params.utf8_text(source.as_bytes()).unwrap_or("()");
        if ret.is_empty() {
            format!("fn {name}{params_text}")
        } else {
            format!("fn {name}{params_text} -> {ret}")
        }
    } else {
        format!("fn {name}()")
    };

    // Collect doc comment from preceding siblings
    let doc = collect_doc_comment(node, source);

    let mut code_node = CodeNode::new(NodeLabel::Function, name, file_path, start, end, "rust")
        .with_exported(is_pub)
        .with_signature(sig);

    if let Some(doc) = doc {
        code_node = code_node.with_doc(doc);
    }

    Some(code_node)
}

fn extract_named_item(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    label: NodeLabel,
) -> Option<CodeNode> {
    let name_node = node.child_by_field_name("name")?;
    let name = name_node.utf8_text(source.as_bytes()).ok()?;
    let start = node.start_position().row as u32 + 1;
    let end = node.end_position().row as u32 + 1;

    let is_pub = node
        .children(&mut node.walk())
        .any(|c| c.kind() == "visibility_modifier");

    let doc = collect_doc_comment(node, source);
    let mut code_node =
        CodeNode::new(label, name, file_path, start, end, "rust").with_exported(is_pub);

    if let Some(doc) = doc {
        code_node = code_node.with_doc(doc);
    }

    Some(code_node)
}

fn extract_impl(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    parent_id: &str,
    extraction: &mut FileExtraction,
) {
    let start = node.start_position().row as u32 + 1;
    let end = node.end_position().row as u32 + 1;

    // Get the type being implemented
    let type_node = node.child_by_field_name("type");
    let type_name = type_node
        .and_then(|n| n.utf8_text(source.as_bytes()).ok())
        .unwrap_or("unknown");

    // Check if it's a trait impl (has "trait" field)
    let trait_node = node.child_by_field_name("trait");
    let trait_name = trait_node.and_then(|n| n.utf8_text(source.as_bytes()).ok());

    let impl_name = if let Some(trait_name) = &trait_name {
        format!("{trait_name} for {type_name}")
    } else {
        type_name.to_string()
    };

    let impl_node = CodeNode::new(NodeLabel::Impl, &impl_name, file_path, start, end, "rust");
    let impl_id = impl_node.id.clone();
    extraction
        .edges
        .push(CodeEdge::new(parent_id, &impl_id, EdgeType::Contains));
    extraction.nodes.push(impl_node);

    // If trait impl, create Implements edge (unresolved — target is trait name, not ID)
    if let Some(trait_name) = &trait_name {
        // Store as a placeholder edge — resolution happens in a later phase
        extraction.edges.push(
            CodeEdge::new(
                &impl_id,
                format!("unresolved:trait:{trait_name}"),
                EdgeType::Implements,
            )
            .with_confidence(0.5),
        );
    }

    // Extract methods inside the impl body
    if let Some(body) = node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            if child.kind() == "function_item"
                && let Some(mut method) = extract_function(&child, source, file_path)
            {
                method.label = NodeLabel::Method;
                let method_id = method.id.clone();
                extraction
                    .edges
                    .push(CodeEdge::new(&impl_id, &method_id, EdgeType::HasMethod));
                extraction.nodes.push(method);
                extract_calls(&child, source, file_path, &method_id, extraction);
            }
        }
    }
}

fn extract_trait_methods(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    trait_id: &str,
    extraction: &mut FileExtraction,
) {
    if let Some(body) = node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            if (child.kind() == "function_item" || child.kind() == "function_signature_item")
                && let Some(name_node) = child.child_by_field_name("name")
                && let Ok(name) = name_node.utf8_text(source.as_bytes())
            {
                let start = child.start_position().row as u32 + 1;
                let end = child.end_position().row as u32 + 1;
                let method = CodeNode::new(NodeLabel::Method, name, file_path, start, end, "rust");
                let method_id = method.id.clone();
                extraction
                    .edges
                    .push(CodeEdge::new(trait_id, &method_id, EdgeType::HasMethod));
                extraction.nodes.push(method);
            }
        }
    }
}

fn extract_fields(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    struct_id: &str,
    extraction: &mut FileExtraction,
) {
    if let Some(body) = node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            if child.kind() == "field_declaration"
                && let Some(name_node) = child.child_by_field_name("name")
                && let Ok(name) = name_node.utf8_text(source.as_bytes())
            {
                let start = child.start_position().row as u32 + 1;
                let end = child.end_position().row as u32 + 1;
                let field = CodeNode::new(NodeLabel::Property, name, file_path, start, end, "rust");
                let field_id = field.id.clone();
                extraction
                    .edges
                    .push(CodeEdge::new(struct_id, &field_id, EdgeType::HasProperty));
                extraction.nodes.push(field);
            }
        }
    }
}

fn extract_calls(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    caller_id: &str,
    extraction: &mut FileExtraction,
) {
    extract_calls_recursive(*node, source, file_path, caller_id, extraction);
}

#[allow(clippy::only_used_in_recursion)]
fn extract_calls_recursive(
    node: tree_sitter::Node,
    source: &str,
    file_path: &str,
    caller_id: &str,
    extraction: &mut FileExtraction,
) {
    if node.kind() == "call_expression"
        && let Some(func) = node.child_by_field_name("function")
    {
        let call_text = func.utf8_text(source.as_bytes()).unwrap_or("");
        // Extract the final name (e.g., "self.observer.record" -> "record")
        let call_name = call_text.rsplit("::").next().unwrap_or(call_text);
        let call_name = call_name.rsplit('.').next().unwrap_or(call_name);

        if !call_name.is_empty() {
            extraction.edges.push(
                CodeEdge::new(
                    caller_id,
                    format!("unresolved:call:{call_name}"),
                    EdgeType::Calls,
                )
                .with_confidence(0.5),
            );
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        extract_calls_recursive(child, source, file_path, caller_id, extraction);
    }
}

fn extract_use(
    node: &tree_sitter::Node,
    source: &str,
    _file_path: &str,
    parent_id: &str,
    extraction: &mut FileExtraction,
) {
    let text = node.utf8_text(source.as_bytes()).unwrap_or("");
    if text.is_empty() {
        return;
    }
    // Store the import as an unresolved edge — resolution happens later
    extraction.edges.push(
        CodeEdge::new(
            parent_id,
            format!("unresolved:import:{text}"),
            EdgeType::Imports,
        )
        .with_confidence(0.5),
    );
}

fn collect_doc_comment(node: &tree_sitter::Node, source: &str) -> Option<String> {
    let mut comments = Vec::new();
    let mut prev = node.prev_sibling();

    while let Some(sib) = prev {
        match sib.kind() {
            "line_comment" => {
                let text = sib.utf8_text(source.as_bytes()).ok()?;
                if text.starts_with("///") || text.starts_with("//!") {
                    let content = text
                        .trim_start_matches("///")
                        .trim_start_matches("//!")
                        .trim();
                    comments.push(content.to_string());
                } else {
                    break;
                }
            }
            "block_comment" => {
                let text = sib.utf8_text(source.as_bytes()).ok()?;
                if text.starts_with("/**") {
                    let content = text.trim_start_matches("/**").trim_end_matches("*/").trim();
                    comments.push(content.to_string());
                }
                break;
            }
            "attribute_item" => {
                // Skip attributes between doc comments and the item
            }
            _ => break,
        }
        prev = sib.prev_sibling();
    }

    if comments.is_empty() {
        None
    } else {
        comments.reverse();
        Some(comments.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rust_function() {
        let provider = RustProvider::new();
        let source = r#"
/// Adds two numbers.
pub fn add(a: u32, b: u32) -> u32 {
    a + b
}
"#;
        let result = provider.extract(source, "src/math.rs").unwrap();
        // File + function = 2 nodes
        assert!(result.nodes.len() >= 2);

        let func = result.nodes.iter().find(|n| n.name == "add").unwrap();
        assert_eq!(func.label, NodeLabel::Function);
        assert!(func.is_exported);
        assert!(func.signature.as_ref().unwrap().contains("-> u32"));
        assert!(
            func.doc_comment
                .as_ref()
                .unwrap()
                .contains("Adds two numbers")
        );
    }

    #[test]
    fn parse_rust_struct_and_impl() {
        let provider = RustProvider::new();
        let source = r#"
pub struct Agent {
    name: String,
    config: Config,
}

impl Agent {
    pub fn new(name: String) -> Self {
        Self { name, config: Config::default() }
    }

    pub fn run(&self) {
        self.execute();
    }
}
"#;
        let result = provider.extract(source, "src/agent.rs").unwrap();

        let struct_node = result.nodes.iter().find(|n| n.name == "Agent").unwrap();
        assert_eq!(struct_node.label, NodeLabel::Struct);

        let methods: Vec<_> = result
            .nodes
            .iter()
            .filter(|n| n.label == NodeLabel::Method)
            .collect();
        assert_eq!(methods.len(), 2);

        // Should have CALLS edges for Config::default() and self.execute()
        let call_edges: Vec<_> = result
            .edges
            .iter()
            .filter(|e| e.edge_type == EdgeType::Calls)
            .collect();
        assert!(!call_edges.is_empty());
    }

    #[test]
    fn parse_rust_trait_and_impl() {
        let provider = RustProvider::new();
        let source = r#"
pub trait Observer: Send + Sync {
    fn record(&self, event: Event);
    fn name(&self) -> &str;
}

pub struct LogObserver;

impl Observer for LogObserver {
    fn record(&self, event: Event) {}
    fn name(&self) -> &str { "log" }
}
"#;
        let result = provider.extract(source, "src/observer.rs").unwrap();

        let trait_node = result.nodes.iter().find(|n| n.name == "Observer").unwrap();
        assert_eq!(trait_node.label, NodeLabel::Trait);

        // Check Implements edge exists
        let impl_edges: Vec<_> = result
            .edges
            .iter()
            .filter(|e| e.edge_type == EdgeType::Implements)
            .collect();
        assert!(!impl_edges.is_empty());

        // Check HasMethod edges
        let method_edges: Vec<_> = result
            .edges
            .iter()
            .filter(|e| e.edge_type == EdgeType::HasMethod)
            .collect();
        assert!(method_edges.len() >= 2); // trait methods
    }

    #[test]
    fn parse_rust_enum_and_const() {
        let provider = RustProvider::new();
        let source = r#"
pub enum Color {
    Red,
    Green,
    Blue,
}

pub const MAX_SIZE: usize = 1024;

pub type Result<T> = std::result::Result<T, Error>;
"#;
        let result = provider.extract(source, "src/types.rs").unwrap();

        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "Color" && n.label == NodeLabel::Enum)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "MAX_SIZE" && n.label == NodeLabel::Const)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "Result" && n.label == NodeLabel::TypeAlias)
        );
    }
}
