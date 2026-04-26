//! Core wallet types: addresses, pubkeys, custody states, scopes.

use serde::{Deserialize, Serialize};

/// 20-byte EVM address (checksummed when displayed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Address(pub [u8; 20]);

impl std::fmt::Display for Address {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "0x{}", hex::encode(self.0))
    }
}

/// 33-byte compressed secp256k1 public key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pubkey(pub Vec<u8>);

/// Per-wallet custody state. See architecture doc for transition rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustodyState {
    Custodial,
    CoCustody,
    SelfCustody,
}

impl CustodyState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Custodial => "custodial",
            Self::CoCustody => "co_custody",
            Self::SelfCustody => "self_custody",
        }
    }
}
