//! Sqlite repositories over user_wallets, agent_wallets, session_keys, audit.

pub mod agent_repo;
pub mod auth_repo;
pub mod repo;
pub mod schema;
pub mod solana_repo;

pub use agent_repo::{AgentWalletStore, StoredAgentWallet};
pub use auth_repo::{
    AuthMethodKind, AuthMethodStore, EmailVerificationStore, InsertAuthMethod,
    InsertEmailVerification, InsertPasskeyChallenge, InsertWalletChallenge, PasskeyChallengeKind,
    PasskeyChallengeStore, StoredAuthMethod, StoredEmailVerification, StoredPasskeyChallenge,
    StoredWalletChallenge, WalletChallengeStore,
};
pub use repo::{StoredWallet, WalletStore};
pub use solana_repo::{
    InsertSolanaAgentWallet, InsertSolanaWallet, SolanaAgentWalletStore, SolanaWalletStore,
    StoredSolanaAgentWallet, StoredSolanaWallet,
};
