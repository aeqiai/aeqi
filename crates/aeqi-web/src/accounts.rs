//! User account storage backed by SQLite.

use mini_moka::sync::Cache;
use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_id: Option<String>,
    pub email_verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<Vec<String>>,
    pub subscription_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trial_ends_at: Option<String>,
    /// Timestamp the user spent their lifetime free-trial company slot.
    /// `None` means the slot is unused; once flipped to a UTC ISO-8601
    /// string it stays set forever — deleting the company does not
    /// reclaim it (otherwise delete-and-recreate dodges billing).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_company_used_at: Option<String>,
    pub created_at: String,
}

/// Thread-safe account store with an in-memory TTL cache for user lookups.
pub struct AccountStore {
    conn: Mutex<Connection>,
    /// Cache: user_id -> Option<User>. TTL 60s, max 1000 entries.
    user_cache: Cache<String, Option<User>>,
}

impl AccountStore {
    /// Open (or create) the accounts database at the given path.
    pub fn open(data_dir: &Path) -> anyhow::Result<Self> {
        let db_path = data_dir.join("accounts.db");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS users (
                id              TEXT PRIMARY KEY,
                email           TEXT UNIQUE NOT NULL COLLATE NOCASE,
                name            TEXT NOT NULL DEFAULT '',
                password_hash   TEXT,
                avatar_url      TEXT,
                google_id       TEXT UNIQUE,
                email_verified  INTEGER NOT NULL DEFAULT 0,
                verify_code     TEXT,
                verify_expires  TEXT,
                subscription_status TEXT NOT NULL DEFAULT 'none',
                subscription_plan   TEXT,
                trial_ends_at       TEXT,
                free_company_used_at TEXT,
                created_at      TEXT NOT NULL DEFAULT (datetime('now')),
                last_login      TEXT
            );
            CREATE TABLE IF NOT EXISTS user_access (
                user_id    TEXT NOT NULL REFERENCES users(id),
                agent_id   TEXT NOT NULL,
                PRIMARY KEY (user_id, agent_id)
            );
            CREATE TABLE IF NOT EXISTS invite_codes (
                code        TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL REFERENCES users(id),
                used_by     TEXT REFERENCES users(id),
                used_at     TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS waitlist (
                id          TEXT PRIMARY KEY,
                email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS oauth_states (
                state       TEXT PRIMARY KEY,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS login_codes (
                id          TEXT PRIMARY KEY,
                email       TEXT NOT NULL COLLATE NOCASE,
                code        TEXT NOT NULL,
                expires_at  TEXT NOT NULL,
                consumed_at TEXT,
                attempts    INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email);",
        )?;
        // Migration: backfill free_company_used_at on existing user
        // tables (the column landed after the table did). SQLite's
        // ADD COLUMN is idempotent-safe via the schema lookup below.
        let has_free_company_col: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'free_company_used_at'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_free_company_col {
            conn.execute_batch("ALTER TABLE users ADD COLUMN free_company_used_at TEXT;")?;
        }

        // Migration: user_roots -> user_access.
        let has_user_roots: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_roots'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if has_user_roots {
            conn.execute_batch(
                "INSERT OR IGNORE INTO user_access (user_id, agent_id) SELECT user_id, root FROM user_roots;
                 DROP TABLE user_roots;",
            )?;
        }
        let user_cache = Cache::builder()
            .max_capacity(1000)
            .time_to_live(Duration::from_secs(60))
            .build();

        Ok(Self {
            conn: Mutex::new(conn),
            user_cache,
        })
    }

    /// Check if there are zero users (first signup becomes admin).
    pub fn is_empty(&self) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i32 = conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
        Ok(count == 0)
    }

    /// Delete all users, invite codes, waitlist entries, and root agent links.
    pub fn purge_all(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM invite_codes; DELETE FROM user_access; DELETE FROM waitlist; DELETE FROM users;"
        )?;
        Ok(())
    }

    /// Persist a freshly-generated OAuth `state` nonce so the corresponding
    /// callback can verify it. The redirect handler calls this; the callback
    /// calls [`Self::consume_oauth_state`].
    pub fn save_oauth_state(&self, state: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO oauth_states (state) VALUES (?1)",
            [state],
        )?;
        Ok(())
    }

    /// Atomically consume an OAuth `state` nonce. Returns `true` only if the
    /// row existed AND was created within `OAUTH_STATE_TTL`. Any expired or
    /// missing nonce returns `false` — the callback must reject the request.
    /// Also opportunistically GC's all expired entries.
    pub fn consume_oauth_state(&self, state: &str) -> anyhow::Result<bool> {
        const OAUTH_STATE_TTL_SECS: i64 = 600;
        let conn = self.conn.lock().unwrap();
        // GC: drop everything older than the TTL regardless of whether `state`
        // matches. Cheap, bounded, keeps the table from growing.
        conn.execute(
            "DELETE FROM oauth_states
             WHERE created_at < datetime('now', ?1)",
            [format!("-{OAUTH_STATE_TTL_SECS} seconds")],
        )?;
        // Atomic delete-and-check: only matches a row still inside the TTL.
        let n = conn.execute("DELETE FROM oauth_states WHERE state = ?1", [state])?;
        Ok(n > 0)
    }

    /// Create a new user with email + password. Returns the user.
    ///
    /// NOTE: `bcrypt::hash` is CPU-bound (~100 ms). This method is synchronous;
    /// callers in an async context must use [`Self::create_user_async`].
    pub fn create_user(&self, email: &str, name: &str, password: &str) -> anyhow::Result<User> {
        let id = Uuid::new_v4().to_string();
        // Hash BEFORE acquiring the lock — bcrypt is CPU-bound and must not
        // hold the connection mutex during the slow work.
        let hash = bcrypt::hash(password, 10)?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (id, email, name, password_hash) VALUES (?1, ?2, ?3, ?4)",
            params![id, email, name, hash],
        )?;
        drop(conn);
        self.get_user_by_id(&id)?
            .ok_or_else(|| anyhow::anyhow!("failed to read back created user"))
    }

    /// Async wrapper for [`Self::create_user`] that runs the CPU-bound bcrypt
    /// work (and the SQLite INSERT) on the blocking-thread pool, keeping the
    /// tokio worker free.
    pub async fn create_user_async(
        self: Arc<Self>,
        email: String,
        name: String,
        password: String,
    ) -> anyhow::Result<User> {
        tokio::task::spawn_blocking(move || self.create_user(&email, &name, &password)).await?
    }

    /// Find or create a user from an OAuth provider (Google, GitHub, etc.).
    pub fn upsert_oauth_user(
        &self,
        google_id: &str,
        email: &str,
        name: &str,
        avatar_url: Option<&str>,
    ) -> anyhow::Result<User> {
        let conn = self.conn.lock().unwrap();

        // Check if user exists by google_id.
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE google_id = ?1",
                params![google_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = existing {
            // Update last_login + profile.
            conn.execute(
                "UPDATE users SET last_login = datetime('now'), name = ?2, avatar_url = ?3, email_verified = 1 WHERE id = ?1",
                params![id, name, avatar_url],
            )?;
            drop(conn);
            return self
                .get_user_by_id(&id)?
                .ok_or_else(|| anyhow::anyhow!("user not found after update"));
        }

        // Check if user exists by email (link accounts).
        let existing_by_email: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE email = ?1",
                params![email],
                |row| row.get(0),
            )
            .ok();

        if let Some(id) = existing_by_email {
            conn.execute(
                "UPDATE users SET google_id = ?2, email_verified = 1, last_login = datetime('now'), avatar_url = ?3 WHERE id = ?1",
                params![id, google_id, avatar_url],
            )?;
            drop(conn);
            return self
                .get_user_by_id(&id)?
                .ok_or_else(|| anyhow::anyhow!("user not found after link"));
        }

        // New user.
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO users (id, email, name, google_id, avatar_url, email_verified, last_login) VALUES (?1, ?2, ?3, ?4, ?5, 1, datetime('now'))",
            params![id, email, name, google_id, avatar_url],
        )?;
        drop(conn);
        self.get_user_by_id(&id)?
            .ok_or_else(|| anyhow::anyhow!("user not found after create"))
    }

    /// Verify password for email login.
    ///
    /// NOTE: `bcrypt::verify` is CPU-bound (~100 ms). This method is
    /// synchronous and must never hold the connection mutex across the
    /// bcrypt work. Callers in an async context must use
    /// [`Self::verify_password_async`].
    pub fn verify_password(&self, email: &str, password: &str) -> anyhow::Result<Option<User>> {
        // Phase 1: SELECT — acquire lock, read (id, hash), then release.
        let row: Option<(String, String)> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT id, password_hash FROM users WHERE email = ?1",
                params![email],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok()
        }; // lock released here

        let Some((id, hash)) = row else {
            return Ok(None);
        };

        // Phase 2: bcrypt — CPU-bound, no mutex held.
        if !bcrypt::verify(password, &hash)? {
            return Ok(None);
        }

        // Phase 3: UPDATE last_login — re-acquire lock only for the write.
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE users SET last_login = datetime('now') WHERE id = ?1",
                params![id],
            )?;
        } // lock released here

        self.get_user_by_id(&id)
    }

    /// Async wrapper for [`Self::verify_password`] that offloads the entire
    /// call (including the CPU-bound bcrypt work) onto the blocking-thread
    /// pool, keeping the tokio worker free.
    pub async fn verify_password_async(
        self: Arc<Self>,
        email: String,
        password: String,
    ) -> anyhow::Result<Option<User>> {
        tokio::task::spawn_blocking(move || self.verify_password(&email, &password)).await?
    }

    /// Set a 6-digit verification code for a user.
    pub fn set_verify_code(&self, user_id: &str) -> anyhow::Result<String> {
        let code = format!("{:06}", rand::random::<u32>() % 1_000_000);
        let expires = chrono::Utc::now() + chrono::Duration::minutes(15);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET verify_code = ?2, verify_expires = ?3 WHERE id = ?1",
            params![user_id, code, expires.to_rfc3339()],
        )?;
        Ok(code)
    }

    /// Verify the email code. Returns true if valid.
    pub fn verify_email_code(&self, email: &str, code: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(String, String, String)> = conn
            .query_row(
                "SELECT id, verify_code, verify_expires FROM users WHERE email = ?1",
                params![email],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();

        let Some((id, stored_code, expires_str)) = row else {
            return Ok(false);
        };

        if stored_code != code {
            return Ok(false);
        }

        if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(&expires_str)
            && chrono::Utc::now() > expires
        {
            return Ok(false); // Expired.
        }

        conn.execute(
            "UPDATE users SET email_verified = 1, verify_code = NULL, verify_expires = NULL WHERE id = ?1",
            params![id],
        )?;
        Ok(true)
    }

    /// Issue a 6-digit one-time login code for `email`. Returns `Some(code)`
    /// when a user with that email exists, `None` otherwise — callers must
    /// always respond `{ok: true}` to avoid leaking account existence.
    /// Invalidates any prior un-consumed codes for the same email so a fresh
    /// request always wins (no stockpiling).
    pub fn request_login_code(&self, email: &str) -> anyhow::Result<Option<String>> {
        let user_exists = {
            let conn = self.conn.lock().unwrap();
            conn.query_row::<i64, _, _>(
                "SELECT COUNT(*) FROM users WHERE email = ?1",
                params![email],
                |row| row.get(0),
            )
            .unwrap_or(0)
                > 0
        };
        if !user_exists {
            return Ok(None);
        }

        let code = format!("{:06}", rand::random::<u32>() % 1_000_000);
        let id = Uuid::new_v4().to_string();
        let expires = chrono::Utc::now() + chrono::Duration::minutes(10);
        let conn = self.conn.lock().unwrap();
        // Invalidate prior un-consumed codes for this email.
        conn.execute(
            "UPDATE login_codes SET consumed_at = datetime('now')
             WHERE email = ?1 AND consumed_at IS NULL",
            params![email],
        )?;
        conn.execute(
            "INSERT INTO login_codes (id, email, code, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, email, code, expires.to_rfc3339()],
        )?;
        Ok(Some(code))
    }

    /// Consume a login code. Returns the matched user on success. Increments
    /// the attempt counter on every call; the code is locked after 5 failed
    /// attempts to bound brute-force across the 10-min TTL window. Marks the
    /// row consumed on a successful match (single-use).
    pub fn consume_login_code(&self, email: &str, code: &str) -> anyhow::Result<Option<User>> {
        const MAX_ATTEMPTS: i64 = 5;
        let row: Option<(String, String, String, i64)> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT id, code, expires_at, attempts FROM login_codes
                 WHERE email = ?1 AND consumed_at IS NULL
                 ORDER BY created_at DESC LIMIT 1",
                params![email],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .ok()
        };

        let Some((id, stored_code, expires_str, attempts)) = row else {
            return Ok(None);
        };

        if attempts >= MAX_ATTEMPTS {
            // Lock it permanently so future tries also miss.
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE login_codes SET consumed_at = datetime('now') WHERE id = ?1",
                params![id],
            )?;
            return Ok(None);
        }

        let expired = chrono::DateTime::parse_from_rfc3339(&expires_str)
            .map(|e| chrono::Utc::now() > e)
            .unwrap_or(true);

        if stored_code != code || expired {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1",
                params![id],
            )?;
            return Ok(None);
        }

        // Match. Mark consumed and update last_login.
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE login_codes SET consumed_at = datetime('now') WHERE id = ?1",
                params![id],
            )?;
            conn.execute(
                "UPDATE users SET last_login = datetime('now'), email_verified = 1
                 WHERE email = ?1",
                params![email],
            )?;
        }
        // Invalidate the user cache so the bumped email_verified / last_login
        // is re-read on the next /api/auth/me.
        if let Ok(Some(user)) = self.get_user_by_email(email) {
            self.user_cache.invalidate(&user.id);
            return self.get_user_by_id(&user.id);
        }
        Ok(None)
    }

    /// Get a user by ID with their root agents. Results are served from an
    /// in-memory cache (TTL 60 s) to avoid hitting SQLite on every request.
    pub fn get_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>> {
        // Fast path: cache hit.
        if let Some(cached) = self.user_cache.get(&id.to_owned()) {
            return Ok(cached);
        }

        // Cache miss — query the database.
        let conn = self.conn.lock().unwrap();
        let user = conn.query_row(
            "SELECT id, email, name, avatar_url, google_id, email_verified, subscription_status, subscription_plan, trial_ends_at, free_company_used_at, created_at FROM users WHERE id = ?1",
            params![id],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    name: row.get(2)?,
                    avatar_url: row.get(3)?,
                    google_id: row.get(4)?,
                    email_verified: row.get::<_, i32>(5)? != 0,
                    roots: None,
                    subscription_status: row.get(6)?,
                    subscription_plan: row.get(7)?,
                    trial_ends_at: row.get(8)?,
                    free_company_used_at: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        ).ok();

        let result = match user {
            Some(mut u) => {
                let mut stmt =
                    conn.prepare("SELECT agent_id FROM user_access WHERE user_id = ?1")?;
                let roots: Vec<String> = stmt
                    .query_map(params![u.id], |row| row.get(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                u.roots = Some(roots);
                Some(u)
            }
            None => None,
        };
        // Release the lock before touching the cache.
        drop(conn);

        // Populate cache (including None results to avoid repeated misses).
        self.user_cache.insert(id.to_owned(), result.clone());
        Ok(result)
    }

    /// Get a user by email.
    pub fn get_user_by_email(&self, email: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE email = ?1",
                params![email],
                |row| row.get(0),
            )
            .ok();
        drop(conn);
        match id {
            Some(id) => self.get_user_by_id(&id),
            None => Ok(None),
        }
    }

    /// Grant director access for a user to an agent. Invalidates the user
    /// cache so the updated roots list is picked up immediately.
    pub fn add_director(&self, user_id: &str, agent_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO user_access (user_id, agent_id) VALUES (?1, ?2)",
            params![user_id, agent_id],
        )?;
        drop(conn);
        self.user_cache.invalidate(&user_id.to_owned());
        Ok(())
    }

    /// Revoke director access for a user from an agent. Invalidates the user cache.
    pub fn remove_director(&self, user_id: &str, agent_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM user_access WHERE user_id = ?1 AND agent_id = ?2",
            params![user_id, agent_id],
        )?;
        drop(conn);
        self.user_cache.invalidate(&user_id.to_owned());
        Ok(())
    }

    /// Return all agent IDs this user directs.
    pub fn get_user_agents(&self, user_id: &str) -> anyhow::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT agent_id FROM user_access WHERE user_id = ?1")?;
        let agents: Vec<String> = stmt
            .query_map(params![user_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(agents)
    }

    /// Mark the user's lifetime free-trial company slot as consumed. No-op
    /// if already set — the timestamp records the *first* trial spawn and
    /// is not refreshed by subsequent calls. Idempotent at the SQL layer
    /// via `WHERE free_company_used_at IS NULL`.
    pub fn mark_free_company_used(&self, user_id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET free_company_used_at = datetime('now')
             WHERE id = ?1 AND free_company_used_at IS NULL",
            params![user_id],
        )?;
        drop(conn);
        self.user_cache.invalidate(&user_id.to_owned());
        Ok(())
    }

    /// Whether the user has a paid subscription that bypasses the free-
    /// trial cap. Centralized here so the spawn-gating policy lives in
    /// one place; today the rule is simply "any non-`none` status counts
    /// as paid" — refine to plan-tier checks once Start-up/Scale-up land.
    pub fn user_has_paid_plan(&self, user_id: &str) -> anyhow::Result<bool> {
        let Some(user) = self.get_user_by_id(user_id)? else {
            return Ok(false);
        };
        Ok(user.subscription_status != "none")
    }

    /// Return all user IDs who direct the given agent.
    pub fn get_directors(&self, agent_id: &str) -> anyhow::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT user_id FROM user_access WHERE agent_id = ?1")?;
        let users: Vec<String> = stmt
            .query_map(params![agent_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(users)
    }

    // ── Invite codes ──────────────────────────────────

    /// Generate N invite codes for a user.
    pub fn generate_invite_codes(&self, user_id: &str, count: u32) -> anyhow::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut codes = Vec::new();
        for _ in 0..count {
            let code = Uuid::new_v4().to_string()[..8].to_string();
            conn.execute(
                "INSERT INTO invite_codes (code, owner_id) VALUES (?1, ?2)",
                params![code, user_id],
            )?;
            codes.push(code);
        }
        Ok(codes)
    }

    /// Validate and consume an invite code. Returns the owner's user_id.
    pub fn redeem_invite_code(&self, code: &str, used_by: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let updated = conn.execute(
            "UPDATE invite_codes SET used_by = ?2, used_at = datetime('now') WHERE code = ?1 AND used_by IS NULL",
            params![code, used_by],
        )?;
        Ok(updated > 0)
    }

    /// Check if an invite code is valid (exists and unused).
    pub fn is_invite_code_valid(&self, code: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM invite_codes WHERE code = ?1 AND used_by IS NULL",
            params![code],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Get invite codes for a user.
    pub fn get_invite_codes(&self, user_id: &str) -> anyhow::Result<Vec<InviteCode>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT code, used_by, used_at, created_at FROM invite_codes WHERE owner_id = ?1",
        )?;
        let codes = stmt
            .query_map(params![user_id], |row| {
                Ok(InviteCode {
                    code: row.get(0)?,
                    used_by: row.get(1)?,
                    used_at: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(codes)
    }

    // ── Waitlist ───────────────────────────────────────

    /// Add an email to the waitlist.
    pub fn join_waitlist(&self, email: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        match conn.execute(
            "INSERT OR IGNORE INTO waitlist (id, email) VALUES (?1, ?2)",
            params![id, email],
        ) {
            Ok(n) => Ok(n > 0),
            Err(e) => Err(e.into()),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InviteCode {
    pub code: String,
    pub used_by: Option<String>,
    pub used_at: Option<String>,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Returns a fresh `AccountStore` backed by a self-cleaning temp dir.
    /// Each call gets its own unique directory so tests never share state,
    /// even across repeated `cargo test` invocations.
    fn fresh_accounts() -> (AccountStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = AccountStore::open(dir.path()).expect("AccountStore::open");
        (store, dir)
    }

    #[test]
    fn oauth_state_round_trip_consumes_once() {
        let (acc, _dir) = fresh_accounts();
        acc.save_oauth_state("nonce-A").unwrap();
        assert!(acc.consume_oauth_state("nonce-A").unwrap());
        assert!(
            !acc.consume_oauth_state("nonce-A").unwrap(),
            "state must be single-use"
        );
    }

    #[test]
    fn oauth_state_unknown_nonce_rejected() {
        let (acc, _dir) = fresh_accounts();
        assert!(!acc.consume_oauth_state("never-saved").unwrap());
    }

    /// Regression: `verify_password` must not hold the SQLite mutex across
    /// the CPU-bound bcrypt work. If the lock were held the entire time,
    /// N concurrent calls would serialize and take N × bcrypt time. With the
    /// fix the calls overlap on the blocking pool and total wallclock is
    /// close to 1 × bcrypt time.
    ///
    /// Tolerance: we allow up to 3× a single-call baseline to give the
    /// blocking pool time to spin up and avoid CI flakiness on slow machines.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_verify_password_does_not_serialize() {
        use std::sync::Arc;

        const CONCURRENCY: usize = 5;

        let (store, _dir) = fresh_accounts();
        let acc = Arc::new(store);

        // Create one user whose password we will verify concurrently.
        acc.create_user("bench@example.com", "Bench", "hunter2hunter2")
            .unwrap();

        // Baseline: one sequential call to establish the bcrypt cost.
        let baseline_start = std::time::Instant::now();
        let _ = acc
            .clone()
            .verify_password_async("bench@example.com".into(), "hunter2hunter2".into())
            .await
            .unwrap();
        let baseline = baseline_start.elapsed();

        // Concurrent: fire CONCURRENCY futures at the same time.
        let concurrent_start = std::time::Instant::now();
        let handles: Vec<_> = (0..CONCURRENCY)
            .map(|_| {
                let store = acc.clone();
                tokio::spawn(async move {
                    store
                        .verify_password_async("bench@example.com".into(), "hunter2hunter2".into())
                        .await
                        .unwrap()
                })
            })
            .collect();
        for h in handles {
            let result = h.await.unwrap();
            assert!(result.is_some(), "verify must succeed");
        }
        let concurrent_elapsed = concurrent_start.elapsed();

        // If the mutex were held across bcrypt, concurrent_elapsed ≈ N × baseline.
        // With the fix, concurrent_elapsed ≈ 1× baseline (parallel on blocking pool).
        // We allow up to 3× baseline to absorb scheduling jitter.
        let limit = baseline * 3;
        assert!(
            concurrent_elapsed <= limit,
            "concurrent verify ({concurrent_elapsed:?}) exceeded 3× baseline ({baseline:?}); \
             lock is probably held across bcrypt"
        );
    }

    #[test]
    fn oauth_state_expired_nonce_rejected() {
        let (acc, _dir) = fresh_accounts();
        // Manually insert an expired state — pretend it was saved long ago.
        {
            let conn = acc.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO oauth_states (state, created_at) VALUES (?1, datetime('now', '-2 hours'))",
                ["stale-nonce"],
            )
            .unwrap();
        }
        assert!(!acc.consume_oauth_state("stale-nonce").unwrap());
        // GC also evicted the expired row.
        let conn = acc.conn.lock().unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM oauth_states WHERE state = 'stale-nonce'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }
}
