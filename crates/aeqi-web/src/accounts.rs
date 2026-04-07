//! User account storage backed by SQLite.

use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::Mutex;
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
    pub companies: Option<Vec<String>>,
    pub subscription_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_plan: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trial_ends_at: Option<String>,
    pub created_at: String,
}

/// Thread-safe account store.
pub struct AccountStore {
    conn: Mutex<Connection>,
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
            CREATE TABLE IF NOT EXISTS user_companies (
                user_id    TEXT NOT NULL REFERENCES users(id),
                company    TEXT NOT NULL,
                PRIMARY KEY (user_id, company)
            );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
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

    /// Find or create a user from Google OAuth profile.
    pub fn upsert_google_user(
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

    /// Get a user by ID with their companies.
    pub fn get_user_by_id(&self, id: &str) -> anyhow::Result<Option<User>> {
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
                    companies: None,
                    subscription_status: row.get(6)?,
                    subscription_plan: row.get(7)?,
                    trial_ends_at: row.get(8)?,
                    created_at: row.get(9)?,
                })
            },
        ).ok();

        match user {
            Some(mut u) => {
                let mut stmt =
                    conn.prepare("SELECT company FROM user_companies WHERE user_id = ?1")?;
                let companies: Vec<String> = stmt
                    .query_map(params![u.id], |row| row.get(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                u.companies = Some(companies);
                Ok(Some(u))
            }
            None => Ok(None),
        }
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

    /// Add a company to a user.
    pub fn add_company(&self, user_id: &str, company: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO user_companies (user_id, company) VALUES (?1, ?2)",
            params![user_id, company],
        )?;
        Ok(())
    }
}
