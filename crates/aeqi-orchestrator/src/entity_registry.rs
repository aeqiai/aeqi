//! Entity Registry — first-class entity primitive.
//!
//! An entity is the organisational unit that owns agents. Every agent
//! belongs to exactly one entity (`agents.entity_id`). Entities mint fresh
//! UUIDs at creation, distinct from any agent UUID.
//!
//! The registry borrows its connection-pool shape from [`AgentRegistry`]:
//! - `Arc<ConnectionPool>` hand-off so both registries share the same pool.
//! - Every mutating method acquires the lock, performs the write, drops.
//! - Tests use an in-memory pool seeded by `AgentRegistry::open` so the
//!   full position-DAG schema is in place.

use crate::agent_registry::ConnectionPool;
use anyhow::{Result, bail};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// The type discriminator for an entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EntityType {
    #[default]
    Company,
    Human,
    Agent,
    Fund,
    Dao,
    Holding,
    Protocol,
}

impl std::fmt::Display for EntityType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EntityType::Company => write!(f, "company"),
            EntityType::Human => write!(f, "human"),
            EntityType::Agent => write!(f, "agent"),
            EntityType::Fund => write!(f, "fund"),
            EntityType::Dao => write!(f, "dao"),
            EntityType::Holding => write!(f, "holding"),
            EntityType::Protocol => write!(f, "protocol"),
        }
    }
}

impl std::str::FromStr for EntityType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "company" => Ok(EntityType::Company),
            "human" => Ok(EntityType::Human),
            "agent" => Ok(EntityType::Agent),
            "fund" => Ok(EntityType::Fund),
            "dao" => Ok(EntityType::Dao),
            "holding" => Ok(EntityType::Holding),
            "protocol" => Ok(EntityType::Protocol),
            other => bail!("unknown entity type: {}", other),
        }
    }
}

/// A single entity row — the organisational primitive that owns agent trees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: EntityType,
    pub name: String,
    pub slug: String,
    pub parent_entity_id: Option<String>,
    pub owner_user_id: Option<String>,
    pub metadata: String,
    pub created_at: String,
    pub updated_at: Option<String>,
}

fn row_to_entity(row: &rusqlite::Row<'_>) -> rusqlite::Result<Entity> {
    Ok(Entity {
        id: row.get(0)?,
        type_: {
            let s: String = row.get(1)?;
            s.parse::<EntityType>().unwrap_or(EntityType::Company)
        },
        name: row.get(2)?,
        slug: row.get(3)?,
        parent_entity_id: row.get(4)?,
        owner_user_id: row.get(5)?,
        metadata: row
            .get::<_, Option<String>>(6)?
            .unwrap_or_else(|| "{}".to_string()),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// SQLite-backed entity registry. Shares `ConnectionPool` with [`AgentRegistry`].
pub struct EntityRegistry {
    db: Arc<ConnectionPool>,
}

impl EntityRegistry {
    /// Construct from an already-open pool (shared with AgentRegistry).
    pub fn open(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    /// List all entities, ordered by created_at ascending.
    pub async fn list(&self) -> Result<Vec<Entity>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, type, name, slug, parent_entity_id, owner_user_id,
                    metadata, created_at, updated_at
             FROM entities
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_entity)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// List only entities whose id appears in `allowed`. Used for tenancy
    /// scoping — `allowed` contains entity ids the current scope can see.
    pub async fn list_filtered(&self, allowed: &[String]) -> Result<Vec<Entity>> {
        if allowed.is_empty() {
            return Ok(vec![]);
        }
        let db = self.db.lock().await;
        // Build a parameterised IN clause.
        let placeholders = allowed
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, type, name, slug, parent_entity_id, owner_user_id,
                    metadata, created_at, updated_at
             FROM entities
             WHERE id IN ({})
             ORDER BY created_at ASC",
            placeholders
        );
        let mut stmt = db.prepare(&sql)?;
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            allowed.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params_vec.as_slice(), row_to_entity)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Get a single entity by id.
    pub async fn get(&self, id: &str) -> Result<Option<Entity>> {
        let db = self.db.lock().await;
        let result = db
            .query_row(
                "SELECT id, type, name, slug, parent_entity_id, owner_user_id,
                        metadata, created_at, updated_at
                 FROM entities WHERE id = ?1",
                params![id],
                row_to_entity,
            )
            .optional()?;
        Ok(result)
    }

    /// Get a single entity by its slug.
    pub async fn get_by_slug(&self, slug: &str) -> Result<Option<Entity>> {
        let db = self.db.lock().await;
        let result = db
            .query_row(
                "SELECT id, type, name, slug, parent_entity_id, owner_user_id,
                        metadata, created_at, updated_at
                 FROM entities WHERE slug = ?1",
                params![slug],
                row_to_entity,
            )
            .optional()?;
        Ok(result)
    }

    /// Create a new entity row. Returns the created entity.
    pub async fn create(
        &self,
        id: &str,
        name: &str,
        slug: &str,
        type_: EntityType,
        parent_entity_id: Option<&str>,
        owner_user_id: Option<&str>,
    ) -> Result<Entity> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO entities (id, type, name, slug, parent_entity_id, owner_user_id,
                                   metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7)",
            params![
                id,
                type_.to_string(),
                name,
                slug,
                parent_entity_id,
                owner_user_id,
                now
            ],
        )?;
        let entity = db
            .query_row(
                "SELECT id, type, name, slug, parent_entity_id, owner_user_id,
                        metadata, created_at, updated_at
                 FROM entities WHERE id = ?1",
                params![id],
                row_to_entity,
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("entity not found after insert"))?;
        Ok(entity)
    }

    /// Create a new entity row, using a fresh UUID as the id.
    pub async fn create_new(
        &self,
        name: &str,
        slug: &str,
        type_: EntityType,
        parent_entity_id: Option<&str>,
        owner_user_id: Option<&str>,
    ) -> Result<Entity> {
        let id = uuid::Uuid::new_v4().to_string();
        self.create(&id, name, slug, type_, parent_entity_id, owner_user_id)
            .await
    }

    /// Upsert an entity: insert with the given id, or do nothing on conflict.
    /// Used for idempotent backfill.
    pub async fn upsert_ignore(
        &self,
        id: &str,
        name: &str,
        slug: &str,
        type_: EntityType,
        created_at: &str,
    ) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO entities (id, type, name, slug, metadata, created_at)
             VALUES (?1, ?2, ?3, ?4, '{}', ?5)
             ON CONFLICT(id) DO NOTHING",
            params![id, type_.to_string(), name, slug, created_at],
        )?;
        Ok(())
    }

    /// Update an entity's name and/or slug.
    pub async fn update(
        &self,
        id: &str,
        new_name: Option<&str>,
        new_slug: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        match (new_name, new_slug) {
            (Some(name), Some(slug)) => {
                db.execute(
                    "UPDATE entities SET name = ?1, slug = ?2, updated_at = ?3 WHERE id = ?4",
                    params![name, slug, now, id],
                )?;
            }
            (Some(name), None) => {
                db.execute(
                    "UPDATE entities SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![name, now, id],
                )?;
            }
            (None, Some(slug)) => {
                db.execute(
                    "UPDATE entities SET slug = ?1, updated_at = ?2 WHERE id = ?3",
                    params![slug, now, id],
                )?;
            }
            (None, None) => {}
        }
        Ok(())
    }

    /// Delete an entity by id.
    pub async fn delete(&self, id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute("DELETE FROM entities WHERE id = ?1", params![id])?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;

    async fn test_registry() -> (AgentRegistry, EntityRegistry) {
        let dir = tempfile::tempdir().unwrap();
        let reg = AgentRegistry::open(dir.path()).unwrap();
        let pool = reg.db();
        let entity_reg = EntityRegistry::open(pool);
        (reg, entity_reg)
    }

    #[tokio::test]
    async fn create_and_list() {
        let (_reg, er) = test_registry().await;
        let e = er
            .create("ent-1", "Acme", "acme", EntityType::Company, None, None)
            .await
            .unwrap();
        assert_eq!(e.id, "ent-1");
        assert_eq!(e.name, "Acme");
        assert_eq!(e.type_, EntityType::Company);

        let list = er.list().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "ent-1");
    }

    #[tokio::test]
    async fn idempotent_upsert_ignore() {
        let (_agent_reg, er) = test_registry().await;
        let id = "ent-upsert";
        er.upsert_ignore(id, "acme", "acme-upsert", EntityType::Company, "2026-04-29")
            .await
            .unwrap();
        er.upsert_ignore(id, "acme", "acme-upsert", EntityType::Company, "2026-04-29")
            .await
            .unwrap();

        let list = er.list().await.unwrap();
        let matching: Vec<_> = list.iter().filter(|e| e.id == id).collect();
        assert_eq!(matching.len(), 1);
    }

    #[tokio::test]
    async fn slug_uniqueness_enforced() {
        let (_reg, er) = test_registry().await;
        er.create("ent-1", "Acme", "acme", EntityType::Company, None, None)
            .await
            .unwrap();
        let result = er
            .create(
                "ent-2",
                "Acme Duplicate",
                "acme",
                EntityType::Fund,
                None,
                None,
            )
            .await;
        assert!(result.is_err(), "duplicate slug must be rejected");
    }

    #[tokio::test]
    async fn parent_entity_id_nesting() {
        let (_reg, er) = test_registry().await;
        let parent = er
            .create(
                "parent-1",
                "Parent Corp",
                "parent-corp",
                EntityType::Holding,
                None,
                None,
            )
            .await
            .unwrap();
        let child = er
            .create(
                "child-1",
                "Subsidiary",
                "subsidiary",
                EntityType::Company,
                Some(&parent.id),
                None,
            )
            .await
            .unwrap();
        assert_eq!(child.parent_entity_id, Some("parent-1".to_string()));

        let fetched = er.get("child-1").await.unwrap().unwrap();
        assert_eq!(fetched.parent_entity_id, Some("parent-1".to_string()));
    }

    #[tokio::test]
    async fn owner_user_id_round_trip() {
        let (_reg, er) = test_registry().await;
        let e = er
            .create(
                "ent-1",
                "Mine",
                "mine",
                EntityType::Company,
                None,
                Some("user-abc"),
            )
            .await
            .unwrap();
        assert_eq!(e.owner_user_id, Some("user-abc".to_string()));
        let fetched = er.get("ent-1").await.unwrap().unwrap();
        assert_eq!(fetched.owner_user_id, Some("user-abc".to_string()));
    }

    #[tokio::test]
    async fn type_defaults_to_company() {
        let (_reg, er) = test_registry().await;
        let e = er
            .create(
                "ent-1",
                "Default",
                "default",
                EntityType::default(),
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(e.type_, EntityType::Company);
    }

    #[tokio::test]
    async fn get_by_slug() {
        let (_reg, er) = test_registry().await;
        er.create(
            "ent-1",
            "Acme",
            "acme-slug",
            EntityType::Company,
            None,
            None,
        )
        .await
        .unwrap();
        let found = er.get_by_slug("acme-slug").await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, "ent-1");

        let missing = er.get_by_slug("no-such-slug").await.unwrap();
        assert!(missing.is_none());
    }

    #[tokio::test]
    async fn update_name_and_slug() {
        let (_reg, er) = test_registry().await;
        er.create(
            "ent-1",
            "Old Name",
            "old-slug",
            EntityType::Company,
            None,
            None,
        )
        .await
        .unwrap();
        er.update("ent-1", Some("New Name"), Some("new-slug"))
            .await
            .unwrap();
        let fetched = er.get("ent-1").await.unwrap().unwrap();
        assert_eq!(fetched.name, "New Name");
        assert_eq!(fetched.slug, "new-slug");
        assert!(fetched.updated_at.is_some());
    }

    #[tokio::test]
    async fn delete_entity() {
        let (_reg, er) = test_registry().await;
        er.create("ent-1", "Temp", "temp", EntityType::Company, None, None)
            .await
            .unwrap();
        er.delete("ent-1").await.unwrap();
        let found = er.get("ent-1").await.unwrap();
        assert!(found.is_none());
    }

    #[tokio::test]
    async fn list_filtered() {
        let (_reg, er) = test_registry().await;
        er.create("ent-1", "A", "a", EntityType::Company, None, None)
            .await
            .unwrap();
        er.create("ent-2", "B", "b", EntityType::Company, None, None)
            .await
            .unwrap();
        er.create("ent-3", "C", "c", EntityType::Company, None, None)
            .await
            .unwrap();

        let allowed = vec!["ent-1".to_string(), "ent-3".to_string()];
        let filtered = er.list_filtered(&allowed).await.unwrap();
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().any(|e| e.id == "ent-1"));
        assert!(filtered.iter().any(|e| e.id == "ent-3"));
    }

    #[tokio::test]
    async fn spawn_creates_entity_with_fresh_uuid() {
        let (agent_reg, er) = test_registry().await;
        let agent = agent_reg.spawn("my-company", None, None).await.unwrap();

        let entity_id = agent.entity_id.clone().expect("agent must own an entity");
        assert_ne!(
            entity_id, agent.id,
            "entity UUID must differ from agent UUID"
        );

        let entity = er.get(&entity_id).await.unwrap().expect("entity row");
        assert_eq!(entity.type_, EntityType::Company);
        assert_eq!(entity.name, "my-company");
    }

    #[tokio::test]
    async fn child_agent_inherits_entity_id() {
        let (agent_reg, _er) = test_registry().await;
        let root = agent_reg.spawn("acme", None, None).await.unwrap();
        let child = agent_reg
            .spawn("worker", Some(&root.id), None)
            .await
            .unwrap();

        assert_eq!(
            child.entity_id, root.entity_id,
            "child agent must inherit the root's entity_id"
        );
    }
}
