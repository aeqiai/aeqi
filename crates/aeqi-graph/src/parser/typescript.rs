use anyhow::{Context, Result};
use tree_sitter::{Language, Parser};

use super::{FileExtraction, LanguageProvider};
use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

pub struct TypeScriptProvider {
    language_ts: Language,
    language_tsx: Language,
}

impl TypeScriptProvider {
    pub fn new() -> Self {
        Self {
            language_ts: tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            language_tsx: tree_sitter_typescript::LANGUAGE_TSX.into(),
        }
    }
}

impl Default for TypeScriptProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageProvider for TypeScriptProvider {
    fn language_id(&self) -> &str {
        "typescript"
    }

    fn extensions(&self) -> &[&str] {
        &["ts", "tsx", "js", "jsx"]
    }

    fn extract(&self, source: &str, file_path: &str) -> Result<FileExtraction> {
        let is_tsx = file_path.ends_with(".tsx") || file_path.ends_with(".jsx");
        let lang = if is_tsx {
            &self.language_tsx
        } else {
            &self.language_ts
        };

        let mut parser = Parser::new();
        parser.set_language(lang)?;

        let tree = parser
            .parse(source, None)
            .context("tree-sitter parse failed")?;

        let root = tree.root_node();
        let mut extraction = FileExtraction::default();

        let file_node = CodeNode::new(
            NodeLabel::File,
            file_path.rsplit('/').next().unwrap_or(file_path),
            file_path,
            1,
            source.lines().count() as u32,
            "typescript",
        );
        let file_id = file_node.id.clone();
        extraction.nodes.push(file_node);

        extract_ts_items(root, source, file_path, &file_id, &mut extraction);

        Ok(extraction)
    }
}

fn extract_ts_items(
    node: tree_sitter::Node,
    source: &str,
    file_path: &str,
    parent_id: &str,
    extraction: &mut FileExtraction,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_declaration" | "generator_function_declaration" => {
                if let Some(code_node) =
                    extract_ts_named(&child, source, file_path, NodeLabel::Function)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_ts_calls(&child, source, file_path, &id, extraction);
                }
            }
            "class_declaration" => {
                if let Some(code_node) =
                    extract_ts_named(&child, source, file_path, NodeLabel::Class)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_ts_class_body(&child, source, file_path, &id, extraction);

                    // Check extends
                    if let Some(heritage) = child.child_by_field_name("heritage")
                        && let Ok(text) = heritage.utf8_text(source.as_bytes())
                    {
                        extraction.edges.push(
                            CodeEdge::new(
                                &id,
                                format!("unresolved:trait:{}", text.trim()),
                                EdgeType::Extends,
                            )
                            .with_confidence(0.5),
                        );
                    }
                }
            }
            "interface_declaration" => {
                if let Some(code_node) =
                    extract_ts_named(&child, source, file_path, NodeLabel::Interface)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "type_alias_declaration" => {
                if let Some(code_node) =
                    extract_ts_named(&child, source, file_path, NodeLabel::TypeAlias)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "enum_declaration" => {
                if let Some(code_node) =
                    extract_ts_named(&child, source, file_path, NodeLabel::Enum)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                // const Foo = () => {} or const Bar = function() {}
                extract_ts_variable_decls(&child, source, file_path, parent_id, extraction);
            }
            "export_statement" => {
                // Recurse into exported declarations
                extract_ts_items(child, source, file_path, parent_id, extraction);
                // Mark the last node as exported
                if let Some(last) = extraction.nodes.last_mut() {
                    last.is_exported = true;
                }
            }
            "import_statement" => {
                // Extract named imports: `import { Foo, Bar } from './module'`
                let mut cursor_imp = child.walk();
                for imp_child in child.children(&mut cursor_imp) {
                    if imp_child.kind() == "import_clause" {
                        let mut clause_cursor = imp_child.walk();
                        for clause_child in imp_child.children(&mut clause_cursor) {
                            if clause_child.kind() == "named_imports" {
                                let mut named_cursor = clause_child.walk();
                                for named in clause_child.children(&mut named_cursor) {
                                    if named.kind() == "import_specifier" {
                                        let imported_name = named
                                            .child_by_field_name("alias")
                                            .or_else(|| named.child_by_field_name("name"))
                                            .and_then(|n| n.utf8_text(source.as_bytes()).ok());
                                        if let Some(name) = imported_name {
                                            extraction.edges.push(
                                                CodeEdge::new(
                                                    parent_id,
                                                    format!("unresolved:import:{name}"),
                                                    EdgeType::Imports,
                                                )
                                                .with_confidence(0.5),
                                            );
                                        }
                                    }
                                }
                            } else if clause_child.kind() == "identifier" {
                                // Default import: `import Foo from './module'`
                                if let Ok(name) = clause_child.utf8_text(source.as_bytes()) {
                                    extraction.edges.push(
                                        CodeEdge::new(
                                            parent_id,
                                            format!("unresolved:import:{name}"),
                                            EdgeType::Imports,
                                        )
                                        .with_confidence(0.5),
                                    );
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn extract_ts_named(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    label: NodeLabel,
) -> Option<CodeNode> {
    let name_node = node.child_by_field_name("name")?;
    let name = name_node.utf8_text(source.as_bytes()).ok()?;
    let start = node.start_position().row as u32 + 1;
    let end = node.end_position().row as u32 + 1;

    let doc = collect_ts_doc(node, source);
    let mut code_node = CodeNode::new(label, name, file_path, start, end, "typescript");
    if let Some(doc) = doc {
        code_node = code_node.with_doc(doc);
    }

    Some(code_node)
}

fn extract_ts_variable_decls(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    parent_id: &str,
    extraction: &mut FileExtraction,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            let name_node = match child.child_by_field_name("name") {
                Some(n) => n,
                None => continue,
            };
            let name = match name_node.utf8_text(source.as_bytes()) {
                Ok(n) => n,
                Err(_) => continue,
            };

            // Check if value is an arrow function or function expression
            if let Some(value) = child.child_by_field_name("value") {
                let is_func = matches!(
                    value.kind(),
                    "arrow_function" | "function_expression" | "generator_function"
                );
                if is_func {
                    let start = node.start_position().row as u32 + 1;
                    let end = node.end_position().row as u32 + 1;
                    let code_node = CodeNode::new(
                        NodeLabel::Function,
                        name,
                        file_path,
                        start,
                        end,
                        "typescript",
                    );
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_ts_calls(&value, source, file_path, &id, extraction);
                } else {
                    let start = node.start_position().row as u32 + 1;
                    let end = node.end_position().row as u32 + 1;
                    let code_node = CodeNode::new(
                        NodeLabel::Variable,
                        name,
                        file_path,
                        start,
                        end,
                        "typescript",
                    );
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
        }
    }
}

fn extract_ts_class_body(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    class_id: &str,
    extraction: &mut FileExtraction,
) {
    if let Some(body) = node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            match child.kind() {
                "method_definition" | "public_field_definition" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(source.as_bytes())
                    {
                        let start = child.start_position().row as u32 + 1;
                        let end = child.end_position().row as u32 + 1;
                        let label = if child.kind() == "method_definition" {
                            NodeLabel::Method
                        } else {
                            NodeLabel::Property
                        };
                        let method =
                            CodeNode::new(label, name, file_path, start, end, "typescript");
                        let mid = method.id.clone();
                        let edge_type = if label == NodeLabel::Method {
                            EdgeType::HasMethod
                        } else {
                            EdgeType::HasProperty
                        };
                        extraction
                            .edges
                            .push(CodeEdge::new(class_id, &mid, edge_type));
                        extraction.nodes.push(method);
                        if label == NodeLabel::Method {
                            extract_ts_calls(&child, source, file_path, &mid, extraction);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

fn extract_ts_calls(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    caller_id: &str,
    extraction: &mut FileExtraction,
) {
    extract_ts_calls_recursive(*node, source, file_path, caller_id, extraction);
}

#[allow(clippy::only_used_in_recursion)]
fn extract_ts_calls_recursive(
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
        let call_name = call_text.rsplit('.').next().unwrap_or(call_text);
        if !call_name.is_empty() && call_name.len() < 100 {
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
        extract_ts_calls_recursive(child, source, file_path, caller_id, extraction);
    }
}

fn collect_ts_doc(node: &tree_sitter::Node, source: &str) -> Option<String> {
    let mut prev = node.prev_sibling();
    while let Some(sib) = prev {
        match sib.kind() {
            "comment" => {
                let text = sib.utf8_text(source.as_bytes()).ok()?;
                if text.starts_with("/**") {
                    let content = text.trim_start_matches("/**").trim_end_matches("*/").trim();
                    return Some(content.to_string());
                }
                if text.starts_with("//") {
                    let content = text.trim_start_matches("//").trim();
                    return Some(content.to_string());
                }
                return None;
            }
            "decorator" => {
                prev = sib.prev_sibling();
                continue;
            }
            _ => return None,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ts_function_and_class() {
        let provider = TypeScriptProvider::new();
        let source = r#"
/** Fetches user data */
export function fetchUser(id: string): Promise<User> {
    return db.query(id);
}

export class UserService {
    private db: Database;

    async getUser(id: string): Promise<User> {
        return this.db.find(id);
    }

    async deleteUser(id: string): Promise<void> {
        await this.db.delete(id);
    }
}

export interface User {
    id: string;
    name: string;
}

export type UserId = string;
"#;
        let result = provider.extract(source, "src/users.ts").unwrap();

        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "fetchUser" && n.label == NodeLabel::Function)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "UserService" && n.label == NodeLabel::Class)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "User" && n.label == NodeLabel::Interface)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "UserId" && n.label == NodeLabel::TypeAlias)
        );

        let methods: Vec<_> = result
            .nodes
            .iter()
            .filter(|n| n.label == NodeLabel::Method)
            .collect();
        assert_eq!(methods.len(), 2, "should have getUser and deleteUser");

        let fetch_user = result.nodes.iter().find(|n| n.name == "fetchUser").unwrap();
        assert!(fetch_user.is_exported);

        let calls: Vec<_> = result
            .edges
            .iter()
            .filter(|e| e.edge_type == EdgeType::Calls)
            .collect();
        assert!(!calls.is_empty(), "should have call edges");
    }

    #[test]
    fn parse_ts_arrow_functions() {
        let provider = TypeScriptProvider::new();
        let source = r#"
export const handler = async (req: Request) => {
    const result = await process(req);
    return respond(result);
};

const CONSTANT = 42;
"#;
        let result = provider.extract(source, "src/api.ts").unwrap();

        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "handler" && n.label == NodeLabel::Function),
            "arrow function should be extracted as Function"
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "CONSTANT" && n.label == NodeLabel::Variable),
            "const should be extracted as Variable"
        );
    }

    #[test]
    fn parse_tsx() {
        let provider = TypeScriptProvider::new();
        let source = r#"
export function App() {
    return <div>Hello</div>;
}
"#;
        let result = provider.extract(source, "src/App.tsx").unwrap();
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "App" && n.label == NodeLabel::Function)
        );
    }
}
