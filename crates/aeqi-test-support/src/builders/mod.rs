//! Fluent builders for domain types.
//!
//! Each builder mirrors a production type. Defaults are sensible for tests
//! (deterministic ids, fixed timestamps) so test output is reproducible.

mod agent;
mod idea;

pub use agent::AgentBuilder;
pub use idea::IdeaBuilder;
