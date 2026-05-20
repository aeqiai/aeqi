//! Library surface for the indexer.
//!
//! The crate ships primarily as a binary (`aeqi-indexer`), but auxiliary
//! bins under `src/bin/` need to call into the indexer's internals
//! (e.g. `Sink::replay_unifutures_curves` for the ja-017 backfill).
//! Cargo binary crates cannot re-export modules across bins, so the
//! modules live here and both `main.rs` and the auxiliary bins import
//! them through `aeqi_indexer::*`.
//!
//! `main.rs` is intentionally a thin shim that wires the lib's `run`
//! entry point to the process. Cross-module references inside the
//! crate use `crate::*` because we're now operating from the library
//! root.

pub mod backfill;
pub mod events;
pub mod manifest;
pub mod registry;
pub mod sink;
pub mod snapshot;
