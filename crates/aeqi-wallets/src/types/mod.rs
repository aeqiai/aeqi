//! Core wallet types: addresses, pubkeys, custody states, IDs.

use serde::{Deserialize, Serialize};

/// Stable opaque identifier for a wallet row.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WalletId(pub String);

impl WalletId {
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4().to_string())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for WalletId {
    fn default() -> Self {
        Self::new()
    }
}

/// 20-byte EVM address. Display is lowercase 0x-prefix; checksum encoding is
/// applied by the frontend per EIP-55 — server stores raw lowercase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Address(pub [u8; 20]);

impl Address {
    pub fn as_hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }

    /// EIP-55 mixed-case checksum address. Required by SIWE messages and most
    /// wallet UIs.
    pub fn as_eip55(&self) -> String {
        use sha3::{Digest, Keccak256};
        let lower = hex::encode(self.0);
        let hash = Keccak256::digest(lower.as_bytes());
        let mut out = String::with_capacity(42);
        out.push_str("0x");
        for (i, ch) in lower.chars().enumerate() {
            if ch.is_ascii_digit() {
                out.push(ch);
            } else {
                let byte = hash[i / 2];
                let nibble = if i % 2 == 0 { byte >> 4 } else { byte & 0x0f };
                if nibble >= 8 {
                    out.push(ch.to_ascii_uppercase());
                } else {
                    out.push(ch);
                }
            }
        }
        out
    }
}

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

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "custodial" => Some(Self::Custodial),
            "co_custody" => Some(Self::CoCustody),
            "self_custody" => Some(Self::SelfCustody),
            _ => None,
        }
    }
}

/// Who provisioned the wallet — runtime-generated custodial, or user-supplied
/// external (SIWE-imported, hardware wallet, etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvisionedBy {
    Runtime,
    User,
}

impl ProvisionedBy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Runtime => "runtime",
            Self::User => "user",
        }
    }
}

/// 65-byte EVM-style ECDSA signature: r (32) || s (32) || v (1, recovery id 0/1 or 27/28).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EcdsaSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
    /// Recovery id (0 or 1). Callers that need EIP-155 / legacy v can convert.
    pub v: u8,
}

impl EcdsaSignature {
    pub fn to_bytes_65(&self) -> [u8; 65] {
        let mut out = [0u8; 65];
        out[..32].copy_from_slice(&self.r);
        out[32..64].copy_from_slice(&self.s);
        out[64] = self.v;
        out
    }
}
