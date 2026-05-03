//! Role Registry — the canonical org-chart primitive.
//!
//! A role is a slot in an entity's org chart. Its occupant is a human
//! (`users.id`), an agent (`agents.id`), or vacant. Authority is resolved by
//! transitive closure over `role_edges` (DAG, not tree — boards of
//! directors are flat sets at the top).
//!
//! The registry shares its connection pool with [`AgentRegistry`] and
//! [`EntityRegistry`] so all three operate on the same `aeqi.db`.

use crate::agent_registry::ConnectionPool;
use anyhow::{Result, bail};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Who occupies a role. `Vacant` is a first-class state — useful for
/// "we're hiring CFO" placeholders that already carry edges in the DAG.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OccupantKind {
    Human,
    Agent,
    Vacant,
}

impl OccupantKind {
    fn as_db(self) -> &'static str {
        match self {
            OccupantKind::Human => "human",
            OccupantKind::Agent => "agent",
            OccupantKind::Vacant => "vacant",
        }
    }
}

impl std::str::FromStr for OccupantKind {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "human" => Ok(OccupantKind::Human),
            "agent" => Ok(OccupantKind::Agent),
            "vacant" => Ok(OccupantKind::Vacant),
            other => bail!("unknown occupant kind: {}", other),
        }
    }
}

/// Classification of a role's authority level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RoleType {
    Director,
    Operational,
    Advisor,
}

impl RoleType {
    pub fn as_db(self) -> &'static str {
        match self {
            RoleType::Director => "director",
            RoleType::Operational => "operational",
            RoleType::Advisor => "advisor",
        }
    }
}

impl std::str::FromStr for RoleType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "director" => Ok(RoleType::Director),
            "operational" => Ok(RoleType::Operational),
            "advisor" => Ok(RoleType::Advisor),
            other => bail!("unknown role type: {}", other),
        }
    }
}

impl Default for RoleType {
    fn default() -> Self {
        RoleType::Operational
    }
}

// ── Grant catalog ─────────────────────────────────────────────────────────────

pub const GRANT_ROLES_MANAGE: &str = "roles.manage";
pub const GRANT_AGENTS_SPAWN: &str = "agents.spawn";
pub const GRANT_AGENTS_CONFIGURE: &str = "agents.configure";
pub const GRANT_TREASURY_READ: &str = "treasury.read";
pub const GRANT_GOVERNANCE_READ: &str = "governance.read";
pub const GRANT_SETTINGS_MODIFY: &str = "settings.modify";

pub const ALL_GRANTS: &[&str] = &[
    GRANT_ROLES_MANAGE,
    GRANT_AGENTS_SPAWN,
    GRANT_AGENTS_CONFIGURE,
    GRANT_TREASURY_READ,
    GRANT_GOVERNANCE_READ,
    GRANT_SETTINGS_MODIFY,
];

/// Returns the default grant set for a given role type.
pub fn default_grants_for_type(role_type: RoleType) -> Vec<String> {
    match role_type {
        RoleType::Director => ALL_GRANTS.iter().map(|s| s.to_string()).collect(),
        RoleType::Operational => vec![
            GRANT_ROLES_MANAGE,
            GRANT_AGENTS_SPAWN,
            GRANT_AGENTS_CONFIGURE,
            GRANT_TREASURY_READ,
        ]
        .into_iter()
        .map(String::from)
        .collect(),
        RoleType::Advisor => vec![GRANT_TREASURY_READ, GRANT_GOVERNANCE_READ]
            .into_iter()
            .map(String::from)
            .collect(),
    }
}

// ── Domain types ──────────────────────────────────────────────────────────────

/// A single role row, including grants populated by registry reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub id: String,
    pub entity_id: String,
    pub title: String,
    pub occupant_kind: OccupantKind,
    pub occupant_id: Option<String>,
    pub role_type: RoleType,
    pub founder: bool,
    /// Grants associated with this role. Populated by registry reads;
    /// not stored on the role row itself.
    pub grants: Vec<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

/// A directed edge in the role DAG: `parent` controls `child`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleEdge {
    pub parent_role_id: String,
    pub child_role_id: String,
}

fn row_to_role(row: &rusqlite::Row<'_>) -> rusqlite::Result<Role> {
    Ok(Role {
        id: row.get(0)?,
        entity_id: row.get(1)?,
        title: row.get(2)?,
        occupant_kind: {
            let s: String = row.get(3)?;
            s.parse::<OccupantKind>().unwrap_or(OccupantKind::Vacant)
        },
        occupant_id: row.get(4)?,
        role_type: {
            let s: String = row.get(5)?;
            s.parse::<RoleType>().unwrap_or(RoleType::Operational)
        },
        founder: {
            let v: i64 = row.get(6)?;
            v != 0
        },
        grants: vec![],
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<RoleEdge> {
    Ok(RoleEdge {
        parent_role_id: row.get(0)?,
        child_role_id: row.get(1)?,
    })
}

/// SQLite-backed role registry. Shares `ConnectionPool` with
/// [`AgentRegistry`] and [`EntityRegistry`].
pub struct RoleRegistry {
    db: Arc<ConnectionPool>,
}

impl RoleRegistry {
    pub fn open(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    // ── Read paths ────────────────────────────────────────────────────────────

    /// All roles in the entity, ordered by creation time.
    /// Grants are NOT populated — use `list_for_entity_with_grants` when you
    /// need them.
    pub async fn list_for_entity(&self, entity_id: &str) -> Result<Vec<Role>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, entity_id, title, occupant_kind, occupant_id,
                    role_type, founder, created_at, updated_at
             FROM roles
             WHERE entity_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map(params![entity_id], row_to_role)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// All roles + edges for an entity, with grants populated on each role.
    pub async fn list_for_entity_with_grants(
        &self,
        entity_id: &str,
    ) -> Result<(Vec<Role>, Vec<RoleEdge>)> {
        let db = self.db.lock().await;

        let mut roles: Vec<Role> = {
            let mut stmt = db.prepare(
                "SELECT r.id, r.entity_id, r.title, r.occupant_kind, r.occupant_id,
                        r.role_type, r.founder, r.created_at, r.updated_at
                 FROM roles r
                 WHERE r.entity_id = ?1
                 ORDER BY r.created_at ASC",
            )?;
            stmt.query_map(params![entity_id], row_to_role)?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Fetch all grants for this entity's roles in one query.
        let grants_rows: Vec<(String, String)> = {
            let mut stmt = db.prepare(
                "SELECT g.role_id, g.grant
                 FROM role_grants g
                 JOIN roles r ON r.id = g.role_id
                 WHERE r.entity_id = ?1",
            )?;
            stmt.query_map(params![entity_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        // Merge grants into their role.
        for (role_id, grant) in grants_rows {
            if let Some(role) = roles.iter_mut().find(|r| r.id == role_id) {
                role.grants.push(grant);
            }
        }

        let edges: Vec<RoleEdge> = {
            let mut stmt = db.prepare(
                "SELECT e.parent_role_id, e.child_role_id
                 FROM role_edges e
                 JOIN roles r ON r.id = e.parent_role_id
                 WHERE r.entity_id = ?1",
            )?;
            stmt.query_map(params![entity_id], row_to_edge)?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok((roles, edges))
    }

    /// All edges between roles in this entity (filtered by parent's
    /// entity_id; edges only ever connect roles inside the same entity).
    pub async fn list_edges_for_entity(&self, entity_id: &str) -> Result<Vec<RoleEdge>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT e.parent_role_id, e.child_role_id
             FROM role_edges e
             JOIN roles r ON r.id = e.parent_role_id
             WHERE r.entity_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![entity_id], row_to_edge)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Fetch a single role by id, with grants populated.
    pub async fn get(&self, role_id: &str) -> Result<Option<Role>> {
        let db = self.db.lock().await;
        let result = db
            .query_row(
                "SELECT id, entity_id, title, occupant_kind, occupant_id,
                        role_type, founder, created_at, updated_at
                 FROM roles WHERE id = ?1",
                params![role_id],
                row_to_role,
            )
            .optional()?;
        let Some(mut role) = result else {
            return Ok(None);
        };
        // Populate grants.
        let mut stmt =
            db.prepare("SELECT grant FROM role_grants WHERE role_id = ?1 ORDER BY grant")?;
        role.grants = stmt
            .query_map(params![role_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(Some(role))
    }

    // ── Grant queries ─────────────────────────────────────────────────────────

    /// Return the union of grants across all roles a given user holds at `entity_id`.
    pub async fn user_grants_for_entity(
        &self,
        entity_id: &str,
        user_id: &str,
    ) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT DISTINCT g.grant
             FROM role_grants g
             JOIN roles r ON r.id = g.role_id
             WHERE r.entity_id = ?1
               AND r.occupant_kind = 'human'
               AND r.occupant_id = ?2
             ORDER BY g.grant",
        )?;
        let grants = stmt
            .query_map(params![entity_id, user_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(grants)
    }

    /// Returns true iff the user holds at least one role at `entity_id` that
    /// carries `grant`.
    pub async fn user_has_grant(
        &self,
        entity_id: &str,
        user_id: &str,
        grant: &str,
    ) -> Result<bool> {
        let grants = self.user_grants_for_entity(entity_id, user_id).await?;
        Ok(grants.iter().any(|g| g == grant))
    }

    /// Fetch grants for a role.
    pub async fn get_grants(&self, role_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt =
            db.prepare("SELECT grant FROM role_grants WHERE role_id = ?1 ORDER BY grant")?;
        let grants = stmt
            .query_map(params![role_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(grants)
    }

    // ── Write paths ───────────────────────────────────────────────────────────

    /// Insert a role with a known id (idempotent — ON CONFLICT DO NOTHING).
    /// Used by spawn paths that mint the role alongside the agent.
    pub async fn upsert(
        &self,
        id: &str,
        entity_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant_id: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO roles (id, entity_id, title, occupant_kind, occupant_id,
                                role_type, founder, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'operational', 0, ?6)
             ON CONFLICT(id) DO NOTHING",
            params![id, entity_id, title, kind.as_db(), occupant_id, now],
        )?;
        Ok(())
    }

    /// Mint a fresh role with a new UUID. Returns the created row.
    /// Backward-compatible wrapper: role_type=Operational, founder=false,
    /// grants=default for Operational.
    pub async fn create(
        &self,
        entity_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant_id: Option<&str>,
    ) -> Result<Role> {
        self.create_with_type(
            entity_id,
            title,
            kind,
            occupant_id,
            RoleType::Operational,
            false,
            None,
        )
        .await
    }

    /// Mint a fresh role with explicit type, founder flag, and initial grants.
    /// If `grants` is `None` or empty, defaults for the type are used.
    pub async fn create_with_type(
        &self,
        entity_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant_id: Option<&str>,
        role_type: RoleType,
        founder: bool,
        grants: Option<Vec<String>>,
    ) -> Result<Role> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let effective_grants = match grants {
            Some(g) if !g.is_empty() => g,
            _ => default_grants_for_type(role_type),
        };

        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO roles (id, entity_id, title, occupant_kind, occupant_id,
                                role_type, founder, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                entity_id,
                title,
                kind.as_db(),
                occupant_id,
                role_type.as_db(),
                founder as i64,
                now
            ],
        )?;

        for grant in &effective_grants {
            db.execute(
                "INSERT INTO role_grants (role_id, grant, created_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(role_id, grant) DO NOTHING",
                params![id, grant, now],
            )?;
        }

        let mut role = db
            .query_row(
                "SELECT id, entity_id, title, occupant_kind, occupant_id,
                        role_type, founder, created_at, updated_at
                 FROM roles WHERE id = ?1",
                params![id],
                row_to_role,
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("role not found after insert"))?;
        role.grants = effective_grants;
        Ok(role)
    }

    /// Replace the full grant set for a role. Existing grants are deleted and
    /// re-inserted atomically.
    pub async fn set_grants(&self, role_id: &str, grants: Vec<String>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute("DELETE FROM role_grants WHERE role_id = ?1", params![role_id])?;
        for grant in &grants {
            db.execute(
                "INSERT INTO role_grants (role_id, grant, created_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(role_id, grant) DO NOTHING",
                params![role_id, grant, now],
            )?;
        }
        Ok(())
    }

    /// Update a role's mutable fields (title, role_type, grants).
    /// `occupant_kind`/`occupant_id` cannot be changed here — use `update_occupant`.
    pub async fn update_role(
        &self,
        role_id: &str,
        title: Option<&str>,
        role_type: Option<RoleType>,
        grants: Option<Vec<String>>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;

        if title.is_some() || role_type.is_some() {
            // Build a dynamic UPDATE only for the fields that changed.
            match (title, role_type) {
                (Some(t), Some(rt)) => {
                    db.execute(
                        "UPDATE roles SET title = ?1, role_type = ?2, updated_at = ?3 \
                         WHERE id = ?4",
                        params![t, rt.as_db(), now, role_id],
                    )?;
                }
                (Some(t), None) => {
                    db.execute(
                        "UPDATE roles SET title = ?1, updated_at = ?2 WHERE id = ?3",
                        params![t, now, role_id],
                    )?;
                }
                (None, Some(rt)) => {
                    db.execute(
                        "UPDATE roles SET role_type = ?1, updated_at = ?2 WHERE id = ?3",
                        params![rt.as_db(), now, role_id],
                    )?;
                }
                (None, None) => {}
            }
        }

        if let Some(new_grants) = grants {
            db.execute("DELETE FROM role_grants WHERE role_id = ?1", params![role_id])?;
            for grant in &new_grants {
                db.execute(
                    "INSERT INTO role_grants (role_id, grant, created_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(role_id, grant) DO NOTHING",
                    params![role_id, grant, now],
                )?;
            }
        }

        Ok(())
    }

    /// Archive (delete) a role. CASCADE handles edges + grants.
    pub async fn archive_role(&self, role_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute("DELETE FROM roles WHERE id = ?1", params![role_id])?;
        Ok(())
    }

    /// Add an edge to the DAG. Idempotent.
    pub async fn add_edge(&self, parent_id: &str, child_id: &str) -> Result<()> {
        if parent_id == child_id {
            bail!("self-loop edges are forbidden");
        }
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO role_edges (parent_role_id, child_role_id)
             VALUES (?1, ?2)
             ON CONFLICT(parent_role_id, child_role_id) DO NOTHING",
            params![parent_id, child_id],
        )?;
        Ok(())
    }

    /// Update the occupant of a role in-place.
    ///
    /// Called by `handle_change_occupant` after verifying the role exists.
    /// Stamps `updated_at`.
    pub async fn update_occupant(
        &self,
        role_id: &str,
        new_kind: OccupantKind,
        new_occupant_id: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE roles \
             SET occupant_kind = ?1, occupant_id = ?2, updated_at = ?3 \
             WHERE id = ?4",
            params![new_kind.as_db(), new_occupant_id, now, role_id],
        )?;
        Ok(())
    }

    /// Wipe every role and edge for an entity. Used by
    /// `spawn_blueprint` when the template declares explicit `seed_roles`:
    /// the agent_registry's spawn-time auto-roles get cleared so the
    /// declared structure can be installed fresh, in a single transaction
    /// with the redeclaration. Edges go first (FK to roles).
    pub async fn delete_for_entity(&self, entity_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "DELETE FROM role_edges
             WHERE parent_role_id IN (SELECT id FROM roles WHERE entity_id = ?1)
                OR child_role_id IN (SELECT id FROM roles WHERE entity_id = ?1)",
            params![entity_id],
        )?;
        db.execute("DELETE FROM roles WHERE entity_id = ?1", params![entity_id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn open_test_registries() -> (
        TempDir,
        Arc<AgentRegistry>,
        crate::entity_registry::EntityRegistry,
        RoleRegistry,
    ) {
        let dir = TempDir::new().expect("tempdir");
        let agents = Arc::new(AgentRegistry::open(dir.path()).expect("agent registry"));
        let entities = crate::entity_registry::EntityRegistry::open(agents.db());
        let roles = RoleRegistry::open(agents.db());
        (dir, agents, entities, roles)
    }

    async fn make_entity(
        entities: &crate::entity_registry::EntityRegistry,
        slug: &str,
    ) -> crate::entity_registry::Entity {
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
    }

    #[tokio::test]
    async fn create_role_and_list() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let role = roles
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("create role");

        let listed = roles.list_for_entity(&entity.id).await.expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, role.id);
        assert_eq!(listed[0].occupant_kind, OccupantKind::Vacant);
        assert_eq!(listed[0].role_type, RoleType::Operational);
        assert!(!listed[0].founder);
    }

    #[tokio::test]
    async fn add_edge_idempotent() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let r1 = roles
            .create(&entity.id, "Board", OccupantKind::Vacant, None)
            .await
            .expect("r1");
        let r2 = roles
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("r2");

        roles.add_edge(&r1.id, &r2.id).await.expect("edge 1");
        roles
            .add_edge(&r1.id, &r2.id)
            .await
            .expect("edge 2 (idempotent)");

        let edges = roles
            .list_edges_for_entity(&entity.id)
            .await
            .expect("edges");
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].parent_role_id, r1.id);
        assert_eq!(edges[0].child_role_id, r2.id);
    }

    #[tokio::test]
    async fn self_loop_rejected() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let r = roles
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("r");

        let err = roles.add_edge(&r.id, &r.id).await;
        assert!(err.is_err(), "self-loop must be rejected");
    }

    #[tokio::test]
    async fn create_with_type_director_gets_all_grants() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let role = roles
            .create_with_type(
                &entity.id,
                "Founder",
                OccupantKind::Human,
                Some("user-1"),
                RoleType::Director,
                true,
                None,
            )
            .await
            .expect("create director");

        assert_eq!(role.role_type, RoleType::Director);
        assert!(role.founder);
        assert_eq!(role.grants.len(), ALL_GRANTS.len());
        for g in ALL_GRANTS {
            assert!(role.grants.iter().any(|x| x == *g), "missing grant: {g}");
        }
    }

    #[tokio::test]
    async fn create_with_type_advisor_gets_read_grants() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let role = roles
            .create_with_type(
                &entity.id,
                "Advisor",
                OccupantKind::Human,
                Some("user-2"),
                RoleType::Advisor,
                false,
                None,
            )
            .await
            .expect("create advisor");

        assert_eq!(role.role_type, RoleType::Advisor);
        assert!(role.grants.iter().any(|g| g == GRANT_TREASURY_READ));
        assert!(role.grants.iter().any(|g| g == GRANT_GOVERNANCE_READ));
        assert!(!role.grants.iter().any(|g| g == GRANT_ROLES_MANAGE));
    }

    #[tokio::test]
    async fn user_has_grant_true_for_occupied_role() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        roles
            .create_with_type(
                &entity.id,
                "CEO",
                OccupantKind::Human,
                Some("user-ceo"),
                RoleType::Director,
                false,
                None,
            )
            .await
            .expect("create");

        assert!(
            roles
                .user_has_grant(&entity.id, "user-ceo", GRANT_ROLES_MANAGE)
                .await
                .unwrap()
        );
        assert!(
            !roles
                .user_has_grant(&entity.id, "user-other", GRANT_ROLES_MANAGE)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn set_grants_replaces_existing() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let role = roles
            .create(&entity.id, "Ops", OccupantKind::Vacant, None)
            .await
            .expect("create");

        roles
            .set_grants(&role.id, vec!["treasury.read".to_string()])
            .await
            .expect("set_grants");

        let grants = roles.get_grants(&role.id).await.expect("get_grants");
        assert_eq!(grants, vec!["treasury.read"]);
    }

    #[tokio::test]
    async fn archive_role_deletes_row() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        let role = roles
            .create(&entity.id, "Temp", OccupantKind::Vacant, None)
            .await
            .expect("create");
        roles.archive_role(&role.id).await.expect("archive");

        let found = roles.get(&role.id).await.expect("get");
        assert!(found.is_none(), "archived role must not be retrievable");
    }

    #[tokio::test]
    async fn list_for_entity_with_grants_populates_grants() {
        let (_dir, _agents, entities, roles) = open_test_registries();
        let entity = make_entity(&entities, "acme").await;

        roles
            .create_with_type(
                &entity.id,
                "CTO",
                OccupantKind::Human,
                Some("user-cto"),
                RoleType::Operational,
                false,
                None,
            )
            .await
            .expect("create");

        let (role_list, _edges) = roles
            .list_for_entity_with_grants(&entity.id)
            .await
            .expect("list_with_grants");

        assert_eq!(role_list.len(), 1);
        // Operational default grants
        let expected = default_grants_for_type(RoleType::Operational);
        for g in &expected {
            assert!(
                role_list[0].grants.iter().any(|x| x == g),
                "missing grant {g}"
            );
        }
    }
}
