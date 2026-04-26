//! aeqi-wallets — threshold-ECDSA wallets, key custody, and on-chain identity.
//!
//! See `docs/concepts/wallets-and-identity.md` in the docs repo for the full
//! architecture. This crate is the in-house, runtime-native implementation of
//! that design — no third-party SaaS, no vendor lock-in, identical code paths
//! across all three deployment modes (shared SaaS, dedicated VPS, self-hosted).

pub mod delegation;
pub mod kek;
pub mod keypair;
pub mod mpc;
pub mod passkey;
pub mod recovery;
pub mod siwe;
pub mod store;
pub mod types;
pub mod wallet;

pub use kek::{KekError, MasterKekProvider};
pub use keypair::Keypair;
pub use types::{Address, EcdsaSignature, Pubkey, WalletId};
pub use wallet::{
    ProvisionAgentRequest, ProvisionRequest, ProvisionedWallet, RevealedRecovery, WalletError,
    provision_custodial, provision_custodial_for_agent, reveal_agent_recovery_seed,
    reveal_recovery_seed, sign_agent_custodial, sign_custodial,
};
