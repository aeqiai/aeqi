use aeqi_core::tool_registry::{ExecutionContext, PatternDispatcher};
use aeqi_core::traits::{IdeaStore, Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;

/// Format an `aeqi_quests::Quest` into a human-readable detail string.
pub(crate) fn format_quest_detail(quest: &aeqi_quests::Quest) -> String {
    let mut out = format!(
        "Quest: {} \nStatus: {:?}\nPriority: {}\nSubject: {}\n",
        quest.id, quest.status, quest.priority, quest.name,
    );
    if !quest.description.is_empty() {
        out.push_str(&format!("Description: {}\n", quest.description));
    }
    if let Some(ref agent_id) = quest.agent_id {
        out.push_str(&format!("Agent: {}\n", agent_id));
    }
    if let Some(outcome) = quest.quest_outcome() {
        out.push_str(&format!("Outcome: {}\n", outcome.kind));
        out.push_str(&format!("Outcome summary: {}\n", outcome.summary));
        if let Some(reason) = outcome.reason {
            out.push_str(&format!("Outcome reason: {}\n", reason));
        }
    }
    if quest.retry_count > 0 {
        out.push_str(&format!("Retries: {}\n", quest.retry_count));
    }
    if !quest.checkpoints.is_empty() {
        out.push_str(&format!("Checkpoints: {}\n", quest.checkpoints.len()));
    }
    out
}

/// Unified quests tool combining create, list, show, update, close, cancel.
pub struct QuestsTool {
    agent_registry: Arc<AgentRegistry>,
    agent_id: String,
    activity_log: Arc<ActivityLog>,
    /// Session ID of the calling agent, propagated as creator_session_id.
    session_id: Option<String>,
    /// Stores needed to fire `on_quest_end` events on close.
    idea_store: Option<Arc<dyn IdeaStore>>,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    /// Dispatcher used by `action_close` to fire the `session:quest_end`
    /// pattern through the daemon's event chain (reflect-after-quest).
    /// Without this, the LLM-driven close path leaves the reflection seed
    /// dormant — events with `tool_calls` get warn-and-skipped because
    /// `assemble_ideas_for_pattern` has no `ToolDispatch`.
    pattern_dispatcher: Option<Arc<dyn PatternDispatcher>>,
}

impl QuestsTool {
    pub fn new(
        agent_registry: Arc<AgentRegistry>,
        agent_id: String,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            agent_registry,
            agent_id,
            activity_log,
            session_id: None,
            idea_store: None,
            event_handler_store: None,
            pattern_dispatcher: None,
        }
    }

    /// Resolve the calling agent UUID from the bound session context.
    async fn calling_uuid(&self) -> Option<String> {
        Some(self.agent_id.clone())
    }

    /// Set the session ID of the calling session. Used to propagate
    /// creator_session_id in quest_created events.
    pub fn with_session_id(mut self, id: Option<String>) -> Self {
        self.session_id = id;
        self
    }

    /// Supply stores used by `action_close` to assemble `on_quest_end` ideas.
    pub fn with_event_assembly(
        mut self,
        idea_store: Option<Arc<dyn IdeaStore>>,
        event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
    ) -> Self {
        self.idea_store = idea_store;
        self.event_handler_store = Some(event_handler_store);
        self
    }

    /// Supply the daemon's pattern dispatcher so `action_close` can fire
    /// `session:quest_end` end-to-end (incl. event chains with `tool_calls`,
    /// like the seeded reflect-after-quest chain). Without this, the LLM
    /// tool-close path is a dead end for the reflection loop.
    pub fn with_pattern_dispatcher(
        mut self,
        dispatcher: Option<Arc<dyn PatternDispatcher>>,
    ) -> Self {
        self.pattern_dispatcher = dispatcher;
        self
    }

    async fn action_create(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let subject = args
            .get("subject")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing subject"))?;
        let description = args
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let priority_str = args
            .get("priority")
            .and_then(|v| v.as_str())
            .unwrap_or("normal");

        // Resolve scope.
        let scope_str = args.get("scope").and_then(|v| v.as_str()).unwrap_or("self");
        let scope = match scope_str.parse::<aeqi_core::Scope>() {
            Ok(s) => s,
            Err(_) => {
                return Ok(ToolResult::error(format!(
                    "invalid scope {scope_str:?}; use: self, siblings, children, branch, global"
                )));
            }
        };

        // Resolve calling agent UUID for permission checks.
        let calling_uuid = self.calling_uuid().await;

        // Resolve target agent: prefer agent_id, then agent (name hint), then self.
        let agent_hint = args
            .get("agent_id")
            .or_else(|| args.get("agent"))
            .and_then(|v| v.as_str())
            .unwrap_or(&self.agent_id);

        let agent = match self.agent_registry.resolve_by_hint(agent_hint).await {
            Ok(Some(a)) => a,
            Ok(None) => {
                return Ok(ToolResult::error(format!("Agent not found: {agent_hint}")));
            }
            Err(e) => {
                return Ok(ToolResult::error(format!("Failed to resolve agent: {e}")));
            }
        };

        // Permission check: if target != calling agent, it must be a descendant.
        let is_self = calling_uuid.as_deref() == Some(agent.id.as_str());
        if !is_self {
            let caller = calling_uuid.as_deref().unwrap_or(&self.agent_id);
            match self.agent_registry.list_descendants(caller).await {
                Ok(descendants) if descendants.iter().any(|d| d == &agent.id) => {}
                Ok(_) => {
                    return Ok(ToolResult::error(format!(
                        "agent {} is not a descendant of the calling agent",
                        agent.name
                    )));
                }
                Err(e) => {
                    return Ok(ToolResult::error(format!("failed to verify agent: {e}")));
                }
            }
        }

        // Parse optional idea_ids from the request.
        let idea_ids: Vec<String> = args
            .get("idea_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let quest = match self
            .agent_registry
            .create_task_scoped(&agent.id, subject, description, &idea_ids, &[], scope)
            .await
        {
            Ok(q) => q,
            Err(e) => {
                return Ok(ToolResult::error(format!("Failed to create quest: {e}")));
            }
        };

        let quest_id = quest.id.0.clone();

        // Broadcast quest_created so the scheduler wakes up immediately.
        // Include creator_session_id so the scheduler can route completion
        // notifications back to the originating session.
        let _ = self
            .activity_log
            .emit(
                "quest_created",
                Some(&agent.id),
                self.session_id.as_deref(),
                Some(&quest_id),
                &serde_json::json!({
                    "subject": subject,
                    "creator_session_id": self.session_id,
                }),
            )
            .await;

        if priority_str != "normal" {
            let priority = match priority_str.to_lowercase().as_str() {
                "low" => aeqi_quests::Priority::Low,
                "high" => aeqi_quests::Priority::High,
                "critical" => aeqi_quests::Priority::Critical,
                _ => aeqi_quests::Priority::Normal,
            };
            if let Err(e) = self
                .agent_registry
                .update_task(&quest_id, |q| {
                    q.priority = priority;
                })
                .await
            {
                return Ok(ToolResult::error(format!(
                    "Quest created ({quest_id}) but failed to set priority: {e}"
                )));
            }
        }

        Ok(ToolResult::success(format!(
            "Created quest {quest_id}: {subject} (agent: {}, priority: {priority_str})",
            agent.name
        )))
    }

    async fn action_list(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let status = args.get("status").and_then(|v| v.as_str());
        let agent_hint = args.get("agent").and_then(|v| v.as_str());

        let quests = if let Some(hint) = agent_hint {
            // Caller requested a specific agent — use exact filter.
            let agent_id = match self.agent_registry.resolve_by_hint(hint).await {
                Ok(Some(a)) => a.id,
                Ok(None) => {
                    return Ok(ToolResult::error(format!("Agent not found: {hint}")));
                }
                Err(e) => {
                    return Ok(ToolResult::error(format!("Failed to resolve agent: {e}")));
                }
            };
            match self
                .agent_registry
                .list_tasks(status, Some(agent_id.as_str()))
                .await
            {
                Ok(q) => q,
                Err(e) => {
                    return Ok(ToolResult::error(format!("Failed to list quests: {e}")));
                }
            }
        } else {
            // No specific agent — use visibility clause so the LLM sees all quests visible to it.
            let viewer_uuid = self.calling_uuid().await;
            match viewer_uuid.as_deref() {
                Some(uuid) => {
                    match crate::scope_visibility::visibility_sql_clause(&self.agent_registry, uuid)
                        .await
                    {
                        Ok((clause, bind_params)) => match self
                            .agent_registry
                            .list_tasks_visible(&clause, &bind_params, status)
                            .await
                        {
                            Ok(q) => q,
                            Err(e) => {
                                return Ok(ToolResult::error(format!(
                                    "Failed to list quests: {e}"
                                )));
                            }
                        },
                        Err(_) => match self.agent_registry.list_tasks(status, None).await {
                            Ok(q) => q,
                            Err(e) => {
                                return Ok(ToolResult::error(format!(
                                    "Failed to list quests: {e}"
                                )));
                            }
                        },
                    }
                }
                None => match self.agent_registry.list_tasks(status, None).await {
                    Ok(q) => q,
                    Err(e) => {
                        return Ok(ToolResult::error(format!("Failed to list quests: {e}")));
                    }
                },
            }
        };

        if quests.is_empty() {
            let mut msg = "No quests found".to_string();
            if let Some(s) = status {
                msg.push_str(&format!(" with status={s}"));
            }
            if let Some(hint) = agent_hint {
                msg.push_str(&format!(" for agent={hint}"));
            }
            msg.push('.');
            return Ok(ToolResult::success(msg));
        }

        let mut out = format!("Found {} quest(s):\n\n", quests.len());
        for q in &quests {
            out.push_str(&format!(
                "- {} [{}] (priority: {}) — {}\n",
                q.id, q.status, q.priority, q.name
            ));
        }
        Ok(ToolResult::success(out))
    }

    async fn action_show(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;

        match self.agent_registry.get_task(quest_id).await {
            Ok(Some(quest)) => Ok(ToolResult::success(format_quest_detail(&quest))),
            Ok(None) => Ok(ToolResult::error(format!("Quest not found: {quest_id}"))),
            Err(e) => Ok(ToolResult::error(format!("Failed to get quest: {e}"))),
        }
    }

    async fn action_update(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let status_str = args.get("status").and_then(|v| v.as_str());
        let priority_str = args.get("priority").and_then(|v| v.as_str());

        if status_str.is_none() && priority_str.is_none() {
            return Ok(ToolResult::error(
                "Provide at least one of 'status' or 'priority' to update.",
            ));
        }

        let status = match status_str {
            Some(s) => {
                let parsed = match s.to_lowercase().as_str() {
                    "pending" => aeqi_quests::QuestStatus::Pending,
                    "in_progress" => aeqi_quests::QuestStatus::InProgress,
                    "done" => aeqi_quests::QuestStatus::Done,
                    "blocked" => aeqi_quests::QuestStatus::Blocked,
                    "cancelled" => aeqi_quests::QuestStatus::Cancelled,
                    _ => {
                        return Ok(ToolResult::error(format!(
                            "Invalid status: {s}. Use: pending, in_progress, done, blocked, cancelled"
                        )));
                    }
                };
                Some(parsed)
            }
            None => None,
        };

        let priority = match priority_str {
            Some(p) => {
                let parsed = match p.to_lowercase().as_str() {
                    "low" => aeqi_quests::Priority::Low,
                    "normal" => aeqi_quests::Priority::Normal,
                    "high" => aeqi_quests::Priority::High,
                    "critical" => aeqi_quests::Priority::Critical,
                    _ => {
                        return Ok(ToolResult::error(format!(
                            "Invalid priority: {p}. Use: low, normal, high, critical"
                        )));
                    }
                };
                Some(parsed)
            }
            None => None,
        };

        if let Some(new_status) = status
            && let Err(e) = self
                .agent_registry
                .update_task_status(quest_id, new_status)
                .await
        {
            return Ok(ToolResult::error(format!(
                "Failed to update quest {quest_id} status: {e}"
            )));
        }

        if let Some(new_priority) = priority
            && let Err(e) = self
                .agent_registry
                .update_task(quest_id, |q| {
                    q.priority = new_priority;
                })
                .await
        {
            return Ok(ToolResult::error(format!(
                "Failed to update quest {quest_id} priority: {e}"
            )));
        }

        let mut msg = format!("Quest {quest_id} updated:");
        if let Some(s) = status_str {
            msg.push_str(&format!(" status={s}"));
        }
        if let Some(p) = priority_str {
            msg.push_str(&format!(" priority={p}"));
        }
        Ok(ToolResult::success(msg))
    }

    async fn action_close(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let result = args
            .get("result")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing result"))?;

        let result_owned = result.to_string();
        match self
            .agent_registry
            .update_task(quest_id, |q| {
                q.status = aeqi_quests::QuestStatus::Done;
                q.set_quest_outcome(&aeqi_quests::QuestOutcomeRecord::new(
                    aeqi_quests::QuestOutcomeKind::Done,
                    &result_owned,
                ));
            })
            .await
        {
            Ok(quest) => {
                // Fire `session:quest_end` through the daemon-level pattern
                // dispatcher so the seeded reflect-after-quest chain
                // (`session.spawn(meta:reflector-template)` → `ideas.store_many`)
                // runs. Without this, the LLM-driven close path was a dead
                // end for the reflection loop — `assemble_ideas_for_pattern`
                // is invoked with `tool_dispatch: None`, so events with
                // `tool_calls` get warn-and-skipped.
                dispatch_quest_end_for_llm_close(
                    self.pattern_dispatcher.as_ref(),
                    quest_id,
                    &result_owned,
                    &quest,
                    self.session_id.as_deref(),
                )
                .await;

                let base = format!("Quest {quest_id} closed as done.");
                let message = self
                    .assemble_quest_end(quest_id, &result_owned, &base)
                    .await;
                Ok(ToolResult::success(message))
            }
            Err(e) => Ok(ToolResult::error(format!(
                "Failed to close quest {quest_id}: {e}"
            ))),
        }
    }

    /// Fire `session:quest_end` events in the worker's agent ancestry and
    /// prepend any assembled idea content to the close-tool result, so a
    /// user-configured postmortem/reflection template actually reaches the
    /// model at quest close (the natural injection point).
    async fn assemble_quest_end(&self, quest_id: &str, result: &str, base: &str) -> String {
        let (Some(event_store), Some(agent)) = (
            self.event_handler_store.as_ref(),
            self.agent_registry.get(&self.agent_id).await.ok().flatten(),
        ) else {
            return base.to_string();
        };

        let context = crate::idea_assembly::AssemblyContext {
            quest_description: Some(format!("Quest {quest_id} closed: {result}")),
            ..Default::default()
        };
        let assembled = crate::idea_assembly::assemble_ideas_for_pattern(
            &self.agent_registry,
            self.idea_store.as_ref(),
            event_store.as_ref(),
            &agent.id,
            &[],
            "session:quest_end",
            &context,
            None,
        )
        .await;

        for event_id in &assembled.fired_event_ids {
            if let Err(e) = event_store.record_fire(event_id, 0.0).await {
                tracing::warn!(event = %event_id, error = %e, "failed to record on_quest_end fire");
            }
        }

        if assembled.system.trim().is_empty() {
            base.to_string()
        } else {
            format!("{}\n\n---\n\n{}", assembled.system, base)
        }
    }

    async fn action_cancel(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let reason = args
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("Cancelled by agent");

        let reason_owned = reason.to_string();
        match self
            .agent_registry
            .update_task(quest_id, |q| {
                q.status = aeqi_quests::QuestStatus::Cancelled;
                q.set_quest_outcome(&aeqi_quests::QuestOutcomeRecord::new(
                    aeqi_quests::QuestOutcomeKind::Cancelled,
                    &reason_owned,
                ));
            })
            .await
        {
            Ok(_) => Ok(ToolResult::success(format!("Quest {quest_id} cancelled."))),
            Err(e) => Ok(ToolResult::error(format!(
                "Failed to cancel quest {quest_id}: {e}"
            ))),
        }
    }
}

#[async_trait]
impl Tool for QuestsTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'action'"))?;

        match action {
            "create" => self.action_create(&args).await,
            "list" => self.action_list(&args).await,
            "show" => self.action_show(&args).await,
            "update" => self.action_update(&args).await,
            "close" => self.action_close(&args).await,
            "cancel" => self.action_cancel(&args).await,
            other => Ok(ToolResult::error(format!(
                "Unknown action: {other}. Use: create, list, show, update, close, cancel"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests".to_string(),
            description: "Manage quests: create, list, show details, update status/priority, close with result, or cancel. list returns all quests visible to this agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "show", "update", "close", "cancel"],
                        "description": "create: make a new quest (needs subject). list: show quests (optional status, agent). show: quest details (needs quest_id). update: change status/priority (needs quest_id). close: complete with result (needs quest_id, result). cancel: abort (needs quest_id)."
                    },
                    "quest_id": { "type": "string", "description": "Quest ID (for show/update/close/cancel)" },
                    "subject": { "type": "string", "description": "Quest subject (for create)" },
                    "description": { "type": "string", "description": "Quest description (for create)" },
                    "agent": { "type": "string", "description": "Target agent name (for create, list)" },
                    "agent_id": { "type": "string", "description": "Target agent UUID (for create). Defaults to calling agent. Must be a descendant." },
                    "scope": {
                        "type": "string",
                        "enum": ["self", "siblings", "children", "branch", "global"],
                        "description": "Visibility scope (for create). Defaults to 'self'."
                    },
                    "status": { "type": "string", "enum": ["pending", "in_progress", "done", "blocked", "cancelled"], "description": "Filter or new status (for list, update)" },
                    "priority": { "type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority (for create, update)" },
                    "result": { "type": "string", "description": "Completion result (for close)" },
                    "reason": { "type": "string", "description": "Cancellation reason (for cancel)" }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests"
    }
}

/// Fire `session:quest_end` from the LLM-driven `quests(action='close')` path
/// through the daemon's pattern dispatcher so the seeded reflect-after-quest
/// chain (`session.spawn(meta:reflector-template)` → `ideas.store_many`) runs.
///
/// Mirrors `dispatch_quest_end_for_ipc_close` in `ipc/quests.rs`. Extracted as
/// a free function so it can be unit-tested without standing up a full
/// `QuestsTool` (which needs an `AgentRegistry` + `ActivityLog`).
///
/// Session-genealogy: when the calling tool has a real session_id we use it
/// directly so the reflector's `parent_session` placeholder substitutes to the
/// closing agent's session. When the tool was bound without a session_id
/// (older callers), we synthesize `event:session:quest_end:<quest_id>` per the
/// R7d convention so `session.spawn` receives a non-empty parent_session.
async fn dispatch_quest_end_for_llm_close(
    dispatcher: Option<&Arc<dyn PatternDispatcher>>,
    quest_id: &str,
    result: &str,
    quest: &aeqi_quests::Quest,
    caller_session_id: Option<&str>,
) {
    let Some(dispatcher) = dispatcher else {
        tracing::warn!(
            quest_id,
            "session:quest_end not dispatched from LLM close: no pattern_dispatcher wired"
        );
        return;
    };

    let session_id = caller_session_id
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("event:session:quest_end:{quest_id}"));

    let trigger_args = serde_json::json!({
        "session_id": session_id,
        "agent_id": quest.agent_id.clone().unwrap_or_default(),
        "quest_id": quest_id,
        "reason": result,
        "outcome": quest.quest_outcome(),
        "transcript_preview": format!(
            "Quest {quest_id} ({subject}) closed by agent: {result}",
            subject = quest.name,
        ),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let exec_ctx = ExecutionContext {
        session_id: session_id.clone(),
        agent_id: quest.agent_id.clone().unwrap_or_default(),
        ..Default::default()
    };
    let handled = dispatcher
        .dispatch("session:quest_end", &exec_ctx, &trigger_args)
        .await;
    if handled {
        tracing::info!(
            quest_id,
            session = %session_id,
            "session:quest_end dispatched (LLM close → reflect-after-quest)"
        );
    } else {
        tracing::debug!(
            quest_id,
            "session:quest_end dispatch returned false (no matching event configured)"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::tool_registry::PatternDispatcher;
    use std::sync::Mutex;

    /// Recording dispatcher: captures every `dispatch` call so tests can
    /// assert which patterns fired and what trigger_args they carried.
    #[derive(Default)]
    struct RecordingDispatcher {
        calls: Mutex<Vec<(String, String, serde_json::Value)>>,
    }

    impl PatternDispatcher for RecordingDispatcher {
        fn dispatch<'a>(
            &'a self,
            pattern: &'a str,
            ctx: &'a ExecutionContext,
            trigger_args: &'a serde_json::Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
            let pattern = pattern.to_string();
            let session_id = ctx.session_id.clone();
            let trigger_args = trigger_args.clone();
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((pattern, session_id, trigger_args));
                true
            })
        }
    }

    fn stub_quest(id: &str, agent_id: Option<&str>) -> aeqi_quests::Quest {
        aeqi_quests::Quest {
            id: aeqi_quests::QuestId(id.to_string()),
            name: "Quests-tool unit test".to_string(),
            description: String::new(),
            status: aeqi_quests::QuestStatus::Done,
            priority: Default::default(),
            agent_id: agent_id.map(str::to_string),
            scope: aeqi_core::Scope::SelfScope,
            depends_on: Vec::new(),
            idea_ids: Vec::new(),
            labels: Vec::new(),
            retry_count: 0,
            checkpoints: Vec::new(),
            metadata: serde_json::Value::Null,
            created_at: chrono::Utc::now(),
            updated_at: Some(chrono::Utc::now()),
            closed_at: Some(chrono::Utc::now()),
            outcome: None,
            worktree_branch: None,
            worktree_path: None,
            creator_session_id: None,
            acceptance_criteria: None,
        }
    }

    /// Regression lock: the LLM tool-close path must fire `session:quest_end`
    /// through the wired `PatternDispatcher`. Before this fix, 22% of done
    /// quests in production (46 of 206) closed via this path with no
    /// reflection chain ever firing — `assemble_ideas_for_pattern` was
    /// called with `tool_dispatch: None`, so events with `tool_calls` were
    /// warn-and-skipped.
    #[tokio::test]
    async fn llm_close_dispatches_session_quest_end_via_pattern_dispatcher() {
        let recorder = Arc::new(RecordingDispatcher::default());
        let dispatcher: Arc<dyn PatternDispatcher> = recorder.clone();

        let quest = stub_quest("q-llm", Some("agent-789"));
        dispatch_quest_end_for_llm_close(
            Some(&dispatcher),
            &quest.id.0,
            "completed by agent",
            &quest,
            Some("sess-real-1"),
        )
        .await;

        let calls = recorder.calls.lock().unwrap();
        assert_eq!(calls.len(), 1, "must dispatch exactly once");
        let (pattern, session_id, trigger_args) = &calls[0];
        assert_eq!(pattern, "session:quest_end");
        assert_eq!(
            session_id, "sess-real-1",
            "real caller session_id is preserved as parent_session"
        );
        assert_eq!(
            trigger_args.get("quest_id").and_then(|v| v.as_str()),
            Some("q-llm"),
        );
        assert_eq!(
            trigger_args.get("reason").and_then(|v| v.as_str()),
            Some("completed by agent"),
        );
        assert_eq!(
            trigger_args.get("agent_id").and_then(|v| v.as_str()),
            Some("agent-789"),
        );
    }

    /// When the tool was bound without a session_id (older callers, future
    /// non-session callers), the dispatcher still receives a non-empty
    /// `parent_session` via the synthetic `event:session:quest_end:<quest_id>`
    /// id (R7d convention). Required so `session.spawn` doesn't reject the
    /// chain.
    #[tokio::test]
    async fn llm_close_synthesizes_session_id_when_caller_has_none() {
        let recorder = Arc::new(RecordingDispatcher::default());
        let dispatcher: Arc<dyn PatternDispatcher> = recorder.clone();

        let quest = stub_quest("q-anon", Some("agent-789"));
        dispatch_quest_end_for_llm_close(
            Some(&dispatcher),
            &quest.id.0,
            "no session bound",
            &quest,
            None,
        )
        .await;

        let calls = recorder.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "event:session:quest_end:q-anon");
    }

    /// When no dispatcher is wired (older daemon builds, embedded tests),
    /// the close path must degrade silently — never panic, never return an
    /// error — so the quest still closes normally.
    #[tokio::test]
    async fn llm_close_without_dispatcher_is_a_no_op() {
        let quest = stub_quest("q-nop", None);
        dispatch_quest_end_for_llm_close(None, &quest.id.0, "no dispatcher", &quest, None).await;
    }
}
