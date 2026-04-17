//! In-memory / stub implementations of `aeqi-core` traits.
//!
//! Each fake implements the minimum behaviour needed to drive typical test
//! scenarios. Anything beyond "enough to let the code under test run" is a
//! smell — if you need production behaviour, use the production impl.

mod idea_store;

pub use idea_store::InMemoryIdeaStore;
