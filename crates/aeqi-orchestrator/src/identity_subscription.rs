//! Agent identity activation through lifecycle events.
//!
//! Persona text is stored as an Idea, but ideas are inert until an event
//! assembles them. This module keeps identity idea writes paired with the
//! self-scoped `session:start` event that activates them.

use crate::event_handler::{Event, EventHandlerStore, NewEvent, ToolCall};

pub fn identity_session_start_event_name(idea_id: &str) -> String {
    format!("persona:{idea_id}:session_start")
}

pub fn identity_session_start_tool_calls(idea_id: &str) -> Vec<ToolCall> {
    vec![ToolCall {
        tool: "ideas.assemble".to_string(),
        args: serde_json::json!({ "ids": [idea_id] }),
    }]
}

pub async fn sync_identity_session_start_event(
    event_store: &EventHandlerStore,
    agent_id: &str,
    idea_id: &str,
) -> anyhow::Result<Event> {
    let name = identity_session_start_event_name(idea_id);
    let tool_calls = identity_session_start_tool_calls(idea_id);

    let existing = event_store
        .list_for_agent(agent_id)
        .await?
        .into_iter()
        .find(|event| event.agent_id.as_deref() == Some(agent_id) && event.name == name);

    let event = if let Some(event) = existing {
        event
    } else {
        event_store
            .create(&NewEvent {
                agent_id: Some(agent_id.to_string()),
                scope: aeqi_core::Scope::SelfScope,
                name,
                pattern: "session:start".to_string(),
                tool_calls: tool_calls.clone(),
                cooldown_secs: 0,
                system: false,
            })
            .await?
    };

    event_store
        .update_fields(
            &event.id,
            Some(true),
            Some("session:start"),
            Some(0),
            Some(&tool_calls),
        )
        .await?;

    Ok(event_store.get(&event.id).await?.unwrap_or(event))
}

pub async fn remove_identity_session_start_event(
    event_store: &EventHandlerStore,
    agent_id: &str,
    idea_id: &str,
) -> anyhow::Result<()> {
    let name = identity_session_start_event_name(idea_id);
    let Some(event) = event_store
        .list_for_agent(agent_id)
        .await?
        .into_iter()
        .find(|event| event.agent_id.as_deref() == Some(agent_id) && event.name == name)
    else {
        return Ok(());
    };

    event_store.delete(&event.id).await
}
