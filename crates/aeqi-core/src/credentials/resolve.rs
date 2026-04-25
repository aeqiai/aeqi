//! Capability → credential resolution.
//!
//! [`CredentialResolver`] is the entry point tools (and the runtime) use to
//! turn a [`CredentialNeed`] into a [`UsableCredential`]. It owns:
//!
//! - The [`CredentialStore`] (DB rows).
//! - A registry of lifecycle handlers keyed by `lifecycle_kind`.
//! - The HTTP client lifecycles use for refresh / mint calls.
//!
//! The resolver implements the policy from the plan:
//!
//! 1. Look up by `(scope_kind, scope_id, provider, name)` per the
//!    `scope_hint`. Agent scope falls back to global if no agent row exists.
//! 2. If the row is expired, ask the lifecycle to refresh and persist the
//!    updated blob.
//! 3. Decrypt + lifecycle-resolve to a `UsableCredential`.
//!
//! On failure the resolver returns a [`CredentialResolveError`] with a
//! stable [`CredentialReasonCode`] so callers can map straight onto the
//! `aeqi doctor` reason-code surface.

use anyhow::Result;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tracing::warn;

use super::lifecycle::CredentialLifecycle;
use super::store::{CredentialKey, CredentialStore, CredentialUpdate};
use super::types::{
    CredentialNeed, CredentialReasonCode, CredentialResolveContext, CredentialRow, RefreshResult,
    ScopeHint, ScopeKind, UsableCredential,
};

#[derive(Debug, Error)]
pub struct CredentialResolveError {
    pub code: CredentialReasonCode,
    pub message: String,
}

impl std::fmt::Display for CredentialResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// Per-need resolution context — identifies the agent / channel / etc. that
/// initiated the lookup.
#[derive(Debug, Clone, Default)]
pub struct ResolutionScope {
    pub agent_id: Option<String>,
    pub user_id: Option<String>,
    pub channel_id: Option<String>,
    pub installation_id: Option<String>,
}

impl ResolutionScope {
    pub fn for_agent(agent_id: impl Into<String>) -> Self {
        Self {
            agent_id: Some(agent_id.into()),
            ..Default::default()
        }
    }
}

#[derive(Clone)]
pub struct CredentialResolver {
    store: CredentialStore,
    lifecycles: Arc<HashMap<&'static str, Arc<dyn CredentialLifecycle>>>,
    http: Option<reqwest::Client>,
}

impl CredentialResolver {
    pub fn new(store: CredentialStore, lifecycles: Vec<Arc<dyn CredentialLifecycle>>) -> Self {
        let map: HashMap<&'static str, Arc<dyn CredentialLifecycle>> =
            lifecycles.into_iter().map(|l| (l.kind(), l)).collect();
        let http = reqwest::Client::builder()
            .user_agent(concat!("aeqi/", env!("CARGO_PKG_VERSION")))
            .build()
            .ok();
        Self {
            store,
            lifecycles: Arc::new(map),
            http,
        }
    }

    pub fn store(&self) -> &CredentialStore {
        &self.store
    }

    pub fn http(&self) -> Option<&reqwest::Client> {
        self.http.as_ref()
    }

    pub fn lifecycle_for(&self, kind: &str) -> Option<Arc<dyn CredentialLifecycle>> {
        self.lifecycles.get(kind).cloned()
    }

    /// Resolve a single need.
    ///
    /// Returns `Ok(Some(_))` on success, `Ok(None)` for an optional missing
    /// credential, and `Err(CredentialResolveError)` for everything else.
    pub async fn resolve(
        &self,
        need: &CredentialNeed,
        scope: &ResolutionScope,
    ) -> Result<Option<UsableCredential>, CredentialResolveError> {
        let row = match self.lookup_row(need, scope).await? {
            Some(r) => r,
            None => {
                if need.optional {
                    return Ok(None);
                }
                return Err(CredentialResolveError {
                    code: CredentialReasonCode::MissingCredential,
                    message: format!(
                        "no credential found for provider={} name={}",
                        need.provider, need.name
                    ),
                });
            }
        };

        let usable = self.resolve_row(&row).await?;
        Ok(Some(usable))
    }

    /// Resolve once a row is known. Used by the on-401 retry path which has
    /// already grabbed the row id from the prior failed call.
    pub async fn resolve_row(
        &self,
        row: &CredentialRow,
    ) -> Result<UsableCredential, CredentialResolveError> {
        let lifecycle = self.lifecycles.get(row.lifecycle_kind.as_str()).cloned();
        let lifecycle = match lifecycle {
            Some(l) => l,
            None => {
                return Err(CredentialResolveError {
                    code: CredentialReasonCode::UnsupportedLifecycle,
                    message: format!("no handler for lifecycle '{}'", row.lifecycle_kind),
                });
            }
        };

        // Refresh if expired.
        let row = if let Some(exp) = row.expires_at {
            if exp <= Utc::now() {
                self.refresh_row(row, lifecycle.as_ref()).await?
            } else {
                row.clone()
            }
        } else {
            row.clone()
        };

        let plaintext = self
            .store
            .decrypt(&row)
            .map_err(|e| CredentialResolveError {
                code: CredentialReasonCode::RefreshFailed,
                message: format!("decrypt failed: {e}"),
            })?;
        let ctx = CredentialResolveContext {
            row: &row,
            plaintext: &plaintext,
            metadata: &row.metadata,
            http: self.http.as_ref(),
        };
        let usable = lifecycle
            .resolve(&ctx)
            .await
            .map_err(|e| CredentialResolveError {
                code: CredentialReasonCode::RefreshFailed,
                message: format!("lifecycle resolve failed: {e}"),
            })?;
        // Best-effort last-used bump.
        let _ = self
            .store
            .update(
                &row.id,
                CredentialUpdate {
                    bump_last_used: true,
                    ..Default::default()
                },
            )
            .await;
        Ok(usable)
    }

    /// Force a refresh by credential id — public entry point for the on-401
    /// retry path. Looks up the row, dispatches to the lifecycle's `refresh`,
    /// persists the new blob, and returns the freshly-resolved
    /// [`UsableCredential`]. The substrate version of "the token endpoint
    /// said our access_token is dead — please mint another one."
    pub async fn refresh_by_id(
        &self,
        credential_id: &str,
    ) -> Result<UsableCredential, CredentialResolveError> {
        let row = self
            .store
            .get(credential_id)
            .await
            .map_err(|e| CredentialResolveError {
                code: CredentialReasonCode::MissingCredential,
                message: format!("get failed: {e}"),
            })?
            .ok_or_else(|| CredentialResolveError {
                code: CredentialReasonCode::MissingCredential,
                message: format!("credential id={credential_id} not found"),
            })?;
        let lifecycle = self
            .lifecycles
            .get(row.lifecycle_kind.as_str())
            .cloned()
            .ok_or_else(|| CredentialResolveError {
                code: CredentialReasonCode::UnsupportedLifecycle,
                message: format!("no handler for lifecycle '{}'", row.lifecycle_kind),
            })?;
        let refreshed_row = self.refresh_row(&row, lifecycle.as_ref()).await?;
        self.resolve_row(&refreshed_row).await
    }

    /// Force a refresh and persist the new blob.
    async fn refresh_row(
        &self,
        row: &CredentialRow,
        lifecycle: &dyn CredentialLifecycle,
    ) -> Result<CredentialRow, CredentialResolveError> {
        let plaintext = self
            .store
            .decrypt(row)
            .map_err(|e| CredentialResolveError {
                code: CredentialReasonCode::RefreshFailed,
                message: format!("decrypt failed: {e}"),
            })?;
        let ctx = CredentialResolveContext {
            row,
            plaintext: &plaintext,
            metadata: &row.metadata,
            http: self.http.as_ref(),
        };
        let result = lifecycle
            .refresh(&ctx)
            .await
            .map_err(|e| CredentialResolveError {
                code: CredentialReasonCode::RefreshFailed,
                message: format!("refresh handler errored: {e}"),
            })?;
        match result {
            RefreshResult::NotNeeded => Ok(row.clone()),
            RefreshResult::Refreshed(usable) => {
                let new_meta = usable.metadata.clone();
                let new_expires = new_meta
                    .get("expires_at")
                    .and_then(|v| v.as_str())
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.with_timezone(&Utc));
                let plaintext = usable.raw.clone();
                self.store
                    .update(
                        &row.id,
                        CredentialUpdate {
                            plaintext_blob: Some(plaintext),
                            metadata: Some(new_meta),
                            expires_at: Some(new_expires),
                            bump_last_refreshed: true,
                            ..Default::default()
                        },
                    )
                    .await
                    .map_err(|e| CredentialResolveError {
                        code: CredentialReasonCode::RefreshFailed,
                        message: format!("persist refreshed blob failed: {e}"),
                    })?;
                self.store
                    .get(&row.id)
                    .await
                    .map_err(|e| CredentialResolveError {
                        code: CredentialReasonCode::RefreshFailed,
                        message: format!("re-read failed: {e}"),
                    })?
                    .ok_or_else(|| CredentialResolveError {
                        code: CredentialReasonCode::UnresolvedRef,
                        message: "row vanished mid-refresh".into(),
                    })
            }
            RefreshResult::Failed(code, msg) => Err(CredentialResolveError { code, message: msg }),
        }
    }

    async fn lookup_row(
        &self,
        need: &CredentialNeed,
        scope: &ResolutionScope,
    ) -> Result<Option<CredentialRow>, CredentialResolveError> {
        let order = match need.scope_hint {
            ScopeHint::Agent => vec![
                scope
                    .agent_id
                    .as_ref()
                    .map(|id| (ScopeKind::Agent, id.clone())),
                Some((ScopeKind::Global, String::new())),
            ],
            ScopeHint::User => vec![
                scope
                    .user_id
                    .as_ref()
                    .map(|id| (ScopeKind::User, id.clone())),
                Some((ScopeKind::Global, String::new())),
            ],
            ScopeHint::Global => vec![Some((ScopeKind::Global, String::new()))],
            ScopeHint::Channel => vec![
                scope
                    .channel_id
                    .as_ref()
                    .map(|id| (ScopeKind::Channel, id.clone())),
            ],
            ScopeHint::Installation => vec![
                scope
                    .installation_id
                    .as_ref()
                    .map(|id| (ScopeKind::Installation, id.clone())),
            ],
        };
        for candidate in order.into_iter().flatten() {
            let key = CredentialKey {
                scope_kind: candidate.0,
                scope_id: candidate.1,
                provider: need.provider.to_string(),
                name: need.name.to_string(),
            };
            match self.store.find(&key).await {
                Ok(Some(row)) => return Ok(Some(row)),
                Ok(None) => continue,
                Err(e) => {
                    warn!(error = %e, provider = need.provider, "credential lookup failed");
                    return Err(CredentialResolveError {
                        code: CredentialReasonCode::MissingCredential,
                        message: format!("lookup error: {e}"),
                    });
                }
            }
        }
        Ok(None)
    }
}
