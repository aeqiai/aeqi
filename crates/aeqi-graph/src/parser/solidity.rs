use anyhow::{Context, Result};
use tree_sitter::{Language, Parser};

use super::{FileExtraction, LanguageProvider};
use crate::schema::{CodeEdge, CodeNode, EdgeType, NodeLabel};

pub struct SolidityProvider {
    language: Language,
}

impl SolidityProvider {
    pub fn new() -> Self {
        Self {
            language: tree_sitter_solidity::LANGUAGE.into(),
        }
    }
}

impl Default for SolidityProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl LanguageProvider for SolidityProvider {
    fn language_id(&self) -> &str {
        "solidity"
    }

    fn extensions(&self) -> &[&str] {
        &["sol"]
    }

    fn extract(&self, source: &str, file_path: &str) -> Result<FileExtraction> {
        let mut parser = Parser::new();
        parser.set_language(&self.language)?;

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
            "solidity",
        );
        let file_id = file_node.id.clone();
        extraction.nodes.push(file_node);

        extract_sol_items(root, source, file_path, &file_id, &mut extraction);

        Ok(extraction)
    }
}

fn extract_sol_items(
    node: tree_sitter::Node,
    source: &str,
    file_path: &str,
    parent_id: &str,
    extraction: &mut FileExtraction,
) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "contract_declaration" => {
                if let Some(code_node) =
                    extract_sol_named(&child, source, file_path, NodeLabel::Contract)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);

                    // Check inheritance
                    if let Some(heritage) = child.child_by_field_name("heritage") {
                        let mut hcursor = heritage.walk();
                        for hchild in heritage.children(&mut hcursor) {
                            if let Ok(name) = hchild.utf8_text(source.as_bytes()) {
                                let name = name.trim();
                                if !name.is_empty() && name != "is" && name != "," {
                                    extraction.edges.push(
                                        CodeEdge::new(
                                            &id,
                                            format!("unresolved:trait:{name}"),
                                            EdgeType::Extends,
                                        )
                                        .with_confidence(0.5),
                                    );
                                }
                            }
                        }
                    }

                    extract_sol_contract_body(&child, source, file_path, &id, extraction);
                }
            }
            "interface_declaration" => {
                if let Some(code_node) =
                    extract_sol_named(&child, source, file_path, NodeLabel::Interface)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_sol_contract_body(&child, source, file_path, &id, extraction);
                }
            }
            "library_declaration" => {
                if let Some(code_node) =
                    extract_sol_named(&child, source, file_path, NodeLabel::Module)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                    extract_sol_contract_body(&child, source, file_path, &id, extraction);
                }
            }
            "struct_declaration" => {
                if let Some(code_node) =
                    extract_sol_named(&child, source, file_path, NodeLabel::Struct)
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
                    extract_sol_named(&child, source, file_path, NodeLabel::Enum)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "event_definition" => {
                if let Some(code_node) =
                    extract_sol_named(&child, source, file_path, NodeLabel::Event)
                {
                    let id = code_node.id.clone();
                    extraction
                        .edges
                        .push(CodeEdge::new(parent_id, &id, EdgeType::Contains));
                    extraction.nodes.push(code_node);
                }
            }
            "import_directive" => {
                if let Ok(text) = child.utf8_text(source.as_bytes()) {
                    extraction.edges.push(
                        CodeEdge::new(
                            parent_id,
                            format!("unresolved:import:{}", text.trim()),
                            EdgeType::Imports,
                        )
                        .with_confidence(0.5),
                    );
                }
            }
            _ => {}
        }
    }
}

fn extract_sol_named(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    label: NodeLabel,
) -> Option<CodeNode> {
    let name_node = node.child_by_field_name("name")?;
    let name = name_node.utf8_text(source.as_bytes()).ok()?;
    let start = node.start_position().row as u32 + 1;
    let end = node.end_position().row as u32 + 1;

    Some(CodeNode::new(label, name, file_path, start, end, "solidity").with_exported(true))
}

fn extract_sol_contract_body(
    node: &tree_sitter::Node,
    source: &str,
    file_path: &str,
    contract_id: &str,
    extraction: &mut FileExtraction,
) {
    if let Some(body) = node.child_by_field_name("body") {
        let mut cursor = body.walk();
        for child in body.children(&mut cursor) {
            match child.kind() {
                "function_definition" => {
                    if let Some(name_node) = child.child_by_field_name("name")
                        && let Ok(name) = name_node.utf8_text(source.as_bytes())
                    {
                        let start = child.start_position().row as u32 + 1;
                        let end = child.end_position().row as u32 + 1;
                        let func = CodeNode::new(
                            NodeLabel::Function,
                            name,
                            file_path,
                            start,
                            end,
                            "solidity",
                        )
                        .with_exported(true);
                        let fid = func.id.clone();
                        extraction.edges.push(CodeEdge::new(
                            contract_id,
                            &fid,
                            EdgeType::HasMethod,
                        ));
                        extraction.nodes.push(func);
                    }
                }
                "modifier_definition" => {
                    if let Some(code_node) =
                        extract_sol_named(&child, source, file_path, NodeLabel::Modifier)
                    {
                        let id = code_node.id.clone();
                        extraction
                            .edges
                            .push(CodeEdge::new(contract_id, &id, EdgeType::HasMethod));
                        extraction.nodes.push(code_node);
                    }
                }
                "state_variable_declaration" => {
                    // Extract variable name from the declaration
                    let mut vcursor = child.walk();
                    for vchild in child.children(&mut vcursor) {
                        if vchild.kind() == "identifier"
                            && let Ok(name) = vchild.utf8_text(source.as_bytes())
                        {
                            let start = child.start_position().row as u32 + 1;
                            let end = child.end_position().row as u32 + 1;
                            let prop = CodeNode::new(
                                NodeLabel::Property,
                                name,
                                file_path,
                                start,
                                end,
                                "solidity",
                            );
                            let pid = prop.id.clone();
                            extraction.edges.push(CodeEdge::new(
                                contract_id,
                                &pid,
                                EdgeType::HasProperty,
                            ));
                            extraction.nodes.push(prop);
                            break;
                        }
                    }
                }
                "event_definition" => {
                    if let Some(code_node) =
                        extract_sol_named(&child, source, file_path, NodeLabel::Event)
                    {
                        let id = code_node.id.clone();
                        extraction
                            .edges
                            .push(CodeEdge::new(contract_id, &id, EdgeType::Contains));
                        extraction.nodes.push(code_node);
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_solidity_contract() {
        let provider = SolidityProvider::new();
        let source = r#"
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVault {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
}

contract Vault is ERC20, IVault {
    uint256 public totalDeposits;
    mapping(address => uint256) public balances;

    event Deposited(address indexed user, uint256 amount);

    modifier onlyPositive(uint256 amount) {
        require(amount > 0, "Must be positive");
        _;
    }

    function deposit(uint256 amount) external onlyPositive(amount) {
        balances[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
    }
}
"#;
        let result = provider.extract(source, "src/Vault.sol").unwrap();

        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "Vault" && n.label == NodeLabel::Contract)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "IVault" && n.label == NodeLabel::Interface)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "Deposited" && n.label == NodeLabel::Event)
        );
        assert!(
            result
                .nodes
                .iter()
                .any(|n| n.name == "onlyPositive" && n.label == NodeLabel::Modifier)
        );

        let funcs: Vec<_> = result
            .nodes
            .iter()
            .filter(|n| n.label == NodeLabel::Function)
            .collect();
        assert!(funcs.len() >= 2, "should have deposit and withdraw");

        // Check imports
        let imports: Vec<_> = result
            .edges
            .iter()
            .filter(|e| e.edge_type == EdgeType::Imports)
            .collect();
        assert!(!imports.is_empty(), "should have import edges");
    }
}
