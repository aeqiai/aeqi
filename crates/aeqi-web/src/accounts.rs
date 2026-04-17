//! User account storage backed by SQLite.

use mini_moka::sync::Cache;
use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;
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
            );",
        )?;
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

    /// Create a new user with email + password. Returns the user.
    pub fn create_user(&self, email: &str, name: &str, password: &str) -> anyhow::Result<User> {
        let id = Uuid::new_v4().to_string();
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
    pub fn verify_password(&self, email: &str, password: &str) -> anyhow::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT id, password_hash FROM users WHERE email = ?1",
                params![email],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let Some((id, hash)) = row else {
            return Ok(None);
        };

        if !bcrypt::verify(password, &hash)? {
            return Ok(None);
        }

        conn.execute(
            "UPDATE users SET last_login = datetime('now') WHERE id = ?1",
            params![id],
        )?;
        drop(conn);
        self.get_user_by_id(&id)
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
            "SELECT id, email, name, avatar_url, google_id, email_verified, subscription_status, subscription_plan, trial_ends_at, created_at FROM users WHERE id = ?1",
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
                    created_at: row.get(9)?,
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
