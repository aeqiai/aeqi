//! Sqlite repositories over user_wallets, agent_wallets, session_keys, audit.

pub mod repo;
pub mod schema;

pub use repo::{StoredWallet, WalletStore};
