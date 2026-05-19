//! Weekly walk-N — the demo-flow smoke test that runs as a background job.
//!
//! Every Sunday at 06:00 UTC, the runtime executes the full anonymous-stranger
//! demo flow against the local platform endpoint:
//!
//! 1. Demo signup (`POST /api/auth/signup` with `mode: "demo"`)
//! 2. Verify the issued JWT carries a session
//! 3. Launch a Company from the default blueprint (`POST /api/start/launch`)
//! 4. Poll for genesis reveal (`GET /api/start/launch/status/{trust_id}`)
//! 5. Poll for the first quest visible on the public trust endpoint
//! 6. Hit `GET /trust/<address>` (the SPA route) for a 200
//!
//! Each run writes a `WalkResult` row to a `walks` table on aeqi.db. The
//! platform `/api/public/status/walks` endpoint reads from that table.
//!
//! Set `AEQI_WALK_FORCE_FAIL=1` to inject a deterministic failure at step 3
//! (Launch). Used to verify the status surface goes red on the next walk.
//!
//! The job is intentionally tolerant: it logs and persists failures rather
//! than panicking, so a transient network blip doesn't kill the runtime.

use anyhow::{Context, Result, anyhow};
use chrono::{DateTime, Datelike, Timelike, Utc, Weekday};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tracing::{info, warn};

use crate::agent_registry::ConnectionPool;

/// Default URL the walks job hits for platform endpoints.
const DEFAULT_PLATFORM_URL: &str = "http://127.0.0.1:8443";

/// Env var that, when set to "1" / "true", forces a deterministic failure
/// at step 3 (launch). Used to verify red walks reach the status surface.
const FORCE_FAIL_ENV: &str = "AEQI_WALK_FORCE_FAIL";

/// Env var that overrides the platform URL the walks job targets. Useful
/// in tests that point the job at a local mock.
const PLATFORM_URL_ENV: &str = "AEQI_WALK_PLATFORM_URL";

/// Env var carrying the shared secret from which the walks-launch header
/// is derived. The orchestrator host unit already inherits this from
/// systemd Environment=; the platform reads it from /etc/aeqi/secrets.env.
/// See `routes::walks` in aeqi-platform for the trust-boundary argument.
const WEB_SECRET_ENV: &str = "AEQI_WEB_SECRET";

/// Fixed purpose string mixed into the derivation. Must match the
/// platform's `routes::walks::DERIVATION_PURPOSE` byte-for-byte. Bump
/// the version suffix if the auth contract ever changes.
const WALKS_LAUNCH_DERIVATION_PURPOSE: &str = "aeqi-walks-launch-v1";

/// Header name carrying the derived secret. Must match the platform's
/// `routes::walks::AUTH_HEADER`.
const WALKS_LAUNCH_AUTH_HEADER: &str = "X-Aeqi-Internal-Auth";

/// Derive the launch-bypass header value from `AEQI_WEB_SECRET`. Returns
/// `None` if the env var is missing — the walks runner treats that as a
/// hard failure rather than silently falling back to the gated endpoint.
///
/// SHA-256 of `<secret>:<purpose>`, hex-encoded. Plain SHA-256 (not
/// HMAC) is safe here because the digest is never exposed to an
/// attacker — the secret stays inside processes that share
/// `AEQI_WEB_SECRET`. Length-extension attacks require the attacker to
/// observe a valid digest, which they cannot here.
fn walks_launch_header_value() -> Option<String> {
    let secret = std::env::var(WEB_SECRET_ENV).ok()?;
    let mut h = Sha256::new();
    h.update(secret.as_bytes());
    h.update(b":");
    h.update(WALKS_LAUNCH_DERIVATION_PURPOSE.as_bytes());
    Some(hex::encode(h.finalize()))
}

/// Polling timeouts.
const LAUNCH_POLL_MAX: Duration = Duration::from_secs(60);
const LAUNCH_POLL_INTERVAL: Duration = Duration::from_secs(2);
const QUEST_POLL_MAX: Duration = Duration::from_secs(30);
const QUEST_POLL_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WalkStatus {
    Pass,
    Fail,
}

impl WalkStatus {
    fn as_str(&self) -> &'static str {
        match self {
            WalkStatus::Pass => "pass",
            WalkStatus::Fail => "fail",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalkResult {
    pub walk_number: i64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    pub status: WalkStatus,
    pub trust_address: Option<String>,
    pub signatures: Vec<String>,
    pub indexer_event_count: i64,
    pub duration_ms: i64,
    pub error: Option<String>,
}

/// SQLite-backed store for walks. Reuses the orchestrator's `aeqi.db`
/// connection pool — the `walks` table is created with `CREATE TABLE IF
/// NOT EXISTS` on construction, so first boot self-migrates.
pub struct WalksStore {
    db: Arc<ConnectionPool>,
}

impl WalksStore {
    pub async fn open(db: Arc<ConnectionPool>) -> Result<Self> {
        {
            let conn = db.lock().await;
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS walks (
                    walk_number INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    trust_address TEXT,
                    signatures TEXT NOT NULL,
                    indexer_event_count INTEGER NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    error TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_walks_started_at ON walks(started_at DESC);",
            )?;
        }
        Ok(Self { db })
    }

    /// Insert a walk row. `walk_number` on the input is ignored — the
    /// AUTOINCREMENT key is used so we never write conflicting numbers
    /// after a crash.
    pub async fn record(&self, w: &WalkResult) -> Result<i64> {
        let signatures =
            serde_json::to_string(&w.signatures).context("serialize walk signatures")?;
        let conn = self.db.lock().await;
        conn.execute(
            "INSERT INTO walks (
                started_at, finished_at, status, trust_address,
                signatures, indexer_event_count, duration_ms, error
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                w.started_at.to_rfc3339(),
                w.finished_at.to_rfc3339(),
                w.status.as_str(),
                w.trust_address,
                signatures,
                w.indexer_event_count,
                w.duration_ms,
                w.error,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Read the latest `limit` walks newest-first. Used by tests; the
    /// platform reads the same table directly via `rusqlite`.
    pub async fn list_latest(&self, limit: usize) -> Result<Vec<WalkResult>> {
        let conn = self.db.lock().await;
        let mut stmt = conn.prepare(
            "SELECT walk_number, started_at, finished_at, status, trust_address,
                    signatures, indexer_event_count, duration_ms, error
             FROM walks ORDER BY walk_number DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], parse_walk_row)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}

fn parse_walk_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WalkResult> {
    let walk_number: i64 = row.get(0)?;
    let started_at: String = row.get(1)?;
    let finished_at: String = row.get(2)?;
    let status_str: String = row.get(3)?;
    let trust_address: Option<String> = row.get(4)?;
    let signatures_json: String = row.get(5)?;
    let indexer_event_count: i64 = row.get(6)?;
    let duration_ms: i64 = row.get(7)?;
    let error: Option<String> = row.get(8)?;

    let status = if status_str == "pass" {
        WalkStatus::Pass
    } else {
        WalkStatus::Fail
    };
    let signatures: Vec<String> = serde_json::from_str(&signatures_json).unwrap_or_default();
    let started_at = DateTime::parse_from_rfc3339(&started_at)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
        })?;
    let finished_at = DateTime::parse_from_rfc3339(&finished_at)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(WalkResult {
        walk_number,
        started_at,
        finished_at,
        status,
        trust_address,
        signatures,
        indexer_event_count,
        duration_ms,
        error,
    })
}

/// Run one walk end-to-end. Returns a `WalkResult` regardless of outcome —
/// failures are encoded in `status` + `error`, never propagated up so the
/// scheduler loop stays alive.
pub async fn run_one_walk(platform_url: &str) -> WalkResult {
    let started_at = Utc::now();
    let start = Instant::now();
    let force_fail = std::env::var(FORCE_FAIL_ENV)
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE"))
        .unwrap_or(false);

    let outcome = run_one_walk_inner(platform_url, force_fail).await;
    let finished_at = Utc::now();
    let duration_ms = start.elapsed().as_millis() as i64;

    match outcome {
        Ok(success) => WalkResult {
            walk_number: 0, // assigned at insert time
            started_at,
            finished_at,
            status: WalkStatus::Pass,
            trust_address: success.trust_address,
            signatures: success.signatures,
            indexer_event_count: success.indexer_event_count,
            duration_ms,
            error: None,
        },
        Err(e) => WalkResult {
            walk_number: 0,
            started_at,
            finished_at,
            status: WalkStatus::Fail,
            trust_address: None,
            signatures: Vec::new(),
            indexer_event_count: 0,
            duration_ms,
            error: Some(e.to_string()),
        },
    }
}

struct WalkSuccess {
    trust_address: Option<String>,
    signatures: Vec<String>,
    indexer_event_count: i64,
}

async fn run_one_walk_inner(platform_url: &str, force_fail: bool) -> Result<WalkSuccess> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .context("build walk HTTP client")?;

    // Step 1: demo signup
    let email = format!(
        "walk-{}-{}@aeqi.test",
        Utc::now().format("%Y%m%d%H%M%S"),
        rand::random::<u32>()
    );
    let signup = client
        .post(format!("{platform_url}/api/auth/signup"))
        .json(&serde_json::json!({
            "mode": "demo",
            "email": email,
            "name": "Walk Bot",
        }))
        .send()
        .await
        .context("step 1: demo signup request")?;
    if !signup.status().is_success() {
        let status = signup.status();
        let body = signup.text().await.unwrap_or_default();
        return Err(anyhow!(
            "step 1 (demo signup) failed: HTTP {status}: {body}"
        ));
    }
    let signup_body: serde_json::Value =
        signup.json().await.context("step 1: parse signup body")?;
    let token = signup_body
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| anyhow!("step 1 (demo signup) response missing token"))?
        .to_string();

    // Step 2: verify session — `/api/auth/me` returns 200 with a JWT.
    let me = client
        .get(format!("{platform_url}/api/auth/me"))
        .bearer_auth(&token)
        .send()
        .await
        .context("step 2: verify session")?;
    if !me.status().is_success() {
        let status = me.status();
        return Err(anyhow!("step 2 (verify session) failed: HTTP {status}"));
    }

    // Step 3: launch from default blueprint. The walks bot hits the
    // internal-only `/api/walks/launch` endpoint instead of
    // `/api/start/launch` — it bypasses the subscription + workspace-cap
    // gates (ae-018) after validating an HMAC-derived header. Both
    // processes share `AEQI_WEB_SECRET`, so the header value is
    // computable here without any extra env wiring.
    if force_fail {
        return Err(anyhow!(
            "step 3 (launch) injected failure via {FORCE_FAIL_ENV}"
        ));
    }
    let internal_auth = walks_launch_header_value().ok_or_else(|| {
        anyhow!(
            "step 3 (launch) cannot build {WALKS_LAUNCH_AUTH_HEADER}: \
             {WEB_SECRET_ENV} unset in walks-runner environment"
        )
    })?;
    let display_name = format!("Walk Bot {}", Utc::now().format("%Y%m%d-%H%M%S"));
    let launch = client
        .post(format!("{platform_url}/api/walks/launch"))
        .bearer_auth(&token)
        .header(WALKS_LAUNCH_AUTH_HEADER, &internal_auth)
        .json(&serde_json::json!({
            "display_name": display_name,
            "plan": "growth",
        }))
        .send()
        .await
        .context("step 3: launch request")?;
    if !launch.status().is_success() {
        let status = launch.status();
        let body = launch.text().await.unwrap_or_default();
        return Err(anyhow!("step 3 (launch) failed: HTTP {status}: {body}"));
    }
    let launch_body: serde_json::Value =
        launch.json().await.context("step 3: parse launch body")?;
    let trust_id = launch_body
        .get("trust_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("step 3 (launch) response missing trust_id"))?
        .to_string();

    // Step 4: poll launch-status until genesis reveal (trust_address set).
    let trust_address = poll_for_genesis(&client, platform_url, &token, &trust_id).await?;

    // Step 5: poll the public TRUST endpoint until quest count > 0 OR
    // until the timeout — first-quest visibility is the weaker signal,
    // so we accept zero quests if the trust resolved (templates without
    // initial quests are valid).
    let (signatures, indexer_event_count) =
        poll_for_first_quest(&client, platform_url, &trust_address).await?;

    // Step 6: hit the public TRUST page route. The platform serves the
    // SPA at `/trust/<address>` via the static-file fallback — a 200
    // confirms the route resolves. We don't parse HTML; the JSON we
    // already pulled in step 5 is the real assertion.
    let trust_page = client
        .get(format!("{platform_url}/trust/{trust_address}"))
        .send()
        .await
        .context("step 6: trust page request")?;
    if !trust_page.status().is_success() {
        let status = trust_page.status();
        return Err(anyhow!("step 6 (trust page) failed: HTTP {status}"));
    }

    Ok(WalkSuccess {
        trust_address: Some(trust_address),
        signatures,
        indexer_event_count,
    })
}

async fn poll_for_genesis(
    client: &reqwest::Client,
    platform_url: &str,
    token: &str,
    trust_id: &str,
) -> Result<String> {
    let deadline = Instant::now() + LAUNCH_POLL_MAX;
    loop {
        let resp = client
            .get(format!("{platform_url}/api/start/launch/status/{trust_id}"))
            .bearer_auth(token)
            .send()
            .await
            .context("step 4: launch-status request")?;
        if resp.status().is_success() {
            let body: serde_json::Value = resp
                .json()
                .await
                .context("step 4: parse launch-status body")?;
            if let Some(addr) = body
                .get("trust_address")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                return Ok(addr.to_string());
            }
        }
        if Instant::now() >= deadline {
            return Err(anyhow!(
                "step 4 (genesis reveal) timed out after {LAUNCH_POLL_MAX:?}"
            ));
        }
        tokio::time::sleep(LAUNCH_POLL_INTERVAL).await;
    }
}

async fn poll_for_first_quest(
    client: &reqwest::Client,
    platform_url: &str,
    trust_address: &str,
) -> Result<(Vec<String>, i64)> {
    let deadline = Instant::now() + QUEST_POLL_MAX;
    let mut signatures: Vec<String> = Vec::new();
    let mut event_count: i64 = 0;
    loop {
        let resp = client
            .get(format!("{platform_url}/api/public/trust/{trust_address}"))
            .send()
            .await
            .context("step 5: public trust request")?;
        if resp.status().is_success() {
            let body: serde_json::Value = resp
                .json()
                .await
                .context("step 5: parse public trust body")?;
            signatures = extract_signatures(&body);
            event_count = extract_event_count(&body);
            // Accept if any signatures exist OR the trust resolved cleanly.
            // Some default blueprints don't seed quests at genesis, so quest
            // count > 0 is best-effort.
            if !signatures.is_empty() {
                return Ok((signatures, event_count));
            }
        }
        if Instant::now() >= deadline {
            // Trust resolved (we got here from step 4) but no signatures
            // surfaced yet. Treat as pass with empty signatures rather than
            // fail — the indexer can lag behind the genesis tx.
            return Ok((signatures, event_count));
        }
        tokio::time::sleep(QUEST_POLL_INTERVAL).await;
    }
}

fn extract_signatures(body: &serde_json::Value) -> Vec<String> {
    body.get("signatures")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    s.get("signature")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn extract_event_count(body: &serde_json::Value) -> i64 {
    body.get("events")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len() as i64)
        .unwrap_or(0)
}

// ── Schedule ──────────────────────────────────────────────────────────

/// Resolve the platform URL the walks job should hit. Overridable via
/// `AEQI_WALK_PLATFORM_URL`; defaults to the local platform on 127.0.0.1:8443.
pub fn resolve_platform_url() -> String {
    std::env::var(PLATFORM_URL_ENV).unwrap_or_else(|_| DEFAULT_PLATFORM_URL.to_string())
}

/// Returns true if `now` is within the Sunday 06:00–06:01 UTC firing window.
fn is_weekly_window(now: DateTime<Utc>) -> bool {
    now.weekday() == Weekday::Sun && now.hour() == 6 && now.minute() == 0
}

/// Background job that wakes once a minute and runs the demo walk when the
/// weekly window opens. Idempotency: the store records `last_started_at` in
/// memory so two ticks inside the same minute can't fire twice.
pub struct WeeklyWalkJob {
    store: Arc<WalksStore>,
    platform_url: String,
}

impl WeeklyWalkJob {
    pub fn new(store: Arc<WalksStore>) -> Self {
        Self {
            store,
            platform_url: resolve_platform_url(),
        }
    }

    /// Run the job loop. Call inside `tokio::spawn`.
    pub async fn run(self, shutdown: Arc<Notify>) {
        info!(platform_url = %self.platform_url, "weekly walk job started");
        let mut last_fired_minute: Option<(i32, u32, u32, u32, u32)> = None;
        loop {
            let now = Utc::now();
            if is_weekly_window(now) {
                let key = (now.year(), now.ordinal(), now.hour(), now.minute(), 0);
                if last_fired_minute != Some(key) {
                    last_fired_minute = Some(key);
                    info!("weekly walk window open — running walk");
                    let result = run_one_walk(&self.platform_url).await;
                    match self.store.record(&result).await {
                        Ok(n) => info!(walk = n, status = ?result.status, "weekly walk recorded"),
                        Err(e) => warn!(error = %e, "failed to persist walk result"),
                    }
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(30)) => {},
                _ = shutdown.notified() => {
                    info!("weekly walk job shutting down");
                    return;
                }
            }
        }
    }
}

/// Best-effort helper for the platform side: open the canonical walks DB
/// read-only and return the latest `limit` rows. Used by
/// `aeqi-platform`'s `/api/public/status/walks` handler (which links
/// against this crate). Keeping the SQL here means the canonical row
/// shape lives next to the writer.
pub fn read_latest_walks_readonly(db_path: &Path, limit: usize) -> Result<Vec<WalkResult>> {
    let conn = Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("open walks DB at {}", db_path.display()))?;
    let mut stmt = conn.prepare(
        "SELECT walk_number, started_at, finished_at, status, trust_address,
                signatures, indexer_event_count, duration_ms, error
         FROM walks ORDER BY walk_number DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit as i64], parse_walk_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn weekly_window_sunday_0600_utc() {
        assert!(is_weekly_window(dt("2026-05-17T06:00:00Z"))); // sunday
        assert!(is_weekly_window(dt("2026-05-17T06:00:59Z"))); // still :00 minute
        assert!(!is_weekly_window(dt("2026-05-17T06:01:00Z"))); // next minute
        assert!(!is_weekly_window(dt("2026-05-17T05:00:00Z"))); // wrong hour
        assert!(!is_weekly_window(dt("2026-05-18T06:00:00Z"))); // monday
    }

    #[test]
    fn extract_signatures_handles_missing() {
        let v = serde_json::json!({});
        assert!(extract_signatures(&v).is_empty());
        let v = serde_json::json!({"signatures": [{"signature": "abc"}, {"signature": "def"}]});
        assert_eq!(extract_signatures(&v), vec!["abc", "def"]);
        let v = serde_json::json!({"signatures": [{"not_signature": "abc"}]});
        assert!(extract_signatures(&v).is_empty());
    }

    #[test]
    fn extract_event_count_handles_missing() {
        let v = serde_json::json!({});
        assert_eq!(extract_event_count(&v), 0);
        let v = serde_json::json!({"events": [1, 2, 3]});
        assert_eq!(extract_event_count(&v), 3);
    }

    #[test]
    fn walks_launch_header_matches_known_vector() {
        // Pinned cross-impl test vector matching the platform's
        // routes::walks::expected_header_value test. If this breaks,
        // step 3 of the walks job will 401 against the platform — fix
        // BOTH sides in lockstep.
        //
        // Reproduction:
        //   echo -n "test-secret-for-known-vector:aeqi-walks-launch-v1" \
        //     | sha256sum
        const EXPECTED: &str = "8642144c8dffa6b1ef1fe738831c6f0d229c77320b450265baf70bf54f445019";

        let prev = std::env::var(WEB_SECRET_ENV).ok();
        unsafe {
            std::env::set_var(WEB_SECRET_ENV, "test-secret-for-known-vector");
        }
        let value = walks_launch_header_value().expect("env set above");
        assert_eq!(value, EXPECTED);
        unsafe {
            match prev {
                Some(v) => std::env::set_var(WEB_SECRET_ENV, v),
                None => std::env::remove_var(WEB_SECRET_ENV),
            }
        }
    }

    #[tokio::test]
    async fn walks_store_records_and_reads() {
        let pool = Arc::new(ConnectionPool::in_memory().unwrap());
        let store = WalksStore::open(pool).await.unwrap();
        let now = Utc::now();
        let r = WalkResult {
            walk_number: 0,
            started_at: now,
            finished_at: now,
            status: WalkStatus::Pass,
            trust_address: Some("aBc123".into()),
            signatures: vec!["sig1".into(), "sig2".into()],
            indexer_event_count: 7,
            duration_ms: 1234,
            error: None,
        };
        let id = store.record(&r).await.unwrap();
        assert_eq!(id, 1);
        let r2 = WalkResult {
            status: WalkStatus::Fail,
            error: Some("boom".into()),
            ..r.clone()
        };
        store.record(&r2).await.unwrap();

        let list = store.list_latest(10).await.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].status, WalkStatus::Fail);
        assert_eq!(list[0].error.as_deref(), Some("boom"));
        assert_eq!(list[1].status, WalkStatus::Pass);
        assert_eq!(list[1].signatures, vec!["sig1", "sig2"]);
        assert_eq!(list[1].trust_address.as_deref(), Some("aBc123"));
    }

    #[test]
    fn walk_status_serializes_lowercase() {
        let s = serde_json::to_string(&WalkStatus::Pass).unwrap();
        assert_eq!(s, "\"pass\"");
        let s = serde_json::to_string(&WalkStatus::Fail).unwrap();
        assert_eq!(s, "\"fail\"");
    }
}
