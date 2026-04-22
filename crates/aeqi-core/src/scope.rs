//! Visibility scope enum shared across all four primitives.
//!
//! An anchor agent A and scope S together determine which viewer agents X
//! can see a given row. Visibility rules:
//!
//! - `self`     — X == A  OR  X is an ancestor of A
//! - `siblings` — self-rule  OR  X is a sibling of A (same parent_id)
//! - `children` — self-rule  OR  A is an ancestor of X (X is in A's subtree)
//! - `branch`   — siblings-rule  OR  children-rule
//! - `global`   — always visible; no anchor required

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// Visibility scope for a primitive row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// Visible only to the anchor agent and its ancestors.
    #[default]
    #[serde(rename = "self")]
    SelfScope,
    /// Visible to self-rule agents plus siblings of the anchor.
    Siblings,
    /// Visible to self-rule agents plus agents in the anchor's subtree.
    Children,
    /// Union of siblings and children rules.
    Branch,
    /// Visible to everyone; `agent_id` is ignored.
    Global,
}

impl Scope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SelfScope => "self",
            Self::Siblings => "siblings",
            Self::Children => "children",
            Self::Branch => "branch",
            Self::Global => "global",
        }
    }
}

impl fmt::Display for Scope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Scope {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "self" => Ok(Self::SelfScope),
            "siblings" => Ok(Self::Siblings),
            "children" => Ok(Self::Children),
            "branch" => Ok(Self::Branch),
            "global" => Ok(Self::Global),
            other => anyhow::bail!("unknown scope: {other:?}"),
        }
    }
}
