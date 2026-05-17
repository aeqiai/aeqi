use crate::agent_registry::AgentRegistry;

const ASSIGNEE_HELP: &str = "Invalid assignee. Use 'user:<uuid>' or 'agent:<uuid>'.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuestCallerPrincipal {
    User(String),
    Agent(String),
}

impl QuestCallerPrincipal {
    pub fn assignee(&self) -> String {
        match self {
            Self::User(id) => format!("user:{id}"),
            Self::Agent(id) => format!("agent:{id}"),
        }
    }
}

pub fn caller_principal_from_request(request: &serde_json::Value) -> Option<QuestCallerPrincipal> {
    request
        .get("caller_user_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| QuestCallerPrincipal::User(s.trim().to_string()))
        .or_else(|| {
            request
                .get("caller_agent_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| QuestCallerPrincipal::Agent(s.trim().to_string()))
        })
}

pub fn auto_assignee_for_in_progress(
    status: Option<aeqi_quests::QuestStatus>,
    assignee_update: Option<Option<String>>,
    caller: Option<QuestCallerPrincipal>,
) -> Result<Option<Option<String>>, String> {
    auto_assignee_for_status(status, None, assignee_update, caller)
}

pub fn auto_assignee_for_status(
    status: Option<aeqi_quests::QuestStatus>,
    current_assignee: Option<&str>,
    assignee_update: Option<Option<String>>,
    caller: Option<QuestCallerPrincipal>,
) -> Result<Option<Option<String>>, String> {
    let Some(status) = status else {
        return Ok(assignee_update);
    };
    if !matches!(
        status,
        aeqi_quests::QuestStatus::InProgress | aeqi_quests::QuestStatus::Done
    ) {
        return Ok(assignee_update);
    }

    match assignee_update {
        Some(Some(_)) => Ok(assignee_update),
        Some(None) => Err(format!(
            "status={} requires an assignee or authenticated caller principal",
            status
        )),
        None if current_assignee.is_some() => Ok(None),
        None => {
            let principal = caller.ok_or_else(|| {
                format!(
                    "status={} requires an assignee or authenticated caller principal",
                    status
                )
            })?;
            Ok(Some(Some(principal.assignee())))
        }
    }
}

pub async fn validate_assignee_update(
    registry: &AgentRegistry,
    assignee_update: Option<Option<String>>,
) -> Result<Option<Option<String>>, String> {
    match assignee_update {
        Some(Some(assignee)) => validate_assignee(registry, &assignee)
            .await
            .map(|validated| Some(Some(validated))),
        other => Ok(other),
    }
}

async fn validate_assignee(registry: &AgentRegistry, assignee: &str) -> Result<String, String> {
    let (kind, id) = assignee
        .trim()
        .split_once(':')
        .ok_or_else(|| ASSIGNEE_HELP.to_string())?;
    if kind != "user" && kind != "agent" {
        return Err(ASSIGNEE_HELP.to_string());
    }

    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| ASSIGNEE_HELP.to_string())?
        .to_string();

    if kind == "agent"
        && registry
            .get(&id)
            .await
            .map_err(|e| e.to_string())?
            .is_none()
    {
        return Err(format!("Unknown assignee agent: {id}"));
    }

    Ok(format!("{kind}:{id}"))
}
