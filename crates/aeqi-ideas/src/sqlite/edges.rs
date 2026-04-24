//! Idea graph edge operations.
//!
//! Edges live in the `idea_edges` table: (source_id, target_id, relation,
//! strength). This module owns every path that touches that table plus the
//! derived `compute_graph_boost` used by the search pipeline.

use super::SqliteIdeas;
use crate::graph::IdeaEdge;
use aeqi_core::traits::WalkStep;
use anyhow::Result;
use chrono::{DateTime, Utc};
use std::collections::{HashSet, VecDeque};
use tracing::debug;

impl SqliteIdeas {
    /// Store an idea edge (upsert on conflict).
    pub fn store_edge(&self, edge: &IdeaEdge) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in store_edge: {e}"))?;
        conn.execute(
            "INSERT INTO idea_edges (source_id, target_id, relation, strength, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
                strength = MAX(excluded.strength, idea_edges.strength)",
            rusqlite::params![
                edge.source_id,
                edge.target_id,
                edge.relation,
                edge.strength,
                edge.created_at.to_rfc3339(),
            ],
        )?;
        debug!(
            source = %edge.source_id,
            target = %edge.target_id,
            relation = %edge.relation,
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
                let relation: String = row.get(2)?;
                let strength: f32 = row.get(3)?;
                let created_str: String = row.get(4)?;
                Ok((source_id, target_id, relation, strength, created_str))
            })?
            .filter_map(|r| r.ok())
            .filter_map(|(source_id, target_id, relation, strength, created_str)| {
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
            })
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
        // The `idea_edges.relation` column is an open-enum TEXT — the
        // v4 migration expanded the vocabulary to include `supersedes`,
        // `supports`, `contradicts`, `distilled_into`, `caused_by`,
        // `co_retrieved`, `contradiction` (plus the legacy `mentions`,
        // `embeds`, `adjacent`). The canonical string list lives in
        // [`crate::relation::KNOWN_RELATIONS`]; we write the raw string
        // straight through so the full vocabulary round-trips.
        let source = source_id.to_string();
        let target = target_id.to_string();
        let relation = relation.to_string();
        let created = Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            conn.execute(
                "INSERT INTO idea_edges (source_id, target_id, relation, strength, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5) \
                 ON CONFLICT(source_id, target_id, relation) DO UPDATE SET \
                    strength = MAX(excluded.strength, idea_edges.strength)",
                rusqlite::params![source, target, relation, strength, created],
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

    /// BFS-walk the idea graph starting at `from`, up to `max_hops` deep,
    /// optionally filtering edges by `relations` (empty list = all) and
    /// dropping edges whose `strength < strength_threshold`.
    ///
    /// Cycle protection: a `HashSet<String>` of visited ids is maintained
    /// across the BFS frontier so `A → B → A` terminates at depth 2 (the
    /// second visit to `A` is suppressed).
    ///
    /// Strength accumulation: each edge multiplies the path's accumulator
    /// by the edge strength, with an additional per-relation weight for
    /// usage-derived / downweighted relations. Authoritative relations
    /// (`supersedes`, `distilled_into`, `caused_by`) and high-confidence
    /// semantic relations (`mentions`, `embeds`, `supports`) carry full
    /// weight (1.0); `adjacent`, `co_retrieved`, `contradicts` multiply
    /// by 0.7; `contradiction` by 0.5 so walks through contradictions
    /// still surface but rank lower.
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

        // Make the set of allowed relations cheap to probe. Empty set
        // means no filter (allow all).
        let relation_filter: HashSet<String> = relations.iter().cloned().collect();

        // Visited-ids dedup. The start node is seeded so we never emit
        // an edge that loops back to it.
        let mut visited: HashSet<String> = HashSet::new();
        visited.insert(from.to_string());

        // Frontier items track (id, depth, strength_accum). We consume
        // from the front and push successors to the back — standard BFS.
        let mut frontier: VecDeque<(String, u32, f32)> = VecDeque::new();
        frontier.push_back((from.to_string(), 0, 1.0));

        let mut out: Vec<WalkStep> = Vec::new();

        let mut stmt = conn.prepare(
            "SELECT target_id, relation, strength \
             FROM idea_edges \
             WHERE source_id = ?1 AND strength >= ?2",
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
                // Optional relation filter.
                if !relation_filter.is_empty() && !relation_filter.contains(&relation) {
                    continue;
                }
                // Cycle / duplicate suppression — first visit wins (BFS
                // guarantees shortest-path visitation).
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

                // Only extend the frontier while there's depth left.
                if depth + 1 < max_hops {
                    frontier.push_back((target_id, depth + 1, next_strength));
                }
            }
        }

        // Stable-sort by strength descending; keep insertion order within
        // ties so BFS ordering shows through on the tie-break.
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
        // Resolve every referenced name up front, before we suspend on the
        // blocking task. Unresolved names are dropped; self-edges are dropped
        // too (meaningless to link an idea to itself).
        //
        // ── Agent W (write path) note ────────────────────────────────────
        // Typed prefixes (`supersedes`, `contradicts`, `supports`,
        // `distilled_into`) emit their matching relation. Plain `[[X]]`
        // and `![[X]]` keep the legacy `mentions` / `embeds` relations.
        // The DELETE-then-INSERT below scrubs exactly the relations this
        // parser owns — authoritative edges emitted by code paths outside
        // inline parsing (e.g. supersede dispatch) are untouched.
        let resolved: Vec<(String, &'static str)> = {
            let parsed = crate::inline_links::parse_links(body);
            let mut out: Vec<(String, &'static str)> = Vec::new();
            for (relation, name) in parsed.as_relation_pairs() {
                if let Some(target) = resolver(name)
                    && target != source_id
                {
                    // Convert to a &'static str by matching the parser's
                    // fixed enum of relations. An unknown relation here
                    // would be a parser bug — fall back to "mentions".
                    let rel: &'static str = match relation {
                        "mentions" => "mentions",
                        "embeds" => "embeds",
                        "supersedes" => "supersedes",
                        "contradicts" => "contradicts",
                        "supports" => "supports",
                        "distilled_into" => "distilled_into",
                        _ => "mentions",
                    };
                    out.push((target, rel));
                }
            }
            out
        };

        let source_id = source_id.to_string();
        let created = chrono::Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            let tx = conn.unchecked_transaction()?;
            // Scrub every relation the inline parser owns so a removed
            // reference in the body disappears from the graph.
            tx.execute(
                "DELETE FROM idea_edges WHERE source_id = ?1 \
                 AND relation IN ('mentions', 'embeds', 'supersedes', \
                                  'contradicts', 'supports', 'distilled_into')",
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

/// Per-relation weighting factor applied on every hop of the graph walk.
///
/// Rationale:
/// - Authoritative (`supersedes`, `distilled_into`, `caused_by`) and
///   high-confidence semantic relations (`mentions`, `embeds`, `supports`)
///   propagate strength at full weight.
/// - Usage-derived / soft edges (`adjacent`, `co_retrieved`, `contradicts`)
///   multiply by 0.7 so multi-hop walks along them decay naturally.
/// - `contradiction` (the `wrong` feedback signal emits this) multiplies
///   by 0.5 — still surfaces in walks but ranks below supportive paths.
/// - Unknown relations default to 1.0 so open-enum extensions don't silently
///   drop out of the ranking.
fn relation_weight(relation: &str) -> f32 {
    match relation {
        "supersedes" | "distilled_into" | "caused_by" => 1.0,
        "mentions" | "embeds" | "supports" => 1.0,
        "adjacent" | "co_retrieved" | "contradicts" => 0.7,
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

    /// Helper: build a 3-node `A → B → C` chain with `supports` edges at
    /// full strength. Returns the (a, b, c) ids.
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
        let (a, b, c) = chain_abc(&mem, "supports", "supports").await;

        let steps = mem.walk_impl(&a, 2, &[], 0.0).unwrap();
        let ids: std::collections::HashSet<&str> = steps.iter().map(|s| s.to.as_str()).collect();

        assert!(ids.contains(b.as_str()), "walk should reach B at depth 1");
        assert!(ids.contains(c.as_str()), "walk should reach C at depth 2");
        assert_eq!(ids.len(), 2);

        // Depth annotations.
        let by_id: std::collections::HashMap<&str, u32> =
            steps.iter().map(|s| (s.to.as_str(), s.depth)).collect();
        assert_eq!(by_id.get(b.as_str()).copied(), Some(1));
        assert_eq!(by_id.get(c.as_str()).copied(), Some(2));
    }

    #[tokio::test]
    async fn walk_chain_one_hop_only_returns_b() {
        let (mem, _dir) = test_store();
        let (a, b, _c) = chain_abc(&mem, "supports", "supports").await;

        let steps = mem.walk_impl(&a, 1, &[], 0.0).unwrap();
        assert_eq!(steps.len(), 1, "max_hops=1 must stop at depth 1");
        assert_eq!(steps[0].to, b);
        assert_eq!(steps[0].depth, 1);
    }

    #[tokio::test]
    async fn walk_filter_unknown_relation_returns_empty() {
        let (mem, _dir) = test_store();
        let (a, _b, _c) = chain_abc(&mem, "supports", "supports").await;

        let filter = vec!["supersedes".to_string()];
        let steps = mem.walk_impl(&a, 3, &filter, 0.0).unwrap();
        assert!(
            steps.is_empty(),
            "no supersedes edges in the chain — walk must be empty"
        );
    }

    #[tokio::test]
    async fn walk_filter_to_matching_relation_only() {
        let (mem, _dir) = test_store();
        let (a, b, _c) = chain_abc(&mem, "supports", "mentions").await;

        // Only `supports` allowed — A→B keeps, B→C drops.
        let filter = vec!["supports".to_string()];
        let steps = mem.walk_impl(&a, 3, &filter, 0.0).unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].to, b);
        assert_eq!(steps[0].relation, "supports");
    }

    #[tokio::test]
    async fn walk_cycle_does_not_infinite_loop() {
        use aeqi_core::traits::IdeaStore;
        let (mem, _dir) = test_store();
        let a = mem.store("cyc-a", "A", &[], None).await.unwrap();
        let b = mem.store("cyc-b", "B", &[], None).await.unwrap();
        // A → B → A cycle.
        mem.store_idea_edge(&a, &b, "supports", 1.0).await.unwrap();
        mem.store_idea_edge(&b, &a, "supports", 1.0).await.unwrap();

        // max_hops=10 would loop forever without visited-set suppression.
        let steps = mem.walk_impl(&a, 10, &[], 0.0).unwrap();
        // Exactly one step: A → B. The reverse edge would revisit A
        // (the start node, already in `visited`), so it's dropped.
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
        mem.store_idea_edge(&a, &b, "supports", 0.9).await.unwrap();
        mem.store_idea_edge(&a, &c, "supports", 0.05).await.unwrap();

        // Threshold 0.1 keeps A→B (0.9) but drops A→C (0.05).
        let steps = mem.walk_impl(&a, 1, &[], 0.1).unwrap();
        let targets: std::collections::HashSet<&str> =
            steps.iter().map(|s| s.to.as_str()).collect();
        assert!(targets.contains(b.as_str()));
        assert!(!targets.contains(c.as_str()));
    }

    #[tokio::test]
    async fn walk_max_hops_zero_returns_empty() {
        let (mem, _dir) = test_store();
        let (a, _b, _c) = chain_abc(&mem, "supports", "supports").await;

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
        // Path through `adjacent` edges (weight 0.7 per hop).
        mem.store_idea_edge(&a, &b, "adjacent", 1.0).await.unwrap();
        mem.store_idea_edge(&b, &c, "adjacent", 1.0).await.unwrap();

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
}
