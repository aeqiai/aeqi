use anyhow::Result;
use std::path::PathBuf;

use crate::helpers::load_config;

pub(crate) async fn cmd_audit(
    config_path: &Option<PathBuf>,
    _project: Option<&str>,
    task: Option<&str>,
    last: u32,
) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let data_dir = config.data_dir();

    // Open the AgentRegistry DB (which contains the unified events table).
    let agent_reg = aeqi_orchestrator::agent_registry::AgentRegistry::open(&data_dir)?;
    let event_store = aeqi_orchestrator::EventStore::new(agent_reg.db());

    let filter = aeqi_orchestrator::event_store::EventFilter {
        event_type: Some("decision".to_string()),
        quest_id: task.map(String::from),
        ..Default::default()
    };

    let events = event_store.query(&filter, last, 0).await?;

    if events.is_empty() {
        println!("No audit events found.");
        return Ok(());
    }

    for event in &events {
        let task_str = event.quest_id.as_deref().unwrap_or("-");
        let agent_str = event
            .content
            .get("agent")
            .and_then(|v| v.as_str())
            .unwrap_or("-");
        let decision_type = event
            .content
            .get("decision_type")
            .and_then(|v| v.as_str())
            .unwrap_or("-");
        let reasoning = event
            .content
            .get("reasoning")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        println!(
            "[{}] {} | task={} agent={} | {}",
            event.created_at.format("%Y-%m-%d %H:%M:%S"),
            decision_type,
            task_str,
            agent_str,
            reasoning,
        );
    }

    println!("\n{} events shown.", events.len());
    Ok(())
}
