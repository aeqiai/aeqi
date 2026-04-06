use aeqi_core::traits::Insight;
use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::cli::MemoryAction;
use crate::helpers::{load_config, open_insights};

pub(crate) async fn cmd_recall(
    config_path: &Option<PathBuf>,
    query: &str,
    _project_name: Option<&str>,
    top_k: usize,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let memory = open_insights(&config)?;

    let results = memory
        .search(&aeqi_core::traits::InsightQuery::new(query, top_k))
        .await?;

    if results.is_empty() {
        println!("No memories found for: {query}");
    } else {
        for (i, entry) in results.iter().enumerate() {
            let age = chrono::Utc::now() - entry.created_at;
            let age_str = if age.num_days() > 0 {
                format!("{}d ago", age.num_days())
            } else if age.num_hours() > 0 {
                format!("{}h ago", age.num_hours())
            } else {
                format!("{}m ago", age.num_minutes())
            };
            println!(
                "{}. [{}] ({:.2}) {} — {}",
                i + 1,
                age_str,
                entry.score,
                entry.key,
                entry.content
            );
        }
    }
    Ok(())
}

pub(crate) async fn cmd_remember(
    config_path: &Option<PathBuf>,
    key: &str,
    content: &str,
    project_name: Option<&str>,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let memory = open_insights(&config)?;

    let id = memory
        .store(key, content, aeqi_core::traits::InsightCategory::Fact, None)
        .await?;
    let scope = project_name.unwrap_or("global");
    println!("Stored memory {id} [{scope}] {key}");
    Ok(())
}

pub(crate) async fn cmd_memory(config_path: &Option<PathBuf>, action: MemoryAction) -> Result<()> {
    match action {
        MemoryAction::Export { vault } => cmd_memory_export(config_path, &vault).await,
        MemoryAction::Import { vault } => cmd_memory_import(config_path, &vault).await,
    }
}

async fn cmd_memory_export(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let memory = open_insights(&config)?;

    let count = aeqi_insights::obsidian::export(&memory, vault)?;
    println!("Exported {count} memories to {}", vault.display());
    Ok(())
}

async fn cmd_memory_import(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let memory = open_insights(&config)?;

    let (imported, skipped) = aeqi_insights::obsidian::import(&memory, vault).await?;
    println!(
        "Imported {imported} memories ({skipped} skipped) from {}",
        vault.display()
    );
    Ok(())
}
