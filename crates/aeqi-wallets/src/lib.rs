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
pub mod solana_keypair;
pub mod solana_wallet;
pub mod store;
pub mod types;
pub mod wallet;

pub use kek::{KekError, MasterKekProvider};
pub use keypair::Keypair;
pub use siwe::{SiweError, canonical_message, verify as verify_siwe};
pub use solana_keypair::{Ed25519Signature, SolanaKeypair, SolanaPubkey, verify as verify_solana};
pub use solana_wallet::{
    ProvisionSolanaAgentRequest, ProvisionSolanaRequest, ProvisionedSolanaWallet,
    SolanaWalletError, ensure_primary_solana_user_wallet, ensure_solana_agent_wallet,
    provision_solana_custodial, provision_solana_custodial_for_agent, sign_solana_agent_custodial,
    sign_solana_custodial,
};
pub use types::{Address, EcdsaSignature, Pubkey, WalletId};
pub use wallet::{
    ProvisionAgentRequest, ProvisionRequest, ProvisionedWallet, RevealedRecovery, SharedDb,
    WalletError, ensure_agent_custodial_wallet, ensure_primary_custodial_user_wallet,
    provision_custodial, provision_custodial_for_agent, reveal_agent_recovery_seed,
    reveal_recovery_seed, sign_agent_custodial, sign_custodial,
};
