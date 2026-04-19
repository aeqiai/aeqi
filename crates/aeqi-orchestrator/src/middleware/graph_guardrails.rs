use aeqi_core::detector::{DetectedPattern, DetectionContext, PatternDetector};
use async_trait::async_trait;
use std::path::PathBuf;
use tracing::debug;

use super::{Middleware, MiddlewareAction, ORDER_GRAPH_GUARDRAILS, ToolCall, WorkerContext};

/// Graph-aware guardrails: checks code graph impact before allowing edits.
/// Injects warnings when changes affect symbols with many callers.
pub struct GraphGuardrailsMiddleware {
    graph_dir: PathBuf,
    caller_threshold: usize,
}

impl GraphGuardrailsMiddleware {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            graph_dir: data_dir.join("codegraph"),
            caller_threshold: 10,
        }
    }

    fn check_edit_impact(&self, project: &str, file_path: &str, _input: &str) -> Option<String> {
        let db_path = self.graph_dir.join(format!("{project}.db"));
        if !db_path.exists() {
            return None;
        }

        let store = aeqi_graph::GraphStore::open(&db_path).ok()?;

        // Try to extract what's being changed from the edit input
        // The input contains old_string and new_string — find symbols at those lines
        let nodes = store.nodes_in_file(file_path).ok()?;
        if nodes.is_empty() {
            return None;
        }

        // Check total external callers for this file
        let mut high_impact = Vec::new();
        for node in &nodes {
            if matches!(
                node.label,
                aeqi_graph::NodeLabel::File
                    | aeqi_graph::NodeLabel::Module
                    | aeqi_graph::NodeLabel::Community
                    | aeqi_graph::NodeLabel::Process
            ) {
                continue;
            }

            let incoming = store.incoming_edges(&node.id).ok()?;
            let ext_caller_count = incoming
                .iter()
                .filter(|(e, caller)| {
                    e.edge_type == aeqi_graph::EdgeType::Calls
                        && caller
                            .as_ref()
                            .map(|c| c.file_path != file_path)
                            .unwrap_or(false)
                })
                .count();

            if ext_caller_count >= self.caller_threshold {
                high_impact.push(format!(
                    "{} ({}) has {} external callers",
                    node.name, node.label, ext_caller_count
                ));
            }

            // Also check implementors for traits
            if node.label == aeqi_graph::NodeLabel::Trait {
                let impl_count = incoming
                    .iter()
                    .filter(|(e, _)| e.edge_type == aeqi_graph::EdgeType::Implements)
                    .count();
                if impl_count >= 2 {
                    high_impact.push(format!(
                        "{} (trait) has {} implementations — verify all are updated",
                        node.name, impl_count
                    ));
                }
            }
        }

        if high_impact.is_empty() {
            return None;
        }

        Some(format!(
            "Graph impact warning for {}: {}",
            file_path,
            high_impact.join("; ")
        ))
    }
}

#[async_trait]
impl Middleware for GraphGuardrailsMiddleware {
    fn name(&self) -> &str {
        "graph_guardrails"
    }

    fn order(&self) -> u32 {
        ORDER_GRAPH_GUARDRAILS
    }

    async fn before_tool(&self, ctx: &mut WorkerContext, call: &ToolCall) -> MiddlewareAction {
        // Only check edit/write tools
        if !matches!(call.name.as_str(), "edit_file" | "write_file") {
            return MiddlewareAction::Continue;
        }

        // Extract file path from tool input
        let file_path = match serde_json::from_str::<serde_json::Value>(&call.input) {
            Ok(v) => v
                .get("file_path")
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .to_string(),
            Err(_) => return MiddlewareAction::Continue,
        };

        if file_path.is_empty() {
            return MiddlewareAction::Continue;
        }

        // Derive relative path from the file path
        let rel_path = file_path
            .rsplit_once(&format!("{}/", ctx.project_name))
            .map(|(_, rel)| rel.to_string())
            .unwrap_or(file_path.clone());

        if let Some(warning) = self.check_edit_impact(&ctx.project_name, &rel_path, &call.input) {
            debug!(
                project = %ctx.project_name,
                file = %rel_path,
                "graph guardrails: firing graph_guardrail:high_impact pattern"
            );
            // Detector fires pattern; event system or default handler authors content.
            if let Some(ref registry) = ctx.registry {
                let ectx = ctx.as_execution_context();
                let trigger_args = serde_json::json!({
                    "warning": warning,
                    "file_path": rel_path,
                    "project": ctx.project_name,
                });
                let reg = registry.clone();
                tokio::spawn(async move {
                    if let Err(e) = reg
                        .invoke_pattern("graph_guardrail:high_impact", &ectx, &trigger_args)
                        .await
                    {
                        tracing::warn!(error = %e, "graph_guardrails: invoke_pattern failed");
                    }
                });
            } else {
                tracing::warn!(
                    file = %rel_path,
                    warning = %warning,
                    "graph_guardrail:high_impact (no registry — warning logged only)"
                );
            }
        }

        MiddlewareAction::Continue
    }
}

// ---------------------------------------------------------------------------
// PatternDetector impl
// ---------------------------------------------------------------------------

#[async_trait]
impl PatternDetector for GraphGuardrailsMiddleware {
    fn name(&self) -> &'static str {
        "graph_guardrails"
    }

    /// Detect high-impact code changes via the graph store.
    ///
    /// Returns `graph_guardrail:high_impact` when the edited file has symbols
    /// with many external callers. Returns nothing when `latest_tool_call` is
    /// absent or the tool is not an edit/write operation.
    async fn detect(&self, ctx: &DetectionContext<'_>) -> Vec<DetectedPattern> {
        let call = match ctx.latest_tool_call {
            Some(c) => c,
            None => return vec![],
        };

        if !matches!(call.name.as_str(), "edit_file" | "write_file") {
            return vec![];
        }

        let file_path = match serde_json::from_str::<serde_json::Value>(&call.input) {
            Ok(v) => v
                .get("file_path")
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .to_string(),
            Err(_) => return vec![],
        };

        if file_path.is_empty() {
            return vec![];
        }

        let rel_path = file_path
            .rsplit_once(&format!("{}/", ctx.project_name))
            .map(|(_, rel)| rel.to_string())
            .unwrap_or(file_path.clone());

        if let Some(warning) = self.check_edit_impact(ctx.project_name, &rel_path, &call.input) {
            debug!(
                project = %ctx.project_name,
                file = %rel_path,
                "graph guardrails (detector): graph_guardrail:high_impact"
            );
            return vec![DetectedPattern {
                pattern: "graph_guardrail:high_impact".to_string(),
                args: serde_json::json!({
                    "warning": warning,
                    "file_path": rel_path,
                    "project": ctx.project_name,
                }),
            }];
        }

        vec![]
    }
}
