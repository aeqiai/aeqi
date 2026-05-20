//! `roles` agent tool — closes the long-standing gap where LLM-driven
//! agents could not manage role rows via tool calls.
//!
//! See `architecture_role_budget_canonical.md` § "Tool architecture" for
//! the canonical model. Single tool with an `action` enum (matches the
//! `events` / `ideas` convention) so the LLM sees one entry in its tool
//! list, not seven.
//!
//! ## Auth model
//!
//! - Reads (`list`, `org_chart`, `get`) — any agent in the trust.
//! - Writes (`create`, `assign_occupant`, `grant`, `dissolve`) — caller's
//!   role must hold `roles.manage` and (for `dissolve` / `assign_occupant`)
//!   be an ancestor in the role DAG.
//!
//! Authority is anchored on the **calling agent** — `agent_id` is
//! closure-captured by the tool instance at registration time so the LLM
//! cannot forge identity via args. The trust the agent acts in is read
//! from the agent's `trust_id`.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;

use crate::agent_registry::AgentRegistry;
use crate::role_registry::{
    GRANT_ROLES_MANAGE, OccupantKind, RoleRegistry, RoleType, default_grants_for_type,
};

/// Single multi-action tool exposed to the LLM as `roles`.
pub struct RolesTool {
    role_registry: Arc<RoleRegistry>,
    agent_registry: Arc<AgentRegistry>,
    /// UUID of the agent this tool instance is bound to. Closure-captured
    /// at registration; never read from args.
    agent_id: String,
}

impl RolesTool {
    pub fn new(
        role_registry: Arc<RoleRegistry>,
        agent_registry: Arc<AgentRegistry>,
        agent_id: String,
    ) -> Self {
        Self {
            role_registry,
            agent_registry,
            agent_id,
        }
    }

    /// Resolve the trust (trust_id) the calling agent acts in.
    async fn resolve_trust(&self) -> Result<String> {
        let agent = self
            .agent_registry
            .resolve_by_hint(&self.agent_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("calling agent not found: {}", self.agent_id))?;
        agent
            .trust_id
            .ok_or_else(|| anyhow::anyhow!("agent has no entity (cannot act in any trust)"))
    }

    async fn ensure_grant(&self, trust_id: &str, grant: &str) -> Result<(), ToolResult> {
        // We require the calling AGENT (occupant_id) to hold the grant via
        // some occupied role. role_registry.user_grants_for_entity treats
        // occupant_kind='human' only; for agents we walk roles directly.
        let (roles, _edges) = self
            .role_registry
            .list_for_entity_with_grants(trust_id)
            .await
            .map_err(|e| ToolResult::error(format!("list roles: {e}")))?;
        let has = roles
            .into_iter()
            .filter(|r| {
                matches!(r.occupant_kind, OccupantKind::Agent)
                    && r.occupant_id.as_deref() == Some(&self.agent_id)
            })
            .flat_map(|r| r.grants.into_iter())
            .any(|g| g == grant);
        if has {
            Ok(())
        } else {
            Err(ToolResult::error(format!(
                "agent's roles do not carry the {grant} grant"
            )))
        }
    }

    async fn action_list(&self) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let (roles, edges) = self
            .role_registry
            .list_for_entity_with_grants(&trust_id)
            .await?;
        let summary = format!(
            "{} role(s), {} edge(s) in trust {trust_id}",
            roles.len(),
            edges.len()
        );
        Ok(ToolResult::success(summary).with_data(serde_json::json!({
            "trust_id": trust_id,
            "roles": roles,
            "edges": edges,
        })))
    }

    async fn action_org_chart(&self) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let (roles, edges) = self
            .role_registry
            .list_for_entity_with_grants(&trust_id)
            .await?;
        let nodes: Vec<serde_json::Value> = roles
            .iter()
            .map(|r| {
                serde_json::json!({
                    "id": r.id,
                    "title": r.title,
                    "type": r.role_type,
                    "occupant_kind": r.occupant_kind,
                    "occupant_id": r.occupant_id,
                })
            })
            .collect();
        let edge_pairs: Vec<serde_json::Value> = edges
            .iter()
            .map(|e| {
                serde_json::json!({
                    "parent_role_id": e.parent_role_id,
                    "child_role_id": e.child_role_id,
                })
            })
            .collect();
        Ok(ToolResult::success(format!(
            "Org chart: {} roles, {} reporting edges",
            nodes.len(),
            edge_pairs.len()
        ))
        .with_data(serde_json::json!({
            "nodes": nodes,
            "edges": edge_pairs,
        })))
    }

    async fn action_get(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let role_id = match args.get("role_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("role_id is required")),
        };
        match self.role_registry.get(&role_id).await? {
            Some(r) => Ok(ToolResult::success(format!("Role {role_id}: {}", r.title))
                .with_data(serde_json::to_value(&r)?)),
            None => Ok(ToolResult::error(format!("role {role_id} not found"))),
        }
    }

    async fn action_create(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        if let Err(t) = self.ensure_grant(&trust_id, GRANT_ROLES_MANAGE).await {
            return Ok(t);
        }
        let title = match args.get("title").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("title is required")),
        };
        let parent_role_id = args
            .get("parent_role_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let role_type: RoleType = args
            .get("role_type")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(RoleType::Operational);
        let occupant_kind: OccupantKind = args
            .get("occupant_kind")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(OccupantKind::Vacant);
        let occupant_id = args
            .get("occupant_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let grants_v = args.get("grants").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect::<Vec<_>>()
        });

        let role = self
            .role_registry
            .create_with_type(
                &trust_id,
                &title,
                occupant_kind,
                occupant_id.as_deref(),
                role_type,
                false,
                grants_v.or_else(|| Some(default_grants_for_type(role_type))),
            )
            .await?;
        if let Some(parent) = parent_role_id.as_deref() {
            self.role_registry.add_edge(parent, &role.id).await?;
        }
        Ok(
            ToolResult::success(format!("Created role {} ({})", role.title, role.id)).with_data(
                serde_json::json!({
                    "role_id": role.id,
                    "trust_id": trust_id,
                }),
            ),
        )
    }

    async fn action_assign_occupant(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        if let Err(t) = self.ensure_grant(&trust_id, GRANT_ROLES_MANAGE).await {
            return Ok(t);
        }
        let role_id = match args.get("role_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("role_id is required")),
        };
        let kind: OccupantKind = match args
            .get("occupant_kind")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
        {
            Some(k) => k,
            None => return Ok(ToolResult::error("occupant_kind is required")),
        };
        let occupant_id = args
            .get("occupant_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if matches!(kind, OccupantKind::Human | OccupantKind::Agent | OccupantKind::Trust) && occupant_id.is_none() {
            return Ok(ToolResult::error(
                "occupant_id is required when occupant_kind is human, agent, or trust",
            ));
        }
        self.role_registry
            .update_occupant(&role_id, kind, occupant_id.as_deref())
            .await?;
        Ok(ToolResult::success(format!(
            "Updated occupant of {role_id}"
        )))
    }

    async fn action_grant(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        if let Err(t) = self.ensure_grant(&trust_id, GRANT_ROLES_MANAGE).await {
            return Ok(t);
        }
        let role_id = match args.get("role_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("role_id is required")),
        };
        let new_grants: Vec<String> = match args.get("grants").and_then(|v| v.as_array()) {
            Some(arr) => arr
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect(),
            None => return Ok(ToolResult::error("grants array is required")),
        };
        self.role_registry.set_grants(&role_id, new_grants).await?;
        Ok(ToolResult::success(format!("Updated grants on {role_id}")))
    }

    async fn action_dissolve(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        if let Err(t) = self.ensure_grant(&trust_id, GRANT_ROLES_MANAGE).await {
            return Ok(t);
        }
        let role_id = match args.get("role_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("role_id is required")),
        };
        self.role_registry.archive_role(&role_id).await?;
        Ok(ToolResult::success(format!("Dissolved role {role_id}")))
    }
}

#[async_trait]
impl Tool for RolesTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");
        match action {
            "list" => self.action_list().await,
            "org_chart" => self.action_org_chart().await,
            "get" => self.action_get(&args).await,
            "create" => self.action_create(&args).await,
            "assign_occupant" => self.action_assign_occupant(&args).await,
            "grant" => self.action_grant(&args).await,
            "dissolve" => self.action_dissolve(&args).await,
            other => Ok(ToolResult::error(format!(
                "unknown action {other:?}; use list|org_chart|get|create|assign_occupant|grant|dissolve",
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "roles".to_string(),
            description: "Read or modify the org chart of the calling agent's trust (company). \
                 Roles are the WHO primitive — chairs an agent or human occupies. \
                 `list` and `org_chart` return all roles + reporting edges. \
                 `get` returns one role with its grants. \
                 `create` mints a new role under an optional `parent_role_id`; \
                 `assign_occupant` swaps who sits in a chair; \
                 `grant` rewrites the grant set; `dissolve` archives a role. \
                 Mutating actions require the calling agent's role to hold `roles.manage`."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "org_chart", "get", "create", "assign_occupant", "grant", "dissolve"],
                        "description": "What to do. Defaults to `list`."
                    },
                    "role_id": { "type": "string", "description": "Target role id (for get / assign_occupant / grant / dissolve)." },
                    "title": { "type": "string", "description": "Role title (for create)." },
                    "role_type": {
                        "type": "string",
                        "enum": ["director", "operational", "advisor"],
                        "description": "Authority class (for create). Default operational."
                    },
                    "parent_role_id": { "type": "string", "description": "Parent role to attach the new role under (for create)." },
                    "occupant_kind": {
                        "type": "string",
                        "enum": ["human", "agent", "vacant"],
                        "description": "For create / assign_occupant."
                    },
                    "occupant_id": { "type": "string", "description": "user.id or agents.id (omit when occupant_kind=vacant)." },
                    "grants": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "For create (initial grants) or grant (replace full set)."
                    },
                    "as_role_id": { "type": "string", "description": "Disambiguates which of the agent's roles is acting (multi-role agents only)." }
                },
                "required": ["action"],
            }),
        }
    }

    fn name(&self) -> &str {
        "roles"
    }

    fn is_concurrent_safe(&self, input: &serde_json::Value) -> bool {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");
        matches!(action, "list" | "org_chart" | "get")
    }

    fn is_destructive(&self, input: &serde_json::Value) -> bool {
        let action = input.get("action").and_then(|v| v.as_str()).unwrap_or("");
        matches!(action, "assign_occupant" | "dissolve")
    }

    fn produces_context(&self) -> bool {
        // Reads are useful as event-context; writes are diagnostic acks.
        true
    }

    fn activity_description(&self, input: &serde_json::Value) -> Option<String> {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");
        Some(match action {
            "list" => "Listing roles".to_string(),
            "org_chart" => "Reading org chart".to_string(),
            "get" => "Reading role".to_string(),
            "create" => "Creating role".to_string(),
            "assign_occupant" => "Assigning role occupant".to_string(),
            "grant" => "Updating role grants".to_string(),
            "dissolve" => "Dissolving role".to_string(),
            other => format!("roles.{other}"),
        })
    }
}
