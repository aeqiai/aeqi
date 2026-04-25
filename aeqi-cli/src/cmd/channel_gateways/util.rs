//! Shared helpers for channel-gateway spawners.
//!
//! Resolves channel-scoped tokens from the credentials substrate. There is
//! NO fallback to `channels.config` — Move B stripped tokens out of
//! that JSON, so a missing credential is a hard miss the spawner must
//! handle (typically by skipping the spawn with a warning).

use aeqi_core::credentials::{CredentialKey, CredentialStore, ScopeKind};

/// Resolve a single channel-scoped credential by name.
///
/// Returns `Some(<plaintext>)` when the row is present, the blob decrypts
/// cleanly, and the bytes are valid UTF-8 (every channel token is a
/// short ASCII string). Returns `None` for any miss; the caller decides
/// whether that means "skip the spawn" or "abort boot".
pub(super) async fn resolve_channel_token(
    credentials: &CredentialStore,
    channel_id: &str,
    provider: &str,
    name: &str,
) -> Option<String> {
    let key = CredentialKey {
        scope_kind: ScopeKind::Channel,
        scope_id: channel_id.to_string(),
        provider: provider.to_string(),
        name: name.to_string(),
    };
    let row = match credentials.find(&key).await {
        Ok(Some(row)) => row,
        Ok(None) => return None,
        Err(e) => {
            tracing::warn!(
                channel_id = %channel_id,
                provider,
                name,
                error = %e,
                "channel credential lookup failed"
            );
            return None;
        }
    };
    let plain = match credentials.decrypt(&row) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                channel_id = %channel_id,
                provider,
                name,
                error = %e,
                "channel credential decrypt failed"
            );
            return None;
        }
    };
    match String::from_utf8(plain) {
        Ok(s) if !s.is_empty() => Some(s),
        Ok(_) => None,
        Err(e) => {
            tracing::warn!(
                channel_id = %channel_id,
                provider,
                name,
                error = %e,
                "channel credential is not valid UTF-8"
            );
            None
        }
    }
}
