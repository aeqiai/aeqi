use aeqi_core::traits::IdeaStore;
use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::cli::IdeasAction;
use crate::helpers::{load_config, open_ideas};

pub(crate) async fn cmd_ideas(config_path: &Option<PathBuf>, action: IdeasAction) -> Result<()> {
    match action {
        IdeasAction::Search { query, root, top_k } => {
            cmd_ideas_search(config_path, &query, root.as_deref(), top_k).await
        }
        IdeasAction::Store {
            name,
            content,
            root,
        } => cmd_ideas_store(config_path, &name, &content, root.as_deref()).await,
        IdeasAction::Export { vault } => cmd_ideas_export(config_path, &vault).await,
        IdeasAction::Import { vault } => cmd_ideas_import(config_path, &vault).await,
    }
}

async fn cmd_ideas_search(
    config_path: &Option<PathBuf>,
    query: &str,
    _root: Option<&str>,
    top_k: usize,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let results = ideas
        .search(&aeqi_core::traits::IdeaQuery::new(query, top_k))
        .await?;

    if results.is_empty() {
        println!("No ideas found for: {query}");
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
                entry.name,
                entry.content
            );
        }
    }
    Ok(())
}

async fn cmd_ideas_store(
    config_path: &Option<PathBuf>,
    name: &str,
    content: &str,
    root: Option<&str>,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let id = ideas
        .store(name, content, &["fact".to_string()], None)
        .await?;
    let scope = root.unwrap_or("global");
    println!("Stored idea {id} [{scope}] {name}");
    Ok(())
}

async fn cmd_ideas_export(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let count = aeqi_ideas::obsidian::export(&ideas, vault).await?;
    println!("Exported {count} ideas to {}", vault.display());
    Ok(())
}

async fn cmd_ideas_import(config_path: &Option<PathBuf>, vault: &Path) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let ideas = open_ideas(&config)?;

    let (imported, skipped) = aeqi_ideas::obsidian::import(&ideas, vault).await?;
    println!(
        "Imported {imported} ideas ({skipped} skipped) from {}",
        vault.display()
    );
    Ok(())
}
