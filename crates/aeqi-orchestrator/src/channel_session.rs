//! Typed identifiers for transport-bound session bindings.
//!
//! Persisted rows still use the historical `transport:agent_id:peer_id`
//! string key for compatibility, but runtime code should parse and format
//! through this type instead of open-coded string splitting.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelSessionKey {
    pub transport: String,
    pub agent_id: String,
    pub peer_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelSessionRecord {
    pub key: ChannelSessionKey,
    pub session_id: String,
    pub created_at: String,
}

impl ChannelSessionKey {
    pub fn new(
        transport: impl Into<String>,
        agent_id: impl Into<String>,
        peer_id: impl Into<String>,
    ) -> Result<Self, ChannelSessionKeyError> {
        let key = Self {
            transport: transport.into(),
            agent_id: agent_id.into(),
            peer_id: peer_id.into(),
        };
        key.validate()?;
        Ok(key)
    }

    pub fn parse(raw: &str) -> Result<Self, ChannelSessionKeyError> {
        raw.parse()
    }

    pub fn as_key(&self) -> String {
        format!("{}:{}:{}", self.transport, self.agent_id, self.peer_id)
    }

    fn validate(&self) -> Result<(), ChannelSessionKeyError> {
        if self.transport.is_empty() {
            return Err(ChannelSessionKeyError::MissingTransport);
        }
        if self.transport.contains(':') {
            return Err(ChannelSessionKeyError::InvalidTransport);
        }
        if self.agent_id.is_empty() {
            return Err(ChannelSessionKeyError::MissingAgentId);
        }
        if self.agent_id.contains(':') {
            return Err(ChannelSessionKeyError::InvalidAgentId);
        }
        if self.peer_id.is_empty() {
            return Err(ChannelSessionKeyError::MissingPeerId);
        }
        Ok(())
    }
}

impl fmt::Display for ChannelSessionKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.as_key())
    }
}

impl FromStr for ChannelSessionKey {
    type Err = ChannelSessionKeyError;

    fn from_str(raw: &str) -> Result<Self, Self::Err> {
        let mut parts = raw.splitn(3, ':');
        let transport = parts
            .next()
            .ok_or(ChannelSessionKeyError::MissingTransport)?;
        let agent_id = parts.next().ok_or(ChannelSessionKeyError::MissingAgentId)?;
        let peer_id = parts.next().ok_or(ChannelSessionKeyError::MissingPeerId)?;
        Self::new(transport, agent_id, peer_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ChannelSessionKeyError {
    #[error("channel session key is missing transport")]
    MissingTransport,
    #[error("channel session key transport must not contain ':'")]
    InvalidTransport,
    #[error("channel session key is missing agent_id")]
    MissingAgentId,
    #[error("channel session key agent_id must not contain ':'")]
    InvalidAgentId,
    #[error("channel session key is missing peer_id")]
    MissingPeerId,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_channel_session_key() {
        let key = ChannelSessionKey::parse("telegram:agent-1:7822194320").unwrap();
        assert_eq!(key.transport, "telegram");
        assert_eq!(key.agent_id, "agent-1");
        assert_eq!(key.peer_id, "7822194320");
        assert_eq!(key.as_key(), "telegram:agent-1:7822194320");
    }

    #[test]
    fn keeps_colons_in_peer_id_for_future_transports() {
        let key = ChannelSessionKey::parse("custom:agent-1:room:thread:leaf").unwrap();
        assert_eq!(key.peer_id, "room:thread:leaf");
        assert_eq!(key.as_key(), "custom:agent-1:room:thread:leaf");
    }

    #[test]
    fn rejects_incomplete_keys() {
        assert!(ChannelSessionKey::parse("telegram").is_err());
        assert!(ChannelSessionKey::parse("telegram:agent").is_err());
        assert!(ChannelSessionKey::parse(":agent:peer").is_err());
        assert!(ChannelSessionKey::parse("telegram::peer").is_err());
        assert!(ChannelSessionKey::parse("telegram:agent:").is_err());
    }
}
