use crate::agent_registry::AgentRegistry;
use crate::role_registry::RoleRegistry;

const ASSIGNEE_HELP: &str =
    "Invalid assignee. Use 'user:<uuid>', 'agent:<uuid>', or 'role:<uuid>'.";

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

/// Validate an `assignee` update against the registries.
///
/// Quest 67-213 phase-1 widens this validator to accept `role:<uuid>` in
/// addition to the existing `user:<uuid>` / `agent:<uuid>` formats. Role
/// validation is cross-DB: the `roles` table lives in `aeqi.db` (managed by
/// [`RoleRegistry`]), while `quests` lives in `sessions.db`. SQLite cannot
/// enforce a foreign key across databases, so the check is application-level.
///
/// `caller_entity_id` is the trust_id of the entity the caller is acting as.
/// It is required for `role:<id>` validation so a quest filed under entity E
/// cannot be bound to a role inside entity E' — the cross-entity guard. When
/// `None`, role-typed assignees are rejected with a clear error.
pub async fn validate_assignee_update(
    agent_registry: &AgentRegistry,
    role_registry: &RoleRegistry,
    caller_entity_id: Option<&str>,
    assignee_update: Option<Option<String>>,
) -> Result<Option<Option<String>>, String> {
    match assignee_update {
        Some(Some(assignee)) => {
            validate_assignee(agent_registry, role_registry, caller_entity_id, &assignee)
                .await
                .map(|validated| Some(Some(validated)))
        }
        other => Ok(other),
    }
}

async fn validate_assignee(
    agent_registry: &AgentRegistry,
    role_registry: &RoleRegistry,
    caller_entity_id: Option<&str>,
    assignee: &str,
) -> Result<String, String> {
    let (kind, id) = assignee
        .trim()
        .split_once(':')
        .ok_or_else(|| ASSIGNEE_HELP.to_string())?;
    if id.is_empty() {
        return Err(ASSIGNEE_HELP.to_string());
    }
    if kind != "user" && kind != "agent" && kind != "role" {
        return Err(ASSIGNEE_HELP.to_string());
    }

    let id = uuid::Uuid::parse_str(id)
        .map_err(|_| ASSIGNEE_HELP.to_string())?
        .to_string();

    match kind {
        "agent" => {
            if agent_registry
                .get(&id)
                .await
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Err(format!("Unknown assignee agent: {id}"));
            }
        }
        "role" => {
            let entity = caller_entity_id
                .ok_or_else(|| "role:<id> assignee requires a caller entity context".to_string())?;
            let role = role_registry
                .get(&id)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Unknown assignee role: {id}"))?;
            // Cross-entity guard: a quest filed under entity E can only
            // bind to a role inside entity E. Prevents `role:<id>` leaks
            // across TRUSTs (see idea f1b46048).
            if role.trust_id != entity {
                return Err("Role does not belong to this entity".to_string());
            }
        }
        // "user" — no live lookup; users live in platform.db, not aeqi.db.
        // Same shape as before phase-1.
        _ => {}
    }

    Ok(format!("{kind}:{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use crate::entity_registry::EntityRegistry;
    use crate::role_registry::{OccupantKind, RoleRegistry};
    use std::sync::Arc;
    use tempfile::TempDir;

    fn open_registries() -> (TempDir, Arc<AgentRegistry>, EntityRegistry, RoleRegistry) {
        let dir = TempDir::new().expect("tempdir");
        let agents = Arc::new(AgentRegistry::open(dir.path()).expect("agent registry"));
        let entities = EntityRegistry::open(agents.db());
        let roles = RoleRegistry::open(agents.db());
        (dir, agents, entities, roles)
    }

    async fn make_entity(entities: &EntityRegistry, slug: &str) -> String {
        entities
            .create_new(
                "Acme Co",
                slug,
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("create entity")
            .id
    }

    #[tokio::test]
    async fn parse_role_uuid_succeeds() {
        let (_dir, agents, entities, roles) = open_registries();
        let entity = make_entity(&entities, "acme-role-parse").await;
        let role = roles
            .create(&entity, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("role");

        let assignee = format!("role:{}", role.id);
        let out = validate_assignee(&agents, &roles, Some(&entity), &assignee)
            .await
            .expect("role assignee should validate");
        assert_eq!(out, assignee);
    }

    #[tokio::test]
    async fn parse_role_empty_id_fails() {
        let (_dir, agents, _entities, roles) = open_registries();
        let err = validate_assignee(&agents, &roles, Some("entity-1"), "role:")
            .await
            .expect_err("role: with no id must fail");
        assert!(err.contains("role:<uuid>"), "expected help text, got {err}");
    }

    #[tokio::test]
    async fn parse_role_non_uuid_fails() {
        let (_dir, agents, _entities, roles) = open_registries();
        let err = validate_assignee(&agents, &roles, Some("entity-1"), "role:not-a-uuid")
            .await
            .expect_err("non-uuid role id must fail");
        assert!(err.contains("role:<uuid>"), "expected help text, got {err}");
    }

    #[tokio::test]
    async fn parse_unknown_kind_fails() {
        let (_dir, agents, _entities, roles) = open_registries();
        let err = validate_assignee(
            &agents,
            &roles,
            Some("entity-1"),
            "team:00000000-0000-0000-0000-000000000000",
        )
        .await
        .expect_err("unknown kind must fail");
        assert!(err.contains("role:<uuid>"), "expected help text, got {err}");
    }

    #[tokio::test]
    async fn role_assignee_unknown_role_fails() {
        let (_dir, agents, entities, roles) = open_registries();
        let entity = make_entity(&entities, "acme-unknown-role").await;

        let bogus = uuid::Uuid::new_v4().to_string();
        let assignee = format!("role:{bogus}");
        let err = validate_assignee(&agents, &roles, Some(&entity), &assignee)
            .await
            .expect_err("unknown role must fail");
        assert!(err.contains("Unknown assignee role"), "got {err}");
    }

    #[tokio::test]
    async fn role_assignee_cross_entity_rejected() {
        let (_dir, agents, entities, roles) = open_registries();
        let entity_a = make_entity(&entities, "entity-a").await;
        let entity_b = make_entity(&entities, "entity-b").await;
        // Role lives in entity_a.
        let role = roles
            .create(&entity_a, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("role in A");
        // Caller is acting as entity_b — must reject.
        let assignee = format!("role:{}", role.id);
        let err = validate_assignee(&agents, &roles, Some(&entity_b), &assignee)
            .await
            .expect_err("cross-entity role binding must fail");
        assert!(
            err.contains("Role does not belong to this entity"),
            "got {err}"
        );
    }

    #[tokio::test]
    async fn role_assignee_no_entity_context_rejected() {
        let (_dir, agents, entities, roles) = open_registries();
        let entity = make_entity(&entities, "no-ctx").await;
        let role = roles
            .create(&entity, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("role");
        let assignee = format!("role:{}", role.id);
        let err = validate_assignee(&agents, &roles, None, &assignee)
            .await
            .expect_err("absent entity context must reject role assignees");
        assert!(err.contains("caller entity context"), "got {err}");
    }

    #[tokio::test]
    async fn can_claim_role_direct_occupant() {
        let (_dir, _agents, entities, roles) = open_registries();
        let entity = make_entity(&entities, "claim-direct").await;
        let user_id = "user-direct";
        let role = roles
            .create(&entity, "CEO", OccupantKind::Human, Some(user_id))
            .await
            .expect("role");

        let actor = QuestCallerPrincipal::User(user_id.to_string());
        let allowed = roles
            .can_claim_role(&actor, &role.id, &entity)
            .await
            .expect("can_claim_role");
        assert!(allowed, "direct human occupant must claim");
    }

    #[tokio::test]
    async fn can_claim_role_via_ancestor() {
        let (_dir, _agents, entities, roles) = open_registries();
        let entity = make_entity(&entities, "claim-ancestor").await;
        // Board controls CEO via role_edges.
        let board_user = "user-board";
        let board = roles
            .create(&entity, "Board", OccupantKind::Human, Some(board_user))
            .await
            .expect("board");
        let ceo = roles
            .create(&entity, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("ceo");
        roles.add_edge(&board.id, &ceo.id).await.expect("edge");

        let actor = QuestCallerPrincipal::User(board_user.to_string());
        let allowed = roles
            .can_claim_role(&actor, &ceo.id, &entity)
            .await
            .expect("can_claim_role");
        assert!(allowed, "ancestor must claim child role");
    }

    #[tokio::test]
    async fn can_claim_role_unrelated_principal_denied() {
        let (_dir, _agents, entities, roles) = open_registries();
        let entity = make_entity(&entities, "claim-deny").await;
        let role = roles
            .create(&entity, "CEO", OccupantKind::Human, Some("ceo-uid"))
            .await
            .expect("role");
        let actor = QuestCallerPrincipal::User("someone-else".to_string());
        let allowed = roles
            .can_claim_role(&actor, &role.id, &entity)
            .await
            .expect("can_claim_role");
        assert!(!allowed, "unrelated principal must NOT claim");
    }
}
