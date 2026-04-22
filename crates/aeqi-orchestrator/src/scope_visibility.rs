//! Scope-based visibility helpers.
//!
//! Given a viewer agent and a `Scope`, computes which anchor agent IDs the
//! viewer can see, and builds the SQL WHERE fragment for filtering primitive rows.
//!
//! # Visibility rules
//!
//! For anchor agent A and viewer X:
//!
//! - `self`     — X == A  OR  X is an ancestor of A
//! - `siblings` — self-rule  OR  X is a sibling of A (same parent_id)
//! - `children` — self-rule  OR  A is an ancestor of X (X is in A's subtree)
//! - `branch`   — siblings-rule  OR  children-rule
//! - `global`   — always visible; no anchor check required

use aeqi_core::Scope;
use anyhow::Result;

use crate::agent_registry::AgentRegistry;

/// Returns the set of anchor agent IDs visible to `viewer_agent_id` under `scope`.
///
/// Interpretation: a row with anchor `agent_id = A` and `scope = S` is visible
/// to the viewer if A is in the returned set.
pub async fn visible_agent_ids(
    registry: &AgentRegistry,
    viewer_agent_id: &str,
    scope: Scope,
) -> Result<Vec<String>> {
    match scope {
        Scope::Global => {
            // Global rows have no anchor restriction — any agent_id qualifies.
            // Return an empty sentinel; callers check scope=global separately.
            Ok(Vec::new())
        }
        Scope::SelfScope => {
            // Viewer sees rows anchored at itself OR any of its ancestors.
            let ancestor_ids = registry.get_ancestor_ids(viewer_agent_id).await?;
            Ok(ancestor_ids)
        }
        Scope::Siblings => {
            // Self-rule UNION siblings of the anchor.
            // From the viewer's perspective: a row with anchor A and
            // scope=siblings is visible when X can see it under self-rule
            // (X in ancestors of A) OR X is a sibling of A.
            //
            // Equivalently, anchor A is visible when:
            //   - A is the viewer or an ancestor of the viewer (self-rule applies), OR
            //   - A is a sibling of the viewer (viewer is also a sibling of A when
            //     they share the same parent).
            //
            // So the set is: ancestors(viewer) ∪ siblings(viewer).
            let mut ids = registry.get_ancestor_ids(viewer_agent_id).await?;
            let siblings = registry.list_siblings(viewer_agent_id).await?;
            for s in siblings {
                if !ids.contains(&s) {
                    ids.push(s);
                }
            }
            Ok(ids)
        }
        Scope::Children => {
            // Self-rule UNION descendants of the anchor.
            // A row with anchor A and scope=children is visible to X when
            // X is self/ancestor (self-rule), OR A is an ancestor of X.
            //
            // Anchors visible under children-rule = ancestors(viewer) ∪ ancestors(viewer).
            // Actually: anchor A is visible when A ∈ ancestors(viewer).
            // That is the self-rule set — self-rule already gives us ancestors.
            // The extra leg is: A is an ancestor of X → X is a descendant of A.
            //
            // So the set of anchors the viewer can see under children-rule is:
            //   ancestors(viewer)   — covers self-rule (A==viewer OR A is above viewer)
            // There is no additional set: the children leg means the ROW's scope
            // grants visibility to descendants of A, i.e. viewer being a descendant
            // of A is the condition. ancestor_ids covers exactly that.
            let ids = registry.get_ancestor_ids(viewer_agent_id).await?;
            Ok(ids)
        }
        Scope::Branch => {
            // Union of siblings-rule and children-rule.
            // branch-rule anchors = ancestors(viewer) ∪ siblings(viewer).
            let mut ids = registry.get_ancestor_ids(viewer_agent_id).await?;
            let siblings = registry.list_siblings(viewer_agent_id).await?;
            for s in siblings {
                if !ids.contains(&s) {
                    ids.push(s);
                }
            }
            Ok(ids)
        }
    }
}

/// Builds a SQL WHERE clause fragment that filters primitive rows to those
/// visible to `viewer_agent_id`, across all scope levels in a single pass.
///
/// Returns `(clause, bind_params)` where `clause` uses `?` placeholders and
/// `bind_params` is the ordered list of values to bind.
///
/// The clause assumes the row has columns `scope TEXT` and `agent_id TEXT`.
///
/// Example output:
/// ```sql
/// (scope='global'
///  OR (scope='self' AND agent_id IN (?,?,...))
///  OR (scope='siblings' AND agent_id IN (?,?,...))
///  OR (scope='children' AND agent_id IN (?,?,...))
///  OR (scope='branch' AND agent_id IN (?,?,...)))
/// ```
pub async fn visibility_sql_clause(
    registry: &AgentRegistry,
    viewer_agent_id: &str,
) -> Result<(String, Vec<String>)> {
    // Compute per-scope anchor sets.
    let ancestor_ids = registry.get_ancestor_ids(viewer_agent_id).await?;
    let sibling_ids = registry.list_siblings(viewer_agent_id).await?;

    // self: anchors = ancestors (includes viewer itself)
    let self_anchors = ancestor_ids.clone();

    // siblings: ancestors ∪ siblings
    let mut siblings_anchors = ancestor_ids.clone();
    for s in &sibling_ids {
        if !siblings_anchors.contains(s) {
            siblings_anchors.push(s.clone());
        }
    }

    // children: ancestors (viewer must be a descendant of anchor, i.e. anchor is an ancestor)
    let children_anchors = ancestor_ids.clone();

    // branch: ancestors ∪ siblings (same as siblings set)
    let branch_anchors = siblings_anchors.clone();

    let mut clause_parts: Vec<String> = vec!["scope='global'".to_string()];
    let mut bind_params: Vec<String> = Vec::new();

    fn build_in_clause(
        scope_name: &str,
        anchors: &[String],
        clause_parts: &mut Vec<String>,
        bind_params: &mut Vec<String>,
    ) {
        if anchors.is_empty() {
            // No anchors → nothing is visible at this scope level.
            return;
        }
        let placeholders = std::iter::repeat_n("?", anchors.len())
            .collect::<Vec<_>>()
            .join(",");
        clause_parts.push(format!(
            "(scope='{scope_name}' AND agent_id IN ({placeholders}))"
        ));
        bind_params.extend_from_slice(anchors);
    }

    build_in_clause("self", &self_anchors, &mut clause_parts, &mut bind_params);
    build_in_clause(
        "siblings",
        &siblings_anchors,
        &mut clause_parts,
        &mut bind_params,
    );
    build_in_clause(
        "children",
        &children_anchors,
        &mut clause_parts,
        &mut bind_params,
    );
    build_in_clause(
        "branch",
        &branch_anchors,
        &mut clause_parts,
        &mut bind_params,
    );

    let clause = format!("({})", clause_parts.join(" OR "));
    Ok((clause, bind_params))
}
