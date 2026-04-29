//! Position Registry — the canonical org-chart primitive.
//!
//! A position is a slot in an entity's org chart. Its occupant is a human
//! (`users.id`), an agent (`agents.id`), or vacant. Authority is resolved by
//! transitive closure over `position_edges` (DAG, not tree — boards of
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

/// Who occupies a position. `Vacant` is a first-class state — useful for
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

/// A single position row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: String,
    pub entity_id: String,
    pub title: String,
    pub occupant_kind: OccupantKind,
    pub occupant_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

/// A directed edge in the position DAG: `parent` controls `child`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionEdge {
    pub parent_position_id: String,
    pub child_position_id: String,
}

fn row_to_position(row: &rusqlite::Row<'_>) -> rusqlite::Result<Position> {
    Ok(Position {
        id: row.get(0)?,
        entity_id: row.get(1)?,
        title: row.get(2)?,
        occupant_kind: {
            let s: String = row.get(3)?;
            s.parse::<OccupantKind>().unwrap_or(OccupantKind::Vacant)
        },
        occupant_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn row_to_edge(row: &rusqlite::Row<'_>) -> rusqlite::Result<PositionEdge> {
    Ok(PositionEdge {
        parent_position_id: row.get(0)?,
        child_position_id: row.get(1)?,
    })
}

/// SQLite-backed position registry. Shares `ConnectionPool` with
/// [`AgentRegistry`] and [`EntityRegistry`].
pub struct PositionRegistry {
    db: Arc<ConnectionPool>,
}

impl PositionRegistry {
    pub fn open(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    /// All positions in the entity, ordered by creation time.
    pub async fn list_for_entity(&self, entity_id: &str) -> Result<Vec<Position>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, entity_id, title, occupant_kind, occupant_id, created_at, updated_at
             FROM positions
             WHERE entity_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map(params![entity_id], row_to_position)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// All edges between positions in this entity (filtered by parent's
    /// entity_id; edges only ever connect positions inside the same entity).
    pub async fn list_edges_for_entity(&self, entity_id: &str) -> Result<Vec<PositionEdge>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT e.parent_position_id, e.child_position_id
             FROM position_edges e
             JOIN positions p ON p.id = e.parent_position_id
             WHERE p.entity_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![entity_id], row_to_edge)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Insert a position with a known id (idempotent — ON CONFLICT DO NOTHING).
    /// Used by spawn paths that mint the position alongside the agent.
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
            "INSERT INTO positions (id, entity_id, title, occupant_kind, occupant_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO NOTHING",
            params![id, entity_id, title, kind.as_db(), occupant_id, now],
        )?;
        Ok(())
    }

    /// Mint a fresh position with a new UUID. Returns the created row.
    pub async fn create(
        &self,
        entity_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant_id: Option<&str>,
    ) -> Result<Position> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO positions (id, entity_id, title, occupant_kind, occupant_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, entity_id, title, kind.as_db(), occupant_id, now],
        )?;
        let position = db
            .query_row(
                "SELECT id, entity_id, title, occupant_kind, occupant_id, created_at, updated_at
                 FROM positions WHERE id = ?1",
                params![id],
                row_to_position,
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("position not found after insert"))?;
        Ok(position)
    }

    /// Add an edge to the DAG. Idempotent.
    pub async fn add_edge(&self, parent_id: &str, child_id: &str) -> Result<()> {
        if parent_id == child_id {
            bail!("self-loop edges are forbidden");
        }
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO position_edges (parent_position_id, child_position_id)
             VALUES (?1, ?2)
             ON CONFLICT(parent_position_id, child_position_id) DO NOTHING",
            params![parent_id, child_id],
        )?;
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
        PositionRegistry,
    ) {
        let dir = TempDir::new().expect("tempdir");
        let agents = Arc::new(AgentRegistry::open(dir.path()).expect("agent registry"));
        let entities = crate::entity_registry::EntityRegistry::open(agents.db());
        let positions = PositionRegistry::open(agents.db());
        (dir, agents, entities, positions)
    }

    #[tokio::test]
    async fn create_position_and_list() {
        let (_dir, _agents, entities, positions) = open_test_registries();

        let entity = entities
            .create_new(
                "Acme Co",
                "acme",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("create entity");

        let position = positions
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("create position");

        let listed = positions.list_for_entity(&entity.id).await.expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, position.id);
        assert_eq!(listed[0].occupant_kind, OccupantKind::Vacant);
    }

    #[tokio::test]
    async fn add_edge_idempotent() {
        let (_dir, _agents, entities, positions) = open_test_registries();

        let entity = entities
            .create_new(
                "Acme",
                "acme",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("entity");
        let p1 = positions
            .create(&entity.id, "Board", OccupantKind::Vacant, None)
            .await
            .expect("p1");
        let p2 = positions
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("p2");

        positions.add_edge(&p1.id, &p2.id).await.expect("edge 1");
        positions
            .add_edge(&p1.id, &p2.id)
            .await
            .expect("edge 2 (idempotent)");

        let edges = positions
            .list_edges_for_entity(&entity.id)
            .await
            .expect("edges");
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].parent_position_id, p1.id);
        assert_eq!(edges[0].child_position_id, p2.id);
    }

    #[tokio::test]
    async fn self_loop_rejected() {
        let (_dir, _agents, entities, positions) = open_test_registries();

        let entity = entities
            .create_new(
                "Acme",
                "acme",
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("entity");
        let p = positions
            .create(&entity.id, "CEO", OccupantKind::Vacant, None)
            .await
            .expect("p");

        let err = positions.add_edge(&p.id, &p.id).await;
        assert!(err.is_err(), "self-loop must be rejected");
    }
}
