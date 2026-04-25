//! Entity-edge graph operations.
//!
//! Edges live in the `entity_edges` table: (source_kind, source_id,
//! target_kind, target_id, relation, strength). T1.8 generalised the
//! legacy `idea_edges` (idea→idea only) into a polymorphic table that
//! supports cross-kind edges (idea→session, idea→quest, …). The default
//! kind on both sides is `'idea'` so existing read paths compose
//! unchanged.
//!
//! This module owns every path that touches that table plus the derived
//! `compute_graph_boost` used by the search pipeline.

use super::SqliteIdeas;
use crate::graph::EntityEdge;
use aeqi_core::traits::WalkStep;
use anyhow::Result;
use chrono::{DateTime, Utc};
use std::collections::{HashSet, VecDeque};
use tracing::debug;

impl SqliteIdeas {
    /// Store an entity edge (upsert on conflict). Defaults source / target
    /// kinds to `'idea'` when the caller passes the legacy [`EntityEdge::new`]
    /// constructor; cross-kind callers use `EntityEdge::new_cross_kind`.
    pub fn store_edge(&self, edge: &EntityEdge) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in store_edge: {e}"))?;
        conn.execute(
            "INSERT INTO entity_edges \
                (source_kind, source_id, target_kind, target_id, relation, \
                 strength, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
             DO UPDATE SET strength = MAX(excluded.strength, entity_edges.strength)",
            rusqlite::params![
                edge.source_kind,
                edge.source_id,
                edge.target_kind,
                edge.target_id,
                edge.relation,
                edge.strength,
                edge.created_at.to_rfc3339(),
            ],
        )?;
        debug!(
            source_kind = %edge.source_kind,
            source = %edge.source_id,
            target_kind = %edge.target_kind,
            target = %edge.target_id,
            relation = %edge.relation,
            strength = edge.strength,
            "stored entity edge"
        );
        Ok(())
    }

    /// Fetch all edges where this idea is source or target. Cross-kind
    /// edges are included — callers that only care about idea→idea filter
    /// downstream by `target_kind == "idea"`.
    pub fn fetch_edges(&self, idea_id: &str) -> Result<Vec<EntityEdge>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in fetch_edges: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT source_kind, source_id, target_kind, target_id, \
                    relation, strength, created_at \
             FROM entity_edges \
             WHERE (source_kind = 'idea' AND source_id = ?1) \
                OR (target_kind = 'idea' AND target_id = ?1)",
        )?;
        let edges = stmt
            .query_map(rusqlite::params![idea_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, f32>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .filter_map(
                |(source_kind, source_id, target_kind, target_id, relation, strength, created)| {
                    let created_at = DateTime::parse_from_rfc3339(&created)
                        .ok()?
                        .with_timezone(&Utc);
                    Some(EntityEdge {
                        source_kind,
                        source_id,
                        target_kind,
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

    /// Fetch all edges where any of the given idea IDs is involved.
    pub fn fetch_edges_for_set(&self, ids: &[String]) -> Result<Vec<EntityEdge>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut all_edges = Vec::new();
        for id in ids {
            all_edges.extend(self.fetch_edges(id)?);
        }
        // Deduplicate by (source_kind, source_id, target_kind, target_id, relation).
        all_edges.sort_by(|a, b| {
            (
                &a.source_kind,
                &a.source_id,
                &a.target_kind,
                &a.target_id,
                &a.relation,
            )
                .cmp(&(
                    &b.source_kind,
                    &b.source_id,
                    &b.target_kind,
                    &b.target_id,
                    &b.relation,
                ))
        });
        all_edges.dedup_by(|a, b| {
            a.source_kind == b.source_kind
                && a.source_id == b.source_id
                && a.target_kind == b.target_kind
                && a.target_id == b.target_id
                && a.relation == b.relation
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
        // Boost only sums idea→idea edges — cross-kind targets (sessions,
        // quests) aren't in the result set and would compute as zero
        // anyway, but filtering at SQL avoids deserialising them.
        // Exclude self-edges — `contradiction` self-loops are durable
        // markers for "this idea was flagged wrong", not relevance signals.
        let Ok(mut stmt) = conn.prepare(
            "SELECT source_id, target_id, relation, strength \
             FROM entity_edges \
             WHERE source_kind = 'idea' AND target_kind = 'idea' \
               AND (source_id = ?1 OR target_id = ?1) \
               AND source_id != target_id",
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
                "embed" => 0.6,
                "mention" => 0.4,
                "link" => 0.3,
                // Usage-derived edges reinforce co-access at a lower
                // weight than authored connections.
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
        // Default to idea→idea — explicit cross-kind callers use
        // `store_entity_edge_impl` directly.
        self.store_entity_edge_impl("idea", source_id, "idea", target_id, relation, strength)
            .await
    }

    /// Cross-kind edge writer. The trait-facing `store_idea_edge` is a
    /// thin wrapper that pins both kinds to `'idea'`.
    pub(super) async fn store_entity_edge_impl(
        &self,
        source_kind: &str,
        source_id: &str,
        target_kind: &str,
        target_id: &str,
        relation: &str,
        strength: f32,
    ) -> Result<()> {
        let source_kind = source_kind.to_string();
        let source = source_id.to_string();
        let target_kind = target_kind.to_string();
        let target = target_id.to_string();
        let relation = relation.to_string();
        let created = Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            conn.execute(
                "INSERT INTO entity_edges \
                    (source_kind, source_id, target_kind, target_id, \
                     relation, strength, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
                 DO UPDATE SET strength = MAX(excluded.strength, entity_edges.strength)",
                rusqlite::params![
                    source_kind,
                    source,
                    target_kind,
                    target,
                    relation,
                    strength,
                    created
                ],
            )?;
            Ok(())
        })
        .await
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
                    "DELETE FROM entity_edges \
                     WHERE source_kind = 'idea' AND source_id = ?1 \
                       AND target_kind = 'idea' AND target_id = ?2 \
                       AND relation = ?3",
                    rusqlite::params![source, target, rel],
                )?
            } else {
                conn.execute(
                    "DELETE FROM entity_edges \
                     WHERE source_kind = 'idea' AND source_id = ?1 \
                       AND target_kind = 'idea' AND target_id = ?2",
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
            // Outgoing — every edge where this idea is the source. The
            // target may be an idea (left-join populates `name`) or a
            // cross-kind target (session/quest/agent — `other_name` is
            // None). The kind is exposed so UI consumers can render the
            // ref correctly.
            let mut links_stmt = conn.prepare(
                "SELECT e.target_kind, e.target_id, i.name, e.relation, e.strength \
                 FROM entity_edges e \
                 LEFT JOIN ideas i ON e.target_kind = 'idea' AND i.id = e.target_id \
                 WHERE e.source_kind = 'idea' AND e.source_id = ?1 \
                 ORDER BY e.strength DESC, e.created_at DESC",
            )?;
            let links: Vec<IdeaEdgeRow> = links_stmt
                .query_map(rusqlite::params![idea_id], |row| {
                    Ok(IdeaEdgeRow {
                        other_kind: row.get(0)?,
                        other_id: row.get(1)?,
                        other_name: row.get(2)?,
                        relation: row.get(3)?,
                        strength: row.get::<_, f64>(4)? as f32,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            // Incoming — only idea→idea backlinks make sense in this
            // surface (a session can't author a mention edge to an
            // idea), so we keep `target_kind = 'idea'` here.
            let mut backlinks_stmt = conn.prepare(
                "SELECT e.source_kind, e.source_id, i.name, e.relation, e.strength \
                 FROM entity_edges e \
                 LEFT JOIN ideas i ON e.source_kind = 'idea' AND i.id = e.source_id \
                 WHERE e.target_kind = 'idea' AND e.target_id = ?1 \
                 ORDER BY e.strength DESC, e.created_at DESC",
            )?;
            let backlinks: Vec<IdeaEdgeRow> = backlinks_stmt
                .query_map(rusqlite::params![idea_id], |row| {
                    Ok(IdeaEdgeRow {
                        other_kind: row.get(0)?,
                        other_id: row.get(1)?,
                        other_name: row.get(2)?,
                        relation: row.get(3)?,
                        strength: row.get::<_, f64>(4)? as f32,
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
            // Idea-only view: callers that pass idea IDs expect
            // idea→idea edges back. Cross-kind edges are exposed via
            // `idea_edges_impl` instead.
            let sql = format!(
                "SELECT source_id, target_id, relation, strength \
                 FROM entity_edges \
                 WHERE source_kind = 'idea' AND target_kind = 'idea' \
                   AND (source_id IN ({ph}) OR target_id IN ({ph}))",
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
                "INSERT INTO entity_edges \
                    (source_kind, source_id, target_kind, target_id, \
                     relation, strength, created_at, last_reinforced_at) \
                 VALUES ('idea', ?1, 'idea', ?2, 'co_retrieved', 0.05, ?3, ?3) \
                 ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
                 DO UPDATE SET \
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
    /// below 0.01.
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
            "UPDATE entity_edges SET strength = strength * 0.5 \
             WHERE relation = 'co_retrieved' \
               AND (last_reinforced_at IS NULL OR last_reinforced_at < ?1)",
            rusqlite::params![cutoff],
        )?;
        let deleted = tx.execute(
            "DELETE FROM entity_edges WHERE relation = 'co_retrieved' AND strength < 0.01",
            [],
        )?;
        tx.commit()?;
        Ok((updated + deleted) as u64)
    }

    /// BFS-walk the idea graph starting at `from`, up to `max_hops` deep,
    /// optionally filtering edges by `relations` (empty list = all) and
    /// dropping edges whose `strength < strength_threshold`.
    ///
    /// Cycle protection: a `HashSet<String>` of visited ids is maintained
    /// across the BFS frontier so `A → B → A` terminates at depth 2 (the
    /// second visit to `A` is suppressed).
    ///
    /// Walks stay on the idea→idea slice of the graph — cross-kind edges
    /// (idea→session etc.) are NOT traversed because there's no concept
    /// of "session→X" edges to follow.
    ///
    /// Strength accumulation: each edge multiplies the path's accumulator
    /// by the edge strength, with an additional per-relation weight (see
    /// [`relation_weight`]).
    ///
    /// Results are ordered by `strength_accum DESC`, capped at 100 rows
    /// internally. The caller's `limit` is applied downstream.
    pub fn walk_impl(
        &self,
        from: &str,
        max_hops: u32,
        relations: &[String],
        strength_threshold: f32,
    ) -> Result<Vec<WalkStep>> {
        if max_hops == 0 {
            return Ok(Vec::new());
        }
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in walk_impl: {e}"))?;

        let relation_filter: HashSet<String> = relations.iter().cloned().collect();

        let mut visited: HashSet<String> = HashSet::new();
        visited.insert(from.to_string());

        let mut frontier: VecDeque<(String, u32, f32)> = VecDeque::new();
        frontier.push_back((from.to_string(), 0, 1.0));

        let mut out: Vec<WalkStep> = Vec::new();

        let mut stmt = conn.prepare(
            "SELECT target_id, relation, strength \
             FROM entity_edges \
             WHERE source_kind = 'idea' AND target_kind = 'idea' \
               AND source_id = ?1 AND strength >= ?2",
        )?;

        while let Some((node, depth, strength_accum)) = frontier.pop_front() {
            if depth >= max_hops {
                continue;
            }
            let rows =
                stmt.query_map(rusqlite::params![node, strength_threshold as f64], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, f64>(2)? as f32,
                    ))
                })?;
            for row in rows {
                let (target_id, relation, edge_strength) = match row {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                if !relation_filter.is_empty() && !relation_filter.contains(&relation) {
                    continue;
                }
                if visited.contains(&target_id) {
                    continue;
                }
                visited.insert(target_id.clone());

                let weight = relation_weight(&relation);
                let next_strength = strength_accum * edge_strength * weight;

                out.push(WalkStep {
                    from: node.clone(),
                    to: target_id.clone(),
                    relation: relation.clone(),
                    depth: depth + 1,
                    strength: next_strength,
                });

                if depth + 1 < max_hops {
                    frontier.push_back((target_id, depth + 1, next_strength));
                }
            }
        }

        out.sort_by(|a, b| {
            b.strength
                .partial_cmp(&a.strength)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        out.truncate(100);
        Ok(out)
    }

    pub(super) async fn reconcile_inline_edges_impl(
        &self,
        source_id: &str,
        body: &str,
        resolver: &(dyn for<'r> Fn(&'r str) -> Option<String> + Send + Sync),
    ) -> Result<()> {
        // Resolve every referenced idea name up front, before we suspend
        // on the blocking task. Unresolved names are dropped; self-edges
        // are dropped too (meaningless to link an idea to itself).
        // Cross-kind refs (`[[session:abc]]` etc.) are written without
        // the resolver step — the id is taken verbatim.
        //
        // The DELETE-then-INSERT below scrubs exactly the relations the
        // body parser owns (`mention`, `embed`) for this source. Edges
        // emitted by other code paths (`link` edges from "+ Link" UI,
        // `co_retrieved` from co-access) are untouched.
        let parsed = crate::inline_links::parse_links(body);

        // Pre-resolve idea-kind refs through the supplied lookup; non-idea
        // refs pass through unchanged.
        let mut resolved: Vec<(String, String, String)> = Vec::new();
        for r in &parsed.refs {
            if r.target_kind == "idea" {
                if let Some(target) = resolver(&r.target_id)
                    && target != source_id
                {
                    resolved.push(("idea".to_string(), target, r.relation.clone()));
                }
            } else {
                resolved.push((
                    r.target_kind.clone(),
                    r.target_id.clone(),
                    r.relation.clone(),
                ));
            }
        }

        let source_id = source_id.to_string();
        let created = chrono::Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            let tx = conn.unchecked_transaction()?;
            // Scrub the body-parser-owned relations for this source
            // (across all target kinds) so a removed reference in the
            // body disappears from the graph.
            tx.execute(
                "DELETE FROM entity_edges \
                 WHERE source_kind = 'idea' AND source_id = ?1 \
                   AND relation IN ('mention', 'embed')",
                rusqlite::params![source_id],
            )?;
            for (target_kind, target_id, relation) in &resolved {
                tx.execute(
                    "INSERT INTO entity_edges \
                        (source_kind, source_id, target_kind, target_id, \
                         relation, strength, created_at) \
                     VALUES ('idea', ?1, ?2, ?3, ?4, 1.0, ?5) \
                     ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
                     DO UPDATE SET strength = MAX(excluded.strength, entity_edges.strength)",
                    rusqlite::params![source_id, target_kind, target_id, relation, created],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// Cross-kind reference list for a single idea. Used by
    /// `ideas.references` IPC.
    pub(super) async fn idea_references_impl(
        &self,
        idea_id: &str,
    ) -> Result<Vec<aeqi_core::traits::EntityRef>> {
        use aeqi_core::traits::EntityRef;
        let idea_id = idea_id.to_string();
        self.blocking(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT target_kind, target_id, relation, strength \
                 FROM entity_edges \
                 WHERE source_kind = 'idea' AND source_id = ?1 \
                 ORDER BY strength DESC, created_at DESC",
            )?;
            let refs: Vec<EntityRef> = stmt
                .query_map(rusqlite::params![idea_id], |row| {
                    Ok(EntityRef {
                        kind: row.get(0)?,
                        id: row.get(1)?,
                        relation: row.get(2)?,
                        strength: row.get::<_, f64>(3)? as f32,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(refs)
        })
        .await
    }
}

/// Per-relation weighting factor applied on every hop of the graph walk.
///
/// - `embed` propagates strongest (transclusion implies tight coupling).
/// - `mention` and `link` carry full weight for one-hop boosts.
/// - `co_retrieved` decays at 0.7 — usage-derived, weaker signal.
/// - `contradiction` propagates at 0.5 — surfaces but ranks below
///   supportive paths.
/// - Unknown relations default to 1.0 so open-enum extensions don't
///   silently drop out of the ranking.
fn relation_weight(relation: &str) -> f32 {
    match relation {
        "embed" => 1.0,
        "mention" | "link" => 1.0,
        "co_retrieved" => 0.7,
        "contradiction" => 0.5,
        _ => 1.0,
    }
}

#[cfg(test)]
mod walk_tests {
    use super::*;

    fn test_store() -> (SqliteIdeas, tempfile::TempDir) {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("walk.db");
        let store = SqliteIdeas::open(&db_path, 30.0).unwrap();
        (store, dir)
    }

    /// Helper: build a 3-node `A → B → C` chain. Returns the (a, b, c) ids.
    async fn chain_abc(mem: &SqliteIdeas, rel_ab: &str, rel_bc: &str) -> (String, String, String) {
        use aeqi_core::traits::IdeaStore;
        let a = mem.store("node-a", "body A", &[], None).await.unwrap();
        let b = mem.store("node-b", "body B", &[], None).await.unwrap();
        let c = mem.store("node-c", "body C", &[], None).await.unwrap();
        mem.store_idea_edge(&a, &b, rel_ab, 1.0).await.unwrap();
        mem.store_idea_edge(&b, &c, rel_bc, 1.0).await.unwrap();
        (a, b, c)
    }

    #[tokio::test]
    async fn walk_chain_two_hops_returns_b_and_c() {
        let (mem, _dir) = test_store();
        let (a, b, c) = chain_abc(&mem, "mention", "mention").await;

        let steps = mem.walk_impl(&a, 2, &[], 0.0).unwrap();
        let ids: std::collections::HashSet<&str> = steps.iter().map(|s| s.to.as_str()).collect();

        assert!(ids.contains(b.as_str()), "walk should reach B at depth 1");
        assert!(ids.contains(c.as_str()), "walk should reach C at depth 2");
        assert_eq!(ids.len(), 2);

        let by_id: std::collections::HashMap<&str, u32> =
            steps.iter().map(|s| (s.to.as_str(), s.depth)).collect();
        assert_eq!(by_id.get(b.as_str()).copied(), Some(1));
        assert_eq!(by_id.get(c.as_str()).copied(), Some(2));
    }

    #[tokio::test]
    async fn walk_chain_one_hop_only_returns_b() {
        let (mem, _dir) = test_store();
        let (a, b, _c) = chain_abc(&mem, "mention", "mention").await;

        let steps = mem.walk_impl(&a, 1, &[], 0.0).unwrap();
        assert_eq!(steps.len(), 1, "max_hops=1 must stop at depth 1");
        assert_eq!(steps[0].to, b);
        assert_eq!(steps[0].depth, 1);
    }

    #[tokio::test]
    async fn walk_filter_unknown_relation_returns_empty() {
        let (mem, _dir) = test_store();
        let (a, _b, _c) = chain_abc(&mem, "mention", "mention").await;

        let filter = vec!["link".to_string()];
        let steps = mem.walk_impl(&a, 3, &filter, 0.0).unwrap();
        assert!(
            steps.is_empty(),
            "no link edges in the chain — walk must be empty"
        );
    }

    #[tokio::test]
    async fn walk_filter_to_matching_relation_only() {
        let (mem, _dir) = test_store();
        let (a, b, _c) = chain_abc(&mem, "mention", "embed").await;

        let filter = vec!["mention".to_string()];
        let steps = mem.walk_impl(&a, 3, &filter, 0.0).unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].to, b);
        assert_eq!(steps[0].relation, "mention");
    }

    #[tokio::test]
    async fn walk_cycle_does_not_infinite_loop() {
        use aeqi_core::traits::IdeaStore;
        let (mem, _dir) = test_store();
        let a = mem.store("cyc-a", "A", &[], None).await.unwrap();
        let b = mem.store("cyc-b", "B", &[], None).await.unwrap();
        mem.store_idea_edge(&a, &b, "mention", 1.0).await.unwrap();
        mem.store_idea_edge(&b, &a, "mention", 1.0).await.unwrap();

        let steps = mem.walk_impl(&a, 10, &[], 0.0).unwrap();
        assert_eq!(
            steps.len(),
            1,
            "cycle back to start node must not be traversed"
        );
        assert_eq!(steps[0].to, b);
    }

    #[tokio::test]
    async fn walk_strength_threshold_drops_weak_edges() {
        use aeqi_core::traits::IdeaStore;
        let (mem, _dir) = test_store();
        let a = mem.store("s-a", "A", &[], None).await.unwrap();
        let b = mem.store("s-b", "B", &[], None).await.unwrap();
        let c = mem.store("s-c", "C", &[], None).await.unwrap();
        mem.store_idea_edge(&a, &b, "mention", 0.9).await.unwrap();
        mem.store_idea_edge(&a, &c, "mention", 0.05).await.unwrap();

        let steps = mem.walk_impl(&a, 1, &[], 0.1).unwrap();
        let targets: std::collections::HashSet<&str> =
            steps.iter().map(|s| s.to.as_str()).collect();
        assert!(targets.contains(b.as_str()));
        assert!(!targets.contains(c.as_str()));
    }

    #[tokio::test]
    async fn walk_max_hops_zero_returns_empty() {
        let (mem, _dir) = test_store();
        let (a, _b, _c) = chain_abc(&mem, "mention", "mention").await;

        let steps = mem.walk_impl(&a, 0, &[], 0.0).unwrap();
        assert!(steps.is_empty(), "max_hops=0 disables the walk");
    }

    #[tokio::test]
    async fn walk_strength_accum_decays_with_weighted_relations() {
        use aeqi_core::traits::IdeaStore;
        let (mem, _dir) = test_store();
        let a = mem.store("w-a", "A", &[], None).await.unwrap();
        let b = mem.store("w-b", "B", &[], None).await.unwrap();
        let c = mem.store("w-c", "C", &[], None).await.unwrap();
        // Path through `co_retrieved` edges (weight 0.7 per hop).
        mem.store_idea_edge(&a, &b, "co_retrieved", 1.0)
            .await
            .unwrap();
        mem.store_idea_edge(&b, &c, "co_retrieved", 1.0)
            .await
            .unwrap();

        let steps = mem.walk_impl(&a, 2, &[], 0.0).unwrap();
        let by_id: std::collections::HashMap<&str, f32> =
            steps.iter().map(|s| (s.to.as_str(), s.strength)).collect();

        // A→B strength = 1.0 * 1.0 * 0.7 = 0.7
        // A→B→C strength = 0.7 * 1.0 * 0.7 = 0.49
        let b_strength = by_id.get(b.as_str()).copied().unwrap();
        let c_strength = by_id.get(c.as_str()).copied().unwrap();
        assert!((b_strength - 0.7).abs() < 1e-5, "B ≈ 0.7, got {b_strength}");
        assert!(
            (c_strength - 0.49).abs() < 1e-5,
            "C ≈ 0.49, got {c_strength}"
        );
    }

    /// `contradiction` self-edges are durable markers left by the `wrong`
    /// feedback path. They must not feed into graph_boost.
    #[tokio::test]
    async fn graph_boost_excludes_self_edge() {
        use aeqi_core::traits::IdeaStore;
        let (mem, _dir) = test_store();
        let x = mem.store("x", "body", &[], None).await.unwrap();
        let y = mem.store("y", "body", &[], None).await.unwrap();

        mem.store_idea_edge(&x, &x, "contradiction", 1.0)
            .await
            .unwrap();
        mem.store_idea_edge(&x, &y, "link", 1.0).await.unwrap();

        let result_ids = vec![x.clone(), y.clone()];
        let boost = mem.compute_graph_boost(&x, &result_ids);

        // Only the X→Y `link` edge (weight 0.3) should contribute. Self-
        // edge must be excluded.
        assert!(
            (boost - 0.3).abs() < 1e-5,
            "expected boost ≈ 0.3 (link only); got {boost}"
        );
    }

    #[tokio::test]
    async fn graph_boost_co_retrieved_between_distinct_ideas_still_counts() {
        use aeqi_core::traits::IdeaStore;
        let (mem, _dir) = test_store();
        let a = mem.store("a", "body", &[], None).await.unwrap();
        let b = mem.store("b", "body", &[], None).await.unwrap();
        mem.store_idea_edge(&a, &b, "co_retrieved", 1.0)
            .await
            .unwrap();

        let result_ids = vec![a.clone(), b.clone()];
        let boost = mem.compute_graph_boost(&a, &result_ids);
        assert!(
            (boost - 0.25).abs() < 1e-5,
            "co_retrieved edge must contribute; got {boost}"
        );
    }
}
