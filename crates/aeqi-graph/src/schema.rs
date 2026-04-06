use serde::{Deserialize, Serialize};

/// Labels for code graph nodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeLabel {
    // Structural
    Project,
    Module,
    File,
    // Rust
    Struct,
    Trait,
    Impl,
    Enum,
    Function,
    Method,
    Const,
    Static,
    TypeAlias,
    Macro,
    // Multi-language (activated by language providers)
    Class,
    Interface,
    Variable,
    Decorator,
    Constructor,
    Property,
    // Solidity
    Contract,
    Event,
    Modifier,
    // Synthetic
    Community,
    Process,
}

impl NodeLabel {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::Module => "module",
            Self::File => "file",
            Self::Struct => "struct",
            Self::Trait => "trait",
            Self::Impl => "impl",
            Self::Enum => "enum",
            Self::Function => "function",
            Self::Method => "method",
            Self::Const => "const",
            Self::Static => "static",
            Self::TypeAlias => "type_alias",
            Self::Macro => "macro",
            Self::Class => "class",
            Self::Interface => "interface",
            Self::Variable => "variable",
            Self::Decorator => "decorator",
            Self::Constructor => "constructor",
            Self::Property => "property",
            Self::Contract => "contract",
            Self::Event => "event",
            Self::Modifier => "modifier",
            Self::Community => "community",
            Self::Process => "process",
        }
    }
}

impl std::fmt::Display for NodeLabel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Typed relationships between code nodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    // Structure
    Contains,
    Defines,
    MemberOf,
    // Code flow
    Calls,
    Imports,
    Uses,
    Accesses,
    // Inheritance
    Extends,
    Implements,
    Overrides,
    HasMethod,
    HasProperty,
    // Process
    StepInProcess,
    EntryPointOf,
    // Cross-project
    DependsOn,
}

impl EdgeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Contains => "contains",
            Self::Defines => "defines",
            Self::MemberOf => "member_of",
            Self::Calls => "calls",
            Self::Imports => "imports",
            Self::Uses => "uses",
            Self::Accesses => "accesses",
            Self::Extends => "extends",
            Self::Implements => "implements",
            Self::Overrides => "overrides",
            Self::HasMethod => "has_method",
            Self::HasProperty => "has_property",
            Self::StepInProcess => "step_in_process",
            Self::EntryPointOf => "entry_point_of",
            Self::DependsOn => "depends_on",
        }
    }
}

impl std::fmt::Display for EdgeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Resolution tier for import/call confidence scoring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResolutionTier {
    SameFile,
    ImportScoped,
    Global,
}

impl ResolutionTier {
    pub fn confidence(&self) -> f32 {
        match self {
            Self::SameFile => 0.95,
            Self::ImportScoped => 0.90,
            Self::Global => 0.50,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SameFile => "same_file",
            Self::ImportScoped => "import_scoped",
            Self::Global => "global",
        }
    }
}

/// A node in the code graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeNode {
    pub id: String,
    pub label: NodeLabel,
    pub name: String,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub language: String,
    pub is_exported: bool,
    pub signature: Option<String>,
    pub doc_comment: Option<String>,
    pub community_id: Option<String>,
}

impl CodeNode {
    pub fn new(
        label: NodeLabel,
        name: impl Into<String>,
        file_path: impl Into<String>,
        start_line: u32,
        end_line: u32,
        language: impl Into<String>,
    ) -> Self {
        let name = name.into();
        let file_path = file_path.into();
        let language = language.into();
        let id = format!(
            "{}:{}:{}:{}",
            language,
            label.as_str(),
            file_path,
            start_line
        );
        Self {
            id,
            label,
            name,
            file_path,
            start_line,
            end_line,
            language,
            is_exported: false,
            signature: None,
            doc_comment: None,
            community_id: None,
        }
    }

    pub fn with_exported(mut self, exported: bool) -> Self {
        self.is_exported = exported;
        self
    }

    pub fn with_signature(mut self, sig: impl Into<String>) -> Self {
        self.signature = Some(sig.into());
        self
    }

    pub fn with_doc(mut self, doc: impl Into<String>) -> Self {
        self.doc_comment = Some(doc.into());
        self
    }
}

/// An edge in the code graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeEdge {
    pub source_id: String,
    pub target_id: String,
    pub edge_type: EdgeType,
    pub confidence: f32,
    pub tier: Option<String>,
    pub step: Option<u32>,
}

impl CodeEdge {
    pub fn new(
        source_id: impl Into<String>,
        target_id: impl Into<String>,
        edge_type: EdgeType,
    ) -> Self {
        Self {
            source_id: source_id.into(),
            target_id: target_id.into(),
            edge_type,
            confidence: 1.0,
            tier: None,
            step: None,
        }
    }

    pub fn with_confidence(mut self, confidence: f32) -> Self {
        self.confidence = confidence;
        self
    }

    pub fn with_tier(mut self, tier: ResolutionTier) -> Self {
        self.confidence = tier.confidence();
        self.tier = Some(tier.as_str().to_string());
        self
    }

    pub fn with_step(mut self, step: u32) -> Self {
        self.step = Some(step);
        self
    }
}
