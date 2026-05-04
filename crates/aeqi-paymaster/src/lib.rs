//! aeqi-paymaster — ERC-4337 paymaster signing service.
//!
//! Approves and signs gas sponsorships for aeqi Entity UserOperations.
//! Runs as a standalone Rust binary beside `aeqi-platform.service`.
//!
//! ## Architecture
//!
//! ```text
//! bundler (silius)
//!     │  POST /paymaster/sponsor
//!     ▼
//! aeqi-paymaster (this service, 127.0.0.1:8460)
//!     ├── policy.rs  — check entity billing + gas budget
//!     ├── signer.rs  — sign approval with hot key (PAYMASTER_PRIVATE_KEY)
//!     └── db.rs      — sqlite gas_budgets ledger (/var/lib/aeqi/paymaster.db)
//! ```
//!
//! ## Configuration
//!
//! | Env var | Required | Description |
//! |---|---|---|
//! | `PAYMASTER_PRIVATE_KEY` | yes | 32-byte hex secp256k1 private key |
//! | `PAYMASTER_DB_PATH` | no | SQLite path (default `/var/lib/aeqi/paymaster.db`) |
//! | `PAYMASTER_BIND` | no | Listen address (default `127.0.0.1:8460`) |
//! | `PAYMASTER_VALID_FOR_SECS` | no | Validity window (default 900 = 15 min) |

pub mod api;
pub mod db;
pub mod error;
pub mod policy;
pub mod signer;
pub mod types;

pub use api::{AppState, router};
pub use error::PaymasterError;
pub use signer::PaymasterSigner;
pub use types::{SponsorResponse, UserOp};
