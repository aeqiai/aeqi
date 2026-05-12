//! Trust identity primitives shared by AEQI crates.
//!
//! This crate defines deterministic trust IDs and a stable metadata binding.
//! Chain-specific provisioning and custody live in higher-level crates.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::fmt;

const TRUST_DOMAIN_TAG: &[u8] = b"aeqi-trust-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct TrustId([u8; 32]);

impl TrustId {
    pub fn from_entity_id(entity_id: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(TRUST_DOMAIN_TAG);
        hasher.update(b":entity:");
        hasher.update(entity_id.as_bytes());
        let digest = hasher.finalize();
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&digest);
        Self(bytes)
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn to_hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }

    pub fn from_hex(input: &str) -> Result<Self, TrustIdParseError> {
        let trimmed = input.trim();
        let hex_str = trimmed.strip_prefix("0x").unwrap_or(trimmed);
        let decoded = hex::decode(hex_str).map_err(|_| TrustIdParseError::InvalidHex)?;
        if decoded.len() != 32 {
            return Err(TrustIdParseError::WrongLength(decoded.len()));
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&decoded);
        Ok(Self(bytes))
    }
}

impl fmt::Display for TrustId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl Serialize for TrustId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for TrustId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_hex(&s).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum TrustIdParseError {
    #[error("invalid hex encoding")]
    InvalidHex,
    #[error("expected 32 bytes, got {0}")]
    WrongLength(usize),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustBinding {
    pub entity_id: String,
    pub trust_id: TrustId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authority_address: Option<String>,
}

impl TrustBinding {
    pub fn new(entity_id: impl Into<String>) -> Self {
        let entity_id = entity_id.into();
        let trust_id = TrustId::from_entity_id(&entity_id);
        Self {
            entity_id,
            trust_id,
            trust_address: None,
            authority_address: None,
        }
    }

    pub fn with_trust_address(mut self, trust_address: impl Into<String>) -> Self {
        self.trust_address = Some(trust_address.into());
        self
    }

    pub fn with_authority_address(mut self, authority_address: impl Into<String>) -> Self {
        self.authority_address = Some(authority_address.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_id_derivation_is_deterministic() {
        let a = TrustId::from_entity_id("company-123");
        let b = TrustId::from_entity_id("company-123");
        let c = TrustId::from_entity_id("company-456");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn hex_round_trip_works() {
        let id = TrustId::from_entity_id("round-trip");
        let encoded = id.to_hex();
        let decoded = TrustId::from_hex(&encoded).unwrap();
        assert_eq!(id, decoded);
    }

    #[test]
    fn trust_binding_derives_id_from_entity() {
        let binding = TrustBinding::new("entity-abc")
            .with_trust_address("trust-xyz")
            .with_authority_address("authority-123");
        assert_eq!(binding.entity_id, "entity-abc");
        assert_eq!(binding.trust_id, TrustId::from_entity_id("entity-abc"));
        assert_eq!(binding.trust_address.as_deref(), Some("trust-xyz"));
        assert_eq!(binding.authority_address.as_deref(), Some("authority-123"));
    }

    #[test]
    fn serde_round_trip_uses_hex() {
        let binding = TrustBinding::new("entity-serde");
        let json = serde_json::to_string(&binding).unwrap();
        assert!(json.contains("\"trust_id\""));
        let decoded: TrustBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(binding, decoded);
    }
}
