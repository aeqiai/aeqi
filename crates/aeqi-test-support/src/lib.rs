//! Shared fixtures and builders for AEQI tests.
//!
//! # Why this crate exists
//!
//! Before this crate, every test module reinvented its own helpers — a
//! `test_registry()` here, a `make_tools()` there, plus 30-to-50-line inline
//! `Fake*` trait implementations duplicated across files. The boilerplate
//! cost of writing a new test was high enough that tests either didn't get
//! written or became over-specific to whatever the author had lying around.
//!
//! # What belongs here
//!
//! - **Builders** for domain types (`Idea`, `Agent`, ...) — fluent, ergonomic,
//!   match production type shapes exactly.
//! - **Fakes** — lightweight, in-memory implementations of `aeqi-core` traits
//!   (`IdeaStore`, ...). Enough behaviour to drive the code under test; no
//!   more. If you need real behaviour, use the real implementation.
//!
//! # What does NOT belong here
//!
//! - Test-specific DSLs or mini-frameworks. Build on existing domain types.
//! - Assertions / matchers. Use `assert_eq!` like everyone else.
//! - Anything that depends on a specific crate's internals — that belongs in
//!   that crate's `#[cfg(test)] mod tests` helpers.
//!
//! # Usage
//!
//! Add as a dev-dependency in any crate's `Cargo.toml`:
//!
//! ```toml
//! [dev-dependencies]
//! aeqi-test-support = { workspace = true }
//! ```

pub mod builders;
pub mod fakes;

// Re-export the most common names so tests can `use aeqi_test_support::*;`.
pub use builders::{AgentBuilder, IdeaBuilder};
pub use fakes::InMemoryIdeaStore;
