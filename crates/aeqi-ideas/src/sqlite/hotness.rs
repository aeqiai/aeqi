//! Hotness + access-logging wiring for the ideas store.
//!
//! Hotness is computed by [`crate::graph::HotnessScorer`] — we don't
//! re-implement the sigmoid + recency blend, we just feed it the real
//! columns (`access_count`, `last_accessed`) plus any feedback boost from
//! the `feedback_boost` column.
//!
//! The write side of this module is intentionally fire-and-forget:
//! `record_access` updates the row and appends to `idea_access_log`
//! inside a single blocking task but is never awaited by the search
//! return path. Callers that want to confirm persistence can `await` it,
//! but retrieval should spawn it off and move on.

use super::SqliteIdeas;
use crate::graph::HotnessScorer;
use aeqi_core::traits::{AccessContext, FeedbackMeta};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::OptionalExtension;
use tracing::warn;

impl SqliteIdeas {
    /// Fetch the raw hotness inputs for a single idea using an
    /// already-locked connection. Intended for call sites that already
    /// hold the mutex — the search pipeline in particular.
    pub(super) fn fetch_hotness_inputs_on_conn(
        conn: &rusqlite::Connection,
        id: &str,
    ) -> Result<(u32, Option<DateTime<Utc>>, f32)> {
        let row: Option<(i64, Option<String>, f64)> = conn
            .query_row(
                "SELECT access_count, last_accessed, feedback_boost FROM ideas WHERE id = ?1",
                rusqlite::params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((count, last, boost)) = row else {
            return Ok((0, None, 0.0));
        };
        let last_dt = last
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc));
        Ok((count.max(0) as u32, last_dt, boost as f32))
    }

    /// Fetch the raw hotness inputs for a single idea. Returns `(access_count,
    /// last_accessed, feedback_boost)`. Missing rows yield zeroes so the
    /// final score degrades gracefully to "cold".
    pub fn fetch_hotness_inputs(&self, id: &str) -> Result<(u32, Option<DateTime<Utc>>, f32)> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        Self::fetch_hotness_inputs_on_conn(&conn, id)
    }

    /// Hotness over an already-locked connection. Used by the staged
    /// retrieval pipeline to avoid re-entering the sync mutex.
    pub(super) fn fetch_hotness_on_conn(conn: &rusqlite::Connection, id: &str) -> f32 {
        let Ok((count, last, boost)) = Self::fetch_hotness_inputs_on_conn(conn, id) else {
            return 0.0;
        };
        let scorer = HotnessScorer::default();
        let base = match last {
            Some(ts) => scorer.compute(count, ts),
            None => scorer.compute(count, Utc::now()),
        };
        (base + boost).clamp(0.0, 1.0)
    }

    /// Compute a hotness score for an idea row in [0.0, 1.0]. Combines the
    /// canonical [`HotnessScorer`] output with the stored `feedback_boost`
    /// so a single `used` signal lifts an otherwise cold hit.
    pub fn fetch_hotness(&self, id: &str) -> Result<f32> {
        let (count, last, boost) = self.fetch_hotness_inputs(id)?;
        let scorer = HotnessScorer::default();
        let base = match last {
            Some(ts) => scorer.compute(count, ts),
            // Never accessed: fall back to the "fresh row" blend by treating
            // "now" as the last-access. Feedback boost still layers on top.
            None => scorer.compute(count, Utc::now()),
        };
        Ok((base + boost).clamp(0.0, 1.0))
    }

    /// Trait impl helper — record one access. Appends to `idea_access_log`
    /// and bumps the hotness columns in a single blocking task. The caller
    /// spawns this without awaiting on the hot read path.
    pub(super) async fn record_access_impl(&self, idea_id: &str, ctx: AccessContext) -> Result<()> {
        let idea_id = idea_id.to_string();
        let now = Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            conn.execute(
                "INSERT INTO idea_access_log \
                    (idea_id, accessed_at, agent_id, session_id, context, result_position, query_hash) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    idea_id,
                    now,
                    ctx.agent_id,
                    ctx.session_id,
                    ctx.context,
                    ctx.result_position,
                    ctx.query_hash,
                ],
            )?;
            conn.execute(
                "UPDATE ideas SET access_count = access_count + 1, last_accessed = ?1 \
                 WHERE id = ?2",
                rusqlite::params![now, idea_id],
            )?;
            Ok(())
        })
        .await
    }

    /// Persist one feedback signal and fold its immediate effect into the
    /// row's `feedback_boost` column. Signals map as:
    ///
    /// - `used` / `useful` → boost += 0.10 * weight
    /// - `ignored`         → boost -= 0.05 * weight
    /// - `wrong`           → boost *= 0.30
    /// - `corrected`       → same as `wrong`, caller may attach a note
    /// - `pinned`          → add `pinned` tag (stretch; no-op if already)
    ///
    /// `feedback_boost` is clamped to `[-0.5, 0.5]` so no single signal can
    /// overwhelm the hotness blend.
    pub(super) async fn record_feedback_impl(
        &self,
        idea_id: &str,
        signal: &str,
        weight: f32,
        meta: FeedbackMeta,
    ) -> Result<()> {
        let idea_id = idea_id.to_string();
        let signal = signal.to_string();
        let now = Utc::now().to_rfc3339();
        self.blocking(move |conn| {
            conn.execute(
                "INSERT INTO idea_feedback \
                    (idea_id, signal, weight, at, agent_id, session_id, query_text, note) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    idea_id,
                    signal,
                    weight as f64,
                    now,
                    meta.agent_id,
                    meta.session_id,
                    meta.query_text,
                    meta.note,
                ],
            )?;

            // Current boost → apply signal → clamp → write back.
            let current: f32 = conn
                .query_row(
                    "SELECT feedback_boost FROM ideas WHERE id = ?1",
                    rusqlite::params![idea_id],
                    |row| row.get::<_, f64>(0),
                )
                .optional()?
                .map(|v| v as f32)
                .unwrap_or(0.0);

            let next = match signal.as_str() {
                "used" | "useful" => current + 0.10 * weight,
                "ignored" => current - 0.05 * weight,
                "wrong" | "corrected" => current * 0.30,
                "pinned" => current,
                other => {
                    warn!(signal = %other, "unknown feedback signal; storing boost unchanged");
                    current
                }
            };
            let clamped = next.clamp(-0.5, 0.5) as f64;

            conn.execute(
                "UPDATE ideas SET feedback_boost = ?1, last_feedback_at = ?2 WHERE id = ?3",
                rusqlite::params![clamped, now, idea_id],
            )?;

            if signal == "pinned" {
                conn.execute(
                    "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, 'pinned')",
                    rusqlite::params![idea_id],
                )?;
            }

            Ok(())
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::IdeaStore;

    async fn ideas() -> (SqliteIdeas, tempfile::TempDir) {
        let dir = tempfile::TempDir::new().unwrap();
        let db = dir.path().join("hot.db");
        let mem = SqliteIdeas::open(&db, 30.0).unwrap();
        (mem, dir)
    }

    #[tokio::test]
    async fn record_access_bumps_count_and_timestamp() {
        let (mem, _d) = ideas().await;
        let id = mem.store("t", "body", &[], None).await.unwrap();

        let ctx = AccessContext {
            agent_id: None,
            session_id: None,
            context: "test".into(),
            result_position: Some(0),
            query_hash: Some("abc".into()),
        };
        mem.record_access_impl(&id, ctx).await.unwrap();

        let (count, last, _boost) = mem.fetch_hotness_inputs(&id).unwrap();
        assert_eq!(count, 1);
        assert!(last.is_some());
    }

    #[tokio::test]
    async fn feedback_useful_raises_boost() {
        let (mem, _d) = ideas().await;
        let id = mem.store("t", "body", &[], None).await.unwrap();

        mem.record_feedback_impl(&id, "useful", 1.0, FeedbackMeta::default())
            .await
            .unwrap();
        let (_c, _l, boost) = mem.fetch_hotness_inputs(&id).unwrap();
        assert!(boost > 0.05, "boost after useful = {boost}");
    }

    #[tokio::test]
    async fn feedback_wrong_multiplies_boost_down() {
        let (mem, _d) = ideas().await;
        let id = mem.store("t", "body", &[], None).await.unwrap();

        mem.record_feedback_impl(&id, "useful", 1.0, FeedbackMeta::default())
            .await
            .unwrap();
        mem.record_feedback_impl(&id, "wrong", 1.0, FeedbackMeta::default())
            .await
            .unwrap();
        let (_c, _l, boost) = mem.fetch_hotness_inputs(&id).unwrap();
        assert!(
            boost.abs() < 0.05,
            "wrong signal should crush boost; got {boost}"
        );
    }

    #[tokio::test]
    async fn feedback_boost_is_clamped() {
        let (mem, _d) = ideas().await;
        let id = mem.store("t", "body", &[], None).await.unwrap();

        for _ in 0..20 {
            mem.record_feedback_impl(&id, "useful", 1.0, FeedbackMeta::default())
                .await
                .unwrap();
        }
        let (_c, _l, boost) = mem.fetch_hotness_inputs(&id).unwrap();
        assert!(boost <= 0.5 + f32::EPSILON);
    }
}
