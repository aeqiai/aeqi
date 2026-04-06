pub mod analysis;
pub mod extract;
pub mod index;
pub mod parser;
pub mod query;
pub mod schema;
pub mod storage;

pub use analysis::community::{Community, detect_communities};
pub use analysis::process::{Process, ProcessType, detect_processes};
pub use analysis::synthesis::{SynthesizedPrompt, synthesize_prompt};
pub use extract::{SymbolTable, TypeEnv, build_type_env_rust, resolve_graph};
pub use index::{DiffImpact, IndexResult, Indexer};
pub use parser::rust::RustProvider;
pub use parser::solidity::SolidityProvider;
pub use parser::typescript::TypeScriptProvider;
pub use parser::{FileExtraction, LanguageProvider};
pub use schema::{CodeEdge, CodeNode, EdgeType, NodeLabel, ResolutionTier};
pub use storage::{GraphStats, GraphStore, ImpactEntry, NodeContext};
