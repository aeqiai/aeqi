use aeqi_orchestrator::OperationStore;
use anyhow::{Context, Result};
use std::path::PathBuf;

use crate::helpers::{load_config, open_quests_for_project, project_name_for_prefix};

pub(crate) async fn cmd_assign(
    config_path: &Option<PathBuf>,
    subject: &str,
    project_name: &str,
    description: &str,
    priority: Option<&str>,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let prefix = if let Some(pcfg) = config.agent_spawn(project_name) {
        pcfg.prefix.clone()
    } else if let Some(acfg) = config.agent(project_name) {
        acfg.prefix.clone()
    } else {
        anyhow::bail!("project or agent not found: {project_name}");
    };

    let mut store = open_quests_for_project(project_name)?;
    let mut quest = store.create_with_agent(&prefix, subject, None)?;

    // Editorial body (`description`) lives on the linked idea now; the
    // JSONL store doesn't carry one, so the CLI just stamps priority.
    let _ = description;

    if let Some(p) = priority {
        quest = store.update(&quest.id.0, |b| {
            b.priority = match p {
                "low" => aeqi_quests::Priority::Low,
                "high" => aeqi_quests::Priority::High,
                "critical" => aeqi_quests::Priority::Critical,
                _ => aeqi_quests::Priority::Normal,
            };
        })?;
    }

    println!("Created {} [{}] {}", quest.id, quest.priority, subject);
    Ok(())
}

pub(crate) async fn cmd_ready(
    config_path: &Option<PathBuf>,
    project_name: Option<&str>,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;

    let projects: Vec<&str> = if let Some(name) = project_name {
        vec![name]
    } else {
        config
            .agent_spawns
            .iter()
            .map(|r| r.name.as_str())
            .collect()
    };

    let mut found = false;
    for name in projects {
        if let Ok(store) = open_quests_for_project(name) {
            let ready = store.ready();
            for quest in ready {
                found = true;
                let title = if quest.title().is_empty() {
                    quest.id.0.as_str()
                } else {
                    quest.title()
                };
                let body = if quest.body().is_empty() {
                    "(no description)"
                } else {
                    quest.body()
                };
                println!("{} [{}] {} — {}", quest.id, quest.priority, title, body);
            }
        }
    }

    if !found {
        println!("No ready work.");
    }
    Ok(())
}

pub(crate) async fn cmd_quests(
    config_path: &Option<PathBuf>,
    project_name: Option<&str>,
    show_all: bool,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;

    let projects: Vec<&str> = if let Some(name) = project_name {
        vec![name]
    } else {
        config
            .agent_spawns
            .iter()
            .map(|r| r.name.as_str())
            .collect()
    };

    for name in projects {
        if let Ok(store) = open_quests_for_project(name) {
            let quests = store.all();
            let quests: Vec<_> = if show_all {
                quests
            } else {
                quests.into_iter().filter(|b| !b.is_closed()).collect()
            };

            if quests.is_empty() {
                continue;
            }

            println!("=== {} ===", name);
            for quest in quests {
                let agent = quest.agent_id.as_deref().unwrap_or("-");
                let deps = if quest.depends_on.is_empty() {
                    String::new()
                } else {
                    format!(
                        " (needs: {})",
                        quest
                            .depends_on
                            .iter()
                            .map(|d| d.0.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                };
                let checkpoints = if quest.checkpoints.is_empty() {
                    String::new()
                } else {
                    format!(" checkpoints={}", quest.checkpoints.len())
                };
                println!(
                    "  {} [{}] {} — {} agent={}{}{}",
                    quest.id,
                    quest.status,
                    quest.priority,
                    quest.title(),
                    agent,
                    deps,
                    checkpoints
                );
            }
        }
    }
    Ok(())
}

pub(crate) async fn cmd_close(config_path: &Option<PathBuf>, id: &str, reason: &str) -> Result<()> {
    let (config, _) = load_config(config_path)?;

    let prefix = id.split('-').next().unwrap_or("");
    let project_name = project_name_for_prefix(&config, prefix)
        .context(format!("no project with prefix '{prefix}'"))?;

    let mut store = open_quests_for_project(&project_name)?;
    let quest = store.close(id, reason)?;
    println!("Closed {} — {}", quest.id, quest.title());
    Ok(())
}

pub(crate) async fn cmd_hook(
    config_path: &Option<PathBuf>,
    worker: &str,
    quest_id: &str,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;

    let prefix = quest_id.split('-').next().unwrap_or("");
    let project_name = project_name_for_prefix(&config, prefix)
        .context(format!("no project with prefix '{prefix}'"))?;

    let mut store = open_quests_for_project(&project_name)?;
    let quest = store.update(quest_id, |b| {
        b.status = aeqi_quests::QuestStatus::InProgress;
    })?;

    println!("Hooked {} to {} — {}", worker, quest.id, quest.title());
    Ok(())
}

pub(crate) async fn cmd_done(
    config_path: &Option<PathBuf>,
    quest_id: &str,
    reason: &str,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;

    let prefix = quest_id.split('-').next().unwrap_or("");
    let project_name = project_name_for_prefix(&config, prefix)
        .context(format!("no project with prefix '{prefix}'"))?;

    let mut store = open_quests_for_project(&project_name)?;
    let quest = store.close(quest_id, reason)?;
    println!("Done {} — {}", quest.id, quest.title());

    // Also update any operations tracking this quest.
    let ops_path = config.data_dir().join("operations.json");
    if ops_path.exists() {
        let mut op_store = OperationStore::open(&ops_path)?;
        let completed = op_store.mark_quest_closed(&quest.id)?;
        for c_id in &completed {
            println!("Operation {c_id} completed!");
        }
    }

    Ok(())
}
