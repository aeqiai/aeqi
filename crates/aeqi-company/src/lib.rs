//! Company identity primitives shared by AEQI crates.
//!
//! This crate defines deterministic 32-byte company IDs derived from the
//! canonical string `company_id` (the Solana base58 company pubkey, post-rewrite).
//! Chain-specific provisioning and custody live in higher-level crates.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::fmt;

const COMPANY_DOMAIN_TAG: &[u8] = b"aeqi-company-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CompanyId([u8; 32]);

impl CompanyId {
    /// Domain-tagged SHA-256 of the canonical string `company_id`. Stable
    /// across runs and across devices for the same company → the same 32-byte
    /// derivation. Lets PDA-seed paths be idempotent at the on-chain level.
    pub fn from_company_id(company_id: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(COMPANY_DOMAIN_TAG);
        hasher.update(b":company:");
        hasher.update(company_id.as_bytes());
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

    pub fn from_hex(input: &str) -> Result<Self, CompanyIdParseError> {
        let trimmed = input.trim();
        let hex_str = trimmed.strip_prefix("0x").unwrap_or(trimmed);
        let decoded = hex::decode(hex_str).map_err(|_| CompanyIdParseError::InvalidHex)?;
        if decoded.len() != 32 {
            return Err(CompanyIdParseError::WrongLength(decoded.len()));
        }
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&decoded);
        Ok(Self(bytes))
    }
}

impl fmt::Display for CompanyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl Serialize for CompanyId {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for CompanyId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_hex(&s).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum CompanyIdParseError {
    #[error("invalid hex encoding")]
    InvalidHex,
    #[error("expected 32 bytes, got {0}")]
    WrongLength(usize),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn company_id_derivation_is_deterministic() {
        let a = CompanyId::from_company_id("company-123");
        let b = CompanyId::from_company_id("company-123");
        let c = CompanyId::from_company_id("company-456");
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn hex_round_trip_works() {
        let id = CompanyId::from_company_id("round-trip");
        let encoded = id.to_hex();
        let decoded = CompanyId::from_hex(&encoded).unwrap();
        assert_eq!(id, decoded);
    }
}
