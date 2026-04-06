pub mod rust;
pub mod solidity;
pub mod typescript;

use crate::schema::{CodeEdge, CodeNode};
use anyhow::Result;

/// Extraction result from parsing a single file.
#[derive(Debug, Default)]
pub struct FileExtraction {
    pub nodes: Vec<CodeNode>,
    pub edges: Vec<CodeEdge>,
}

/// Language provider trait — implement for each supported language.
pub trait LanguageProvider: Send + Sync {
    fn language_id(&self) -> &str;
    fn extensions(&self) -> &[&str];
    fn extract(&self, source: &str, file_path: &str) -> Result<FileExtraction>;
}
