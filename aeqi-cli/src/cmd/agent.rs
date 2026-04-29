use anyhow::Result;
use std::path::PathBuf;

use crate::helpers::{format_agent_org_hint, load_config, resolve_agents_dir};

pub(crate) async fn cmd_agent(
    config_path: &Option<PathBuf>,
    action: crate::cli::AgentAction,
) -> Result<()> {
    match action {
        crate::cli::AgentAction::List => {
            let (config, config_path_resolved) = load_config(config_path)?;
            let agents_dir = resolve_agents_dir(&config_path_resolved);

            // Show agents from TOML.
            let toml_names: std::collections::HashSet<&str> =
                config.agents.iter().map(|a| a.name.as_str()).collect();

            // Discover from disk.
            let disk_agents = aeqi_core::discover_agents(&agents_dir).unwrap_or_default();
            let disk_names: std::collections::HashSet<&str> =
                disk_agents.iter().map(|a| a.name.as_str()).collect();

            // Merge: all unique agents.
            let mut all_agents: Vec<(&str, &str, &str)> = Vec::new(); // (name, source, role)
            for a in &config.agents {
                let source = if disk_names.contains(a.name.as_str()) {
                    "both"
                } else {
                    "toml"
                };
                all_agents.push((&a.name, source, &a.role));
            }
            for a in &disk_agents {
                if !toml_names.contains(a.name.as_str()) {
                    all_agents.push((&a.name, "disk", &a.role));
                }
            }
            all_agents.sort_by_key(|a| a.0);

            println!("Discovered Agents ({}):\n", all_agents.len());
            for (name, source, role) in &all_agents {
                let org_hint = format_agent_org_hint(&config, name);
                println!("  {name:<15} role={role:<12} source={source}{org_hint}");
            }
            Ok(())
        }
        crate::cli::AgentAction::Spawn {
            name,
            parent,
            model,
        } => {
            let (config, _) = load_config(config_path)?;
            let registry =
                aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir())?;
            let agent = registry
                .spawn(&name, parent.as_deref(), model.as_deref())
                .await?;
            println!("Spawned persistent agent:");
            println!("  ID:      {}", agent.id);
            println!("  Name:    {}", agent.name);
            println!(
                "  Entity:  {}",
                agent.entity_id.as_deref().unwrap_or("(none)")
            );
            println!(
                "  Model:   {}",
                agent.model.as_deref().unwrap_or("(default)")
            );
            Ok(())
        }
        crate::cli::AgentAction::Show { name } => {
            let (config, _) = load_config(config_path)?;
            let registry =
                aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir())?;
            let agents = registry.get_by_name(&name).await?;
            if agents.is_empty() {
                println!("No agents named '{name}' in registry.");
            }
            for a in &agents {
                println!("Agent: {} ({})", a.name, a.id);
                println!("  Status:   {}", a.status);
                println!("  Entity:   {}", a.entity_id.as_deref().unwrap_or("(none)"));
                println!("  Model:    {}", a.model.as_deref().unwrap_or("(default)"));
                println!("  Sessions: {}", a.session_count);
                println!("  Tokens:   {}", a.total_tokens);
                println!("  Created:  {}", a.created_at);
                if let Some(la) = &a.last_active {
                    println!("  Active:   {la}");
                }
                println!();
            }
            Ok(())
        }
        crate::cli::AgentAction::Retire { name } => {
            let (config, _) = load_config(config_path)?;
            let registry =
                aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir())?;
            registry
                .set_status(
                    &name,
                    aeqi_orchestrator::agent_registry::AgentStatus::Retired,
                )
                .await?;
            println!("Agent '{name}' retired. Memory preserved.");
            Ok(())
        }
        crate::cli::AgentAction::Activate { name } => {
            let (config, _) = load_config(config_path)?;
            let registry =
                aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir())?;
            registry
                .set_status(
                    &name,
                    aeqi_orchestrator::agent_registry::AgentStatus::Active,
                )
                .await?;
            println!("Agent '{name}' activated.");
            Ok(())
        }
        crate::cli::AgentAction::Registry { entity } => {
            let (config, _) = load_config(config_path)?;
            let registry =
                aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir())?;
            let agents = registry.list(entity.as_deref(), None).await?;
            if agents.is_empty() {
                println!("No persistent agents registered.");
                println!("Spawn one: aeqi agent spawn <template.md>");
                return Ok(());
            }
            println!(
                "{:<20} {:<10} {:<36} {:<10} {:<8}",
                "NAME", "STATUS", "ENTITY", "SESSIONS", "TOKENS"
            );
            println!("{}", "-".repeat(86));
            for a in &agents {
                println!(
                    "{:<20} {:<10} {:<36} {:<10} {:<8}",
                    a.name,
                    a.status.to_string(),
                    a.entity_id.as_deref().unwrap_or("(none)"),
                    a.session_count,
                    a.total_tokens,
                );
            }
            Ok(())
        }
    }
}
