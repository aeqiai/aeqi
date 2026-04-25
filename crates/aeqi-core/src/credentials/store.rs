//! SQLite-backed credential store.
//!
//! Holds a `rusqlite::Connection` (wrapped in `Arc<Mutex<...>>`) plus a
//! [`CredentialCipher`]. Every public method runs the rusqlite work inside
//! `tokio::task::spawn_blocking` per the workspace SQLite-in-async rule.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::cipher::CredentialCipher;
use super::types::{CredentialRow, ScopeKind};

/// Insert payload — caller-supplied fields. The store assigns the id and
/// timestamps.
#[derive(Debug, Clone)]
pub struct CredentialInsert {
    pub scope_kind: ScopeKind,
    pub scope_id: String,
    pub provider: String,
    pub name: String,
    pub lifecycle_kind: String,
    /// Plaintext blob — encrypted before write.
    pub plaintext_blob: Vec<u8>,
    pub metadata: serde_json::Value,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Mutable update payload — every field is optional; `None` means leave
/// untouched.
#[derive(Debug, Clone, Default)]
pub struct CredentialUpdate {
    pub plaintext_blob: Option<Vec<u8>>,
    pub metadata: Option<serde_json::Value>,
    pub expires_at: Option<Option<DateTime<Utc>>>,
    pub bump_last_refreshed: bool,
    pub bump_last_used: bool,
}

/// Lookup key for the secondary unique index.
#[derive(Debug, Clone)]
pub struct CredentialKey {
    pub scope_kind: ScopeKind,
    pub scope_id: String,
    pub provider: String,
    pub name: String,
}

/// Connection holder — `Arc<Mutex<Connection>>` so multiple `CredentialStore`
/// handles can share the underlying DB without re-opening it.
pub type CredentialDb = Arc<Mutex<Connection>>;

#[derive(Clone)]
pub struct CredentialStore {
    db: CredentialDb,
    cipher: CredentialCipher,
}

impl CredentialStore {
    pub fn new(db: CredentialDb, cipher: CredentialCipher) -> Self {
        Self { db, cipher }
    }

    /// Open against a SQLite file path. Caller is responsible for ensuring
    /// the schema (migration v12) has run — the canonical path is for the
    /// caller to also use `aeqi-ideas` against the same path so the
    /// migration runner stamps the DB.
    pub fn open(path: &std::path::Path, cipher: CredentialCipher) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("failed to open credential DB: {}", path.display()))?;
        Ok(Self::new(Arc::new(Mutex::new(conn)), cipher))
    }

    /// Apply the `credentials` table DDL to a fresh connection. Runs the
    /// same SQL the `aeqi-ideas` migration v12 emits — provided here so
    /// callers (and tests) that don't pull in `aeqi-ideas` can still
    /// stand up the substrate.
    pub fn initialize_schema(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS credentials (\n\
                id TEXT PRIMARY KEY,\n\
                scope_kind TEXT NOT NULL,\n\
                scope_id TEXT NOT NULL,\n\
                provider TEXT NOT NULL,\n\
                name TEXT NOT NULL,\n\
                lifecycle_kind TEXT NOT NULL,\n\
                encrypted_blob BLOB NOT NULL,\n\
                metadata_json TEXT,\n\
                expires_at TEXT,\n\
                created_at TEXT NOT NULL,\n\
                last_refreshed_at TEXT,\n\
                last_used_at TEXT,\n\
                UNIQUE (scope_kind, scope_id, provider, name)\n\
             );\n\
             CREATE INDEX IF NOT EXISTS idx_credentials_scope\n\
                ON credentials(scope_kind, scope_id);\n\
             CREATE INDEX IF NOT EXISTS idx_credentials_provider\n\
                ON credentials(provider);\n\
             CREATE INDEX IF NOT EXISTS idx_credentials_lifecycle\n\
                ON credentials(lifecycle_kind);\n\
             CREATE INDEX IF NOT EXISTS idx_credentials_expires\n\
                ON credentials(expires_at)\n\
                WHERE expires_at IS NOT NULL;",
        )?;
        Ok(())
    }

    /// Insert a new row. Returns the new row's id. Conflicts on the
    /// `(scope_kind, scope_id, provider, name)` unique index bubble up.
    pub async fn insert(&self, ins: CredentialInsert) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let blob = self.cipher.encrypt(&ins.plaintext_blob)?;
        let metadata = serde_json::to_string(&ins.metadata)?;
        let now = Utc::now().to_rfc3339();
        let expires_at = ins.expires_at.map(|t| t.to_rfc3339());
        let scope_kind = ins.scope_kind.as_str();
        let id_clone = id.clone();
        let db = Arc::clone(&self.db);
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = db.lock().expect("credentials mutex");
            conn.execute(
                "INSERT INTO credentials (\
                    id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                    encrypted_blob, metadata_json, expires_at, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    id_clone,
                    scope_kind,
                    ins.scope_id,
                    ins.provider,
                    ins.name,
                    ins.lifecycle_kind,
                    blob,
                    metadata,
                    expires_at,
                    now,
                ],
            )?;
            Ok(())
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(id)
    }

    /// Update an existing row by id.
    pub async fn update(&self, id: &str, upd: CredentialUpdate) -> Result<()> {
        let id = id.to_string();
        let blob = match upd.plaintext_blob {
            Some(p) => Some(self.cipher.encrypt(&p)?),
            None => None,
        };
        let metadata = match upd.metadata {
            Some(m) => Some(serde_json::to_string(&m)?),
            None => None,
        };
        let expires_set = upd.expires_at.is_some();
        let expires_value = upd.expires_at.flatten().map(|t| t.to_rfc3339());
        let bump_refreshed = upd.bump_last_refreshed;
        let bump_used = upd.bump_last_used;
        let now = Utc::now().to_rfc3339();
        let db = Arc::clone(&self.db);
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = db.lock().expect("credentials mutex");
            if let Some(b) = blob {
                conn.execute(
                    "UPDATE credentials SET encrypted_blob = ?1 WHERE id = ?2",
                    params![b, id],
                )?;
            }
            if let Some(m) = metadata {
                conn.execute(
                    "UPDATE credentials SET metadata_json = ?1 WHERE id = ?2",
                    params![m, id],
                )?;
            }
            if expires_set {
                conn.execute(
                    "UPDATE credentials SET expires_at = ?1 WHERE id = ?2",
                    params![expires_value, id],
                )?;
            }
            if bump_refreshed {
                conn.execute(
                    "UPDATE credentials SET last_refreshed_at = ?1 WHERE id = ?2",
                    params![now, id],
                )?;
            }
            if bump_used {
                conn.execute(
                    "UPDATE credentials SET last_used_at = ?1 WHERE id = ?2",
                    params![now, id],
                )?;
            }
            Ok(())
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(())
    }

    /// Delete a row by id.
    pub async fn delete(&self, id: &str) -> Result<()> {
        let id = id.to_string();
        let db = Arc::clone(&self.db);
        tokio::task::spawn_blocking(move || -> Result<()> {
            let conn = db.lock().expect("credentials mutex");
            conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
            Ok(())
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(())
    }

    /// Look up by primary key (the unique index `(scope_kind, scope_id,
    /// provider, name)`). Returns `None` if no row matches.
    pub async fn find(&self, key: &CredentialKey) -> Result<Option<CredentialRow>> {
        let key = key.clone();
        let db = Arc::clone(&self.db);
        let row = tokio::task::spawn_blocking(move || -> Result<Option<CredentialRow>> {
            let conn = db.lock().expect("credentials mutex");
            let mut stmt = conn.prepare(
                "SELECT id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                        encrypted_blob, metadata_json, expires_at, created_at, \
                        last_refreshed_at, last_used_at \
                 FROM credentials \
                 WHERE scope_kind = ?1 AND scope_id = ?2 \
                   AND provider = ?3 AND name = ?4",
            )?;
            stmt.query_row(
                params![
                    key.scope_kind.as_str(),
                    key.scope_id,
                    key.provider,
                    key.name,
                ],
                row_to_credential,
            )
            .optional()
            .map_err(Into::into)
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(row)
    }

    /// Look up by row id.
    pub async fn get(&self, id: &str) -> Result<Option<CredentialRow>> {
        let id = id.to_string();
        let db = Arc::clone(&self.db);
        let row = tokio::task::spawn_blocking(move || -> Result<Option<CredentialRow>> {
            let conn = db.lock().expect("credentials mutex");
            let mut stmt = conn.prepare(
                "SELECT id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                        encrypted_blob, metadata_json, expires_at, created_at, \
                        last_refreshed_at, last_used_at \
                 FROM credentials WHERE id = ?1",
            )?;
            stmt.query_row(params![id], row_to_credential)
                .optional()
                .map_err(Into::into)
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(row)
    }

    /// List every row matching a scope (any provider / name).
    pub async fn list_by_scope(
        &self,
        scope_kind: ScopeKind,
        scope_id: &str,
    ) -> Result<Vec<CredentialRow>> {
        let scope_id = scope_id.to_string();
        let db = Arc::clone(&self.db);
        let rows = tokio::task::spawn_blocking(move || -> Result<Vec<CredentialRow>> {
            let conn = db.lock().expect("credentials mutex");
            let mut stmt = conn.prepare(
                "SELECT id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                        encrypted_blob, metadata_json, expires_at, created_at, \
                        last_refreshed_at, last_used_at \
                 FROM credentials \
                 WHERE scope_kind = ?1 AND scope_id = ?2 \
                 ORDER BY provider, name",
            )?;
            let iter = stmt.query_map(params![scope_kind.as_str(), scope_id], row_to_credential)?;
            iter.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(Into::into)
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(rows)
    }

    /// List every row matching a scope, optionally filtered to a single
    /// `provider`. `provider=None` returns every provider in the scope.
    /// Used by `CredentialPool::from_credentials` and Move B's channel
    /// migration walker.
    pub async fn list_in_scope(
        &self,
        scope_kind: ScopeKind,
        scope_id: &str,
        provider: Option<&str>,
    ) -> Result<Vec<CredentialRow>> {
        let scope_id = scope_id.to_string();
        let provider = provider.map(|p| p.to_string());
        let db = Arc::clone(&self.db);
        let rows = tokio::task::spawn_blocking(move || -> Result<Vec<CredentialRow>> {
            let conn = db.lock().expect("credentials mutex");
            let iter: Vec<CredentialRow> = if let Some(p) = provider {
                let mut stmt = conn.prepare(
                    "SELECT id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                            encrypted_blob, metadata_json, expires_at, created_at, \
                            last_refreshed_at, last_used_at \
                     FROM credentials \
                     WHERE scope_kind = ?1 AND scope_id = ?2 AND provider = ?3 \
                     ORDER BY name",
                )?;
                stmt.query_map(params![scope_kind.as_str(), scope_id, p], row_to_credential)?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            } else {
                let mut stmt = conn.prepare(
                    "SELECT id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                            encrypted_blob, metadata_json, expires_at, created_at, \
                            last_refreshed_at, last_used_at \
                     FROM credentials \
                     WHERE scope_kind = ?1 AND scope_id = ?2 \
                     ORDER BY provider, name",
                )?;
                stmt.query_map(params![scope_kind.as_str(), scope_id], row_to_credential)?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            Ok(iter)
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(rows)
    }

    /// List every row in the table — used by `aeqi doctor` and migrations.
    pub async fn list_all(&self) -> Result<Vec<CredentialRow>> {
        let db = Arc::clone(&self.db);
        let rows = tokio::task::spawn_blocking(move || -> Result<Vec<CredentialRow>> {
            let conn = db.lock().expect("credentials mutex");
            let mut stmt = conn.prepare(
                "SELECT id, scope_kind, scope_id, provider, name, lifecycle_kind, \
                        encrypted_blob, metadata_json, expires_at, created_at, \
                        last_refreshed_at, last_used_at \
                 FROM credentials \
                 ORDER BY scope_kind, scope_id, provider, name",
            )?;
            let iter = stmt.query_map([], row_to_credential)?;
            iter.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(Into::into)
        })
        .await
        .context("spawn_blocking join failed")??;
        Ok(rows)
    }

    /// Decrypt a row's blob. Pure CPU; no `spawn_blocking` needed.
    pub fn decrypt(&self, row: &CredentialRow) -> Result<Vec<u8>> {
        self.cipher.decrypt(&row.encrypted_blob)
    }

    pub fn cipher(&self) -> &CredentialCipher {
        &self.cipher
    }
}

/// Synchronous helper used during config parsing — it runs *before* an async
/// runtime is alive, so the regular async `find` is unavailable. Opens a
/// short-lived rusqlite connection at `data_dir/aeqi.db`, looks up
/// `(scope_kind='global', scope_id='', provider='legacy', name=<name>)`, and
/// returns the decrypted UTF-8 value.
///
/// Returns `Ok(None)` if the table or row is absent — config parsing on a
/// pre-migration system finds no credentials, falls back to env vars, and
/// the daemon's first boot then runs the migration that populates the
/// table.
pub fn read_global_legacy_blob_sync(
    data_dir: &std::path::Path,
    name: &str,
) -> Result<Option<String>> {
    let db_path = data_dir.join("aeqi.db");
    if !db_path.exists() {
        return Ok(None);
    }
    let conn = Connection::open(&db_path)
        .with_context(|| format!("open credentials DB: {}", db_path.display()))?;
    let table_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='credentials'",
            [],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !table_exists {
        return Ok(None);
    }
    let row: Option<Vec<u8>> = conn
        .query_row(
            "SELECT encrypted_blob FROM credentials \
             WHERE scope_kind = 'global' AND scope_id = '' \
               AND provider = 'legacy' AND name = ?1",
            params![name],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?;
    let Some(blob) = row else {
        return Ok(None);
    };
    let secrets_dir = data_dir.join("secrets");
    let cipher = CredentialCipher::open(&secrets_dir).with_context(|| {
        format!(
            "open cipher key for credentials at {}",
            secrets_dir.display()
        )
    })?;
    let plain = cipher.decrypt(&blob)?;
    let s = String::from_utf8(plain).context("credential value is not valid UTF-8")?;
    Ok(Some(s))
}

fn row_to_credential(row: &rusqlite::Row<'_>) -> rusqlite::Result<CredentialRow> {
    let scope_kind_str: String = row.get(1)?;
    let scope_kind = ScopeKind::parse(&scope_kind_str).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            format!("unknown scope_kind: {scope_kind_str}").into(),
        )
    })?;
    let metadata_json: Option<String> = row.get(7)?;
    let metadata = match metadata_json {
        Some(s) if !s.is_empty() => serde_json::from_str(&s).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e))
        })?,
        _ => serde_json::Value::Null,
    };
    let expires_at_str: Option<String> = row.get(8)?;
    let expires_at = expires_at_str
        .map(|s| {
            DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&Utc))
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        8,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        })
        .transpose()?;
    let created_at_str: String = row.get(9)?;
    let created_at = DateTime::parse_from_rfc3339(&created_at_str)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e))
        })?;
    let last_refreshed_str: Option<String> = row.get(10)?;
    let last_refreshed_at = last_refreshed_str
        .map(|s| {
            DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&Utc))
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        10,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        })
        .transpose()?;
    let last_used_str: Option<String> = row.get(11)?;
    let last_used_at = last_used_str
        .map(|s| {
            DateTime::parse_from_rfc3339(&s)
                .map(|d| d.with_timezone(&Utc))
                .map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        11,
                        rusqlite::types::Type::Text,
                        Box::new(e),
                    )
                })
        })
        .transpose()?;
    Ok(CredentialRow {
        id: row.get(0)?,
        scope_kind,
        scope_id: row.get(2)?,
        provider: row.get(3)?,
        name: row.get(4)?,
        lifecycle_kind: row.get(5)?,
        encrypted_blob: row.get(6)?,
        metadata,
        expires_at,
        created_at,
        last_refreshed_at,
        last_used_at,
    })
}
