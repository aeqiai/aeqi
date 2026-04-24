//! Idea graph edge operations.
//!
//! Edges live in the `idea_edges` table: (source_id, target_id, relation,
//! strength). This module owns every path that touches that table plus the
//! derived `compute_graph_boost` used by the search pipeline.

use super::SqliteIdeas;
use crate::graph::{IdeaEdge, IdeaRelation};
use anyhow::Result;
use chrono::{DateTime, Utc};
use tracing::debug;

impl SqliteIdeas {
    /// Store an idea edge (upsert on conflict).
    pub fn store_edge(&self, edge: &IdeaEdge) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in store_edge: {e}"))?;
        let relation_str = serde_json::to_value(edge.relation)?
            .as_str()
            .unwrap_or("adjacent")
            .to_string();
        conn.execute(
            "INSERT INTO idea_edges (source_id, target_id, relation, strength, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
                strength = MAX(excluded.strength, idea_edges.strength)",
            rusqlite::params![
                edge.source_id,
                edge.target_id,
                relation_str,
                edge.strength,
                edge.created_at.to_rfc3339(),
            ],
        )?;
        debug!(
            source = %edge.source_id,
            target = %edge.target_id,
            relation = %relation_str,
            strength = edge.strength,
            "stored idea edge"
        );
        Ok(())
    }

    /// Fetch all edges where this idea is source or target.
    pub fn fetch_edges(&self, idea_id: &str) -> Result<Vec<IdeaEdge>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in fetch_edges: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT source_id, target_id, relation, strength, created_at
             FROM idea_edges
             WHERE source_id = ?1 OR target_id = ?1",
        )?;
        let edges = stmt
            .query_map(rusqlite::params![idea_id], |row| {
                let source_id: String = row.get(0)?;
                let target_id: String = row.get(1)?;
                let relation_str: String = row.get(2)?;
                let strength: f32 = row.get(3)?;
                let created_str: String = row.get(4)?;
                Ok((source_id, target_id, relation_str, strength, created_str))
            })?
            .filter_map(|r| r.ok())
            .filter_map(
                |(source_id, target_id, relation_str, strength, created_str)| {
                    let relation: IdeaRelation =
                        serde_json::from_value(serde_json::Value::String(relation_str)).ok()?;
                    let created_at = DateTime::parse_from_rfc3339(&created_str)
                        .ok()?
                        .with_timezone(&Utc);
                    Some(IdeaEdge {
                        source_id,
                        target_id,
                        relation,
                        strength,
                        created_at,
                    })
                },
            )
            .collect();
        Ok(edges)
    }

    /// Fetch all edges where any of the given IDs is involved.
    pub fn fetch_edges_for_set(&self, ids: &[String]) -> Result<Vec<IdeaEdge>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut all_edges = Vec::new();
        for id in ids {
            all_edges.extend(self.fetch_edges(id)?);
        }
        // Deduplicate by (source, target, relation).
        all_edges.sort_by(|a, b| (&a.source_id, &a.target_id).cmp(&(&b.source_id, &b.target_id)));
        all_edges.dedup_by(|a, b| {
            a.source_id == b.source_id && a.target_id == b.target_id && a.relation == b.relation
        });
        Ok(all_edges)
    }

    /// Compute graph boost for an idea based on supporting edges in a result set.
    pub fn compute_graph_boost(&self, idea_id: &str, result_ids: &[String]) -> f32 {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return 0.0,
        };
        Self::compute_graph_boost_on_conn(&conn, idea_id, result_ids)
    }

    /// Same as [`Self::compute_graph_boost`] but uses an already-locked
    /// connection so callers inside `spawn_blocking` (e.g. the staged
    /// retrieval pipeline) can compute per-candidate boosts without
    /// re-entering the sync mutex.
    pub(super) fn compute_graph_boost_on_conn(
        conn: &rusqlite::Connection,
        idea_id: &str,
        result_ids: &[String],
    ) -> f32 {
        let result_set: std::collections::HashSet<&str> =
            result_ids.iter().map(|s| s.as_str()).collect();
        let Ok(mut stmt) = conn.prepare(
            "SELECT source_id, target_id, relation, strength \
             FROM idea_edges \
             WHERE source_id = ?1 OR target_id = ?1",
        ) else {
            return 0.0;
        };
        let rows = stmt.query_map(rusqlite::params![idea_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)? as f32,
            ))
        });
        let mut boost: f32 = 0.0;
        let Ok(rows) = rows else { return 0.0 };
        for (source_id, target_id, relation_str, strength) in rows.flatten() {
            let other = if source_id == idea_id {
                target_id
            } else {
                source_id
            };
            if !result_set.contains(other.as_str()) {
                continue;
            }
            let weight = match relation_str.as_str() {
                "embeds" => 0.6,
                "mentions" => 0.4,
                "adjacent" => 0.3,
                // Usage-derived edges reinforce co-access; authoritative
                // relations (supersedes, distilled_into, caused_by) are
                // not score-boosters but routing hints.
                "co_retrieved" => 0.25,
                _ => 0.0,
            };
            boost += strength * weight;
        }
        boost.clamp(0.0, 1.0)
    }

    // ── Trait-level edge operations ────────────────────────────────────────

    pub(super) async fn store_idea_edge_impl(
        &self,
        source_id: &str,
        target_id: &str,
        relation: &str,
        strength: f32,
    ) -> Result<()> {
        let relation_enum: IdeaRelation =
            serde_json::from_value(serde_json::Value::String(relation.to_string()))
                .unwrap_or(IdeaRelation::Adjacent);
        let edge = IdeaEdge::new(source_id, target_id, relation_enum, strength);
        let this = self.clone();
        tokio::task::spawn_blocking(move || this.store_edge(&edge))
            .await
            .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))?
    }

    pub(super) async fn remove_idea_edge_impl(
        &self,
        source_id: &str,
        target_id: &str,
        relation: Option<&str>,
    ) -> Result<usize> {
        let source = source_id.to_string();
        let target = target_id.to_string();
        let relation = relation.map(str::to_string);
        self.blocking(move |conn| {
            let rows = if let Some(rel) = relation {
                conn.execute(
                    "DELETE FROM idea_edges WHERE source_id = ?1 AND target_id = ?2 AND relation = ?3",
                    rusqlite::params![source, target, rel],
                )?
            } else {
                conn.execute(
                    "DELETE FROM idea_edges WHERE source_id = ?1 AND target_id = ?2",
                    rusqlite::params![source, target],
                )?
            };
            Ok(rows)
        })
        .await
    }

    pub(super) async fn idea_edges_impl(
        &self,
        idea_id: &str,
    ) -> Result<aeqi_core::traits::IdeaEdges> {
        use aeqi_core::traits::{IdeaEdgeRow, IdeaEdges};
        let idea_id = idea_id.to_string();
        self.blocking(move |conn| {
            let mut links_stmt = conn.prepare(
                "SELECT e.target_id, i.name, e.relation, e.strength \
                 FROM idea_edges e \
                 LEFT JOIN ideas i ON i.id = e.target_id \
                 WHERE e.source_id = ?1 \
                 ORDER BY e.strength DESC, e.created_at DESC",
            )?;
            let links: Vec<IdeaEdgeRow> = links_stmt
                .query_map(rusqlite::params![idea_id], |row| {
                    Ok(IdeaEdgeRow {
                        other_id: row.get(0)?,
                        other_name: row.get(1)?,
                        relation: row.get(2)?,
                        strength: row.get::<_, f64>(3)? as f32,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            let mut backlinks_stmt = conn.prepare(
                "SELECT e.source_id, i.name, e.relation, e.strength \
                 FROM idea_edges e \
                 LEFT JOIN ideas i ON i.id = e.source_id \
                 WHERE e.target_id = ?1 \
                 ORDER BY e.strength DESC, e.created_at DESC",
            )?;
            let backlinks: Vec<IdeaEdgeRow> = backlinks_stmt
                .query_map(rusqlite::params![idea_id], |row| {
                    Ok(IdeaEdgeRow {
                        other_id: row.get(0)?,
                        other_name: row.get(1)?,
                        relation: row.get(2)?,
                        strength: row.get::<_, f64>(3)? as f32,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            Ok(IdeaEdges { links, backlinks })
        })
        .await
    }

    pub(super) async fn edges_between_impl(
        &self,
        ids: &[String],
    ) -> Result<Vec<aeqi_core::traits::IdeaGraphEdge>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids = ids.to_vec();
        self.blocking(move |conn| {
            let placeholders: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 1)).collect();
            let sql = format!(
                "SELECT source_id, target_id, relation, strength \
                 FROM idea_edges \
                 WHERE source_id IN ({ph}) OR target_id IN ({ph})",
                ph = placeholders.join(", ")
            );
            let params: Vec<&dyn rusqlite::types::ToSql> = ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let mut stmt = conn.prepare(&sql)?;
            let edges: Vec<aeqi_core::traits::IdeaGraphEdge> = stmt
                .query_map(params.as_slice(), |row| {
                    Ok(aeqi_core::traits::IdeaGraphEdge {
                        source_id: row.get(0)?,
                        target_id: row.get(1)?,
                        relation: row.get(2)?,
                        strength: row.get::<_, f64>(3)? as f32,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(edges)
        })
        .await
    }

    /// Strengthen `co_retrieved` edges between every pair in `ids`. Called
    /// from the retrieval hot path (fire-and-forget) so ideas that travel
    /// together in result sets accumulate a usage-derived edge over time.
    ///
    /// Pairs are normalised to `(min(a,b), max(a,b))` for undirected dedup —
    /// this relation has no direction. Strength is capped at 1.0 and
    /// `last_reinforced_at` is refreshed each call so the background decay
    /// patrol can prune stale pairs.
    pub fn strengthen_co_retrieval(&self, ids: &[&str]) -> Result<()> {
        if ids.len() < 2 {
            return Ok(());
        }
        let mut pairs: Vec<(String, String)> = Vec::with_capacity(ids.len() * (ids.len() - 1) / 2);
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                let a = ids[i];
                let b = ids[j];
                if a == b {
                    continue;
                }
                let (lo, hi) = if a < b { (a, b) } else { (b, a) };
                pairs.push((lo.to_string(), hi.to_string()));
            }
        }
        if pairs.is_empty() {
            return Ok(());
        }
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in strengthen_co_retrieval: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        let now = Utc::now().to_rfc3339();
        for (src, dst) in pairs {
            tx.execute(
                "INSERT INTO idea_edges \
                    (source_id, target_id, relation, strength, created_at, last_reinforced_at) \
                 VALUES (?1, ?2, 'co_retrieved', 0.05, ?3, ?3) \
                 ON CONFLICT(source_id, target_id, relation) DO UPDATE SET \
                    strength = MIN(1.0, strength + 0.05), \
                    last_reinforced_at = excluded.last_reinforced_at",
                rusqlite::params![src, dst, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Decay `co_retrieved` edges that haven't been reinforced in `days`.
    /// Applies a multiplicative decay (×0.5) then deletes edges that fall
    /// below 0.01. Authoritative relations (`supersedes`, `distilled_into`,
    /// `caused_by`, etc.) are untouched.
    ///
    /// Returns the number of edges updated + deleted so the background
    /// patrol can log progress.
    pub fn decay_co_retrieval_older_than(&self, days: i64) -> Result<u64> {
        let cutoff = (Utc::now() - chrono::Duration::days(days.max(0))).to_rfc3339();
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in decay_co_retrieval_older_than: {e}"))?;
        let tx = conn.unchecked_transaction()?;
        let updated = tx.execute(
            "UPDATE idea_edges SET strength = strength * 0.5 \
             WHERE relation = 'co_retrieved' \
               AND (last_reinforced_at IS NULL OR last_reinforced_at < ?1)",
            rusqlite::params![cutoff],
        )?;
        let deleted = tx.execute(
            "DELETE FROM idea_edges WHERE relation = 'co_retrieved' AND strength < 0.01",
            [],
        )?;
        tx.commit()?;
        Ok((updated + deleted) as u64)
    }

    pub(super) async fn reconcile_inline_edges_impl(
        &self,
        source_id: &str,
        body: &str,
        resolver: &(dyn for<'r> Fn(&'r str) -> Option<String> + Send + Sync),
    ) -> Result<()> {
        // Resolve every referenced name up front, before we suspend on the
        // blocking task. Unresolved names are dropped; self-edges are dropped
        // too (meaningless to link an idea to itself).
        let resolved: Vec<(String, &'static str)> = {
            let parsed = crate::inline_links::parse_links(body);
            let mut out: Vec<(String, &'static str)> = Vec::new();
            for name in parsed.mentions {
                if let Some(target) = resolver(name.as_str())
                    && target != source_id
                {
                    out.push((target, "mentions"));
                }
            }
            for name in parsed.embeds {
                if let Some(target) = resolver(name.as_str())
                    && target != source_id
                {
                    out.push((target, "embeds"));
                }
            }
            out
        };

        let source_id = source_id.to_string();
        let created = chrono::Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "DELETE FROM idea_edges WHERE source_id = ?1 \
                 AND relation IN ('mentions', 'embeds')",
                rusqlite::params![source_id],
            )?;
            for (target_id, relation) in &resolved {
                tx.execute(
                    "INSERT INTO idea_edges \
                        (source_id, target_id, relation, strength, created_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5) \
                     ON CONFLICT(source_id, target_id, relation) DO UPDATE SET \
                        strength = MAX(excluded.strength, idea_edges.strength)",
                    rusqlite::params![source_id, target_id, *relation, 1.0_f64, created],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }
}
