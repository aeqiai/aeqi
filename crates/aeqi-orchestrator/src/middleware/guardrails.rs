//! Guardrails Middleware — tiered permission system for tool calls.
//!
//! Three tiers:
//! - **Allow**: Known-safe patterns that always pass (read-only tools, safe commands).
//! - **Deny**: Dangerous patterns that always halt (destructive commands, data loss).
//! - **Ask**: Everything else — passes in autonomous mode, injects a caution warning
//!   in supervised mode to let the model self-review before proceeding.
//!
//! The existing deny list is preserved as the deny tier. The allow list covers
//! read-only tools and safe command patterns. The ask tier is the default for
//! unmatched calls.

use aeqi_core::detector::{DetectedPattern, DetectionContext, PatternDetector};
use async_trait::async_trait;
use tracing::{debug, warn};

use super::{Middleware, MiddlewareAction, ORDER_GUARDRAILS, ToolCall, WorkerContext};

/// Permission tier for a tool call.
#[derive(Debug, Clone, PartialEq)]
pub enum PermissionTier {
    /// Always allowed — no checks needed.
    Allow,
    /// Requires review in supervised mode, auto-allowed in autonomous mode.
    Ask,
    /// Always blocked.
    Deny(String),
}

/// A pattern that matches tool calls.
#[derive(Debug, Clone)]
pub struct ToolPattern {
    /// The string pattern to search for (case-insensitive substring match).
    pub pattern: String,
    /// Human-readable reason for the classification.
    pub reason: String,
    /// Which tier this pattern belongs to.
    pub tier: PermissionTier,
}

impl ToolPattern {
    pub fn deny(pattern: impl Into<String>, reason: impl Into<String>) -> Self {
        let reason_str: String = reason.into();
        Self {
            pattern: pattern.into().to_lowercase(),
            reason: reason_str.clone(),
            tier: PermissionTier::Deny(reason_str),
        }
    }

    pub fn allow(pattern: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into().to_lowercase(),
            reason: reason.into(),
            tier: PermissionTier::Allow,
        }
    }
}

/// Backwards-compatible type alias.
pub type DenyPattern = ToolPattern;

impl DenyPattern {
    pub fn new(pattern: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::deny(pattern, reason)
    }
}

/// Execution mode that determines how "ask" tier calls are handled.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExecutionMode {
    /// Agent runs autonomously — ask-tier calls pass silently.
    Autonomous,
    /// Agent is supervised — ask-tier calls inject a caution message.
    Supervised,
}

/// Guardrails middleware with tiered permissions.
pub struct GuardrailsMiddleware {
    patterns: Vec<ToolPattern>,
    mode: ExecutionMode,
}

impl GuardrailsMiddleware {
    /// Create with explicit patterns and mode.
    pub fn new(deny_patterns: Vec<DenyPattern>) -> Self {
        Self {
            patterns: deny_patterns,
            mode: ExecutionMode::Autonomous,
        }
    }

    /// Create with tiered patterns and mode.
    pub fn tiered(patterns: Vec<ToolPattern>, mode: ExecutionMode) -> Self {
        Self { patterns, mode }
    }

    /// Create with a sensible set of default patterns (all tiers).
    pub fn with_defaults() -> Self {
        let mut patterns = Self::default_deny_patterns();
        patterns.extend(Self::default_allow_patterns());
        Self {
            patterns,
            mode: ExecutionMode::Autonomous,
        }
    }

    /// Create with defaults in the specified mode.
    pub fn with_defaults_mode(mode: ExecutionMode) -> Self {
        let mut patterns = Self::default_deny_patterns();
        patterns.extend(Self::default_allow_patterns());
        Self { patterns, mode }
    }

    fn default_deny_patterns() -> Vec<ToolPattern> {
        vec![
            ToolPattern::deny("rm -rf /", "Recursive deletion of root filesystem"),
            ToolPattern::deny("rm -rf ~", "Recursive deletion of home directory"),
            ToolPattern::deny("rm -rf *", "Wildcard recursive deletion"),
            ToolPattern::deny(
                "git push --force",
                "Force push — use --force-with-lease if necessary",
            ),
            ToolPattern::deny(
                "git push -f",
                "Force push — use --force-with-lease if necessary",
            ),
            ToolPattern::deny("DROP TABLE", "SQL DROP TABLE"),
            ToolPattern::deny("DROP DATABASE", "SQL DROP DATABASE"),
            ToolPattern::deny("TRUNCATE TABLE", "SQL TRUNCATE TABLE"),
            ToolPattern::deny(":(){ :|:& };:", "Fork bomb"),
            ToolPattern::deny("mkfs.", "Filesystem formatting"),
            ToolPattern::deny("dd if=/dev/zero", "Disk overwrite with dd"),
            ToolPattern::deny("> /dev/sda", "Direct disk device write"),
            ToolPattern::deny("chmod -R 777", "Recursive world-writable permissions"),
        ]
    }

    fn default_allow_patterns() -> Vec<ToolPattern> {
        vec![
            // Read-only tools are always safe.
            ToolPattern::allow("Read", "Read-only file access"),
            ToolPattern::allow("Glob", "File pattern matching"),
            ToolPattern::allow("Grep", "Content search"),
            ToolPattern::allow("ideas", "Memory search"),
            ToolPattern::allow("code", "Code graph query"),
            ToolPattern::allow("aeqi_status", "Status check"),
            ToolPattern::allow("aeqi_prompts", "Prompt loading"),
            // Safe git commands.
            ToolPattern::allow("git status", "Git status check"),
            ToolPattern::allow("git log", "Git log view"),
            ToolPattern::allow("git diff", "Git diff view"),
            ToolPattern::allow("git branch", "Git branch list"),
            ToolPattern::allow("cargo test", "Test execution"),
            ToolPattern::allow("cargo check", "Compilation check"),
            ToolPattern::allow("cargo clippy", "Lint check"),
        ]
    }

    /// Classify a tool call into a permission tier.
    fn classify(&self, call: &ToolCall) -> PermissionTier {
        let name_lower = call.name.to_lowercase();
        let input_lower = call.input.to_lowercase();
        let combined = format!("{name_lower} {input_lower}");

        // Check deny patterns first (highest priority).
        for p in &self.patterns {
            if matches!(p.tier, PermissionTier::Deny(_)) && combined.contains(&p.pattern) {
                return p.tier.clone();
            }
        }

        // Check allow patterns.
        for p in &self.patterns {
            if p.tier == PermissionTier::Allow && combined.contains(&p.pattern) {
                return PermissionTier::Allow;
            }
        }

        // Default: ask tier.
        PermissionTier::Ask
    }
}

#[async_trait]
impl Middleware for GuardrailsMiddleware {
    fn name(&self) -> &str {
        "guardrails"
    }

    fn order(&self) -> u32 {
        ORDER_GUARDRAILS
    }

    async fn before_tool(&self, ctx: &mut WorkerContext, call: &ToolCall) -> MiddlewareAction {
        match self.classify(call) {
            PermissionTier::Allow => {
                debug!(tool = %call.name, "guardrails: allowed");
                MiddlewareAction::Continue
            }
            PermissionTier::Ask => match self.mode {
                ExecutionMode::Autonomous => {
                    debug!(tool = %call.name, "guardrails: ask tier, autonomous mode — passing");
                    MiddlewareAction::Continue
                }
                ExecutionMode::Supervised => {
                    debug!(
                        tool = %call.name,
                        "guardrails: ask tier, supervised mode — firing guardrail:violation pattern"
                    );
                    // Detector fires pattern; event system or default handler authors content.
                    if let Some(ref registry) = ctx.registry {
                        let ectx = ctx.as_execution_context();
                        let trigger_args = serde_json::json!({
                            "tool_name": call.name,
                            "rule": "not on the allow list",
                        });
                        let reg = std::sync::Arc::clone(registry);
                        tokio::spawn(async move {
                            if let Err(e) = reg
                                .invoke_pattern("guardrail:violation", &ectx, &trigger_args)
                                .await
                            {
                                tracing::warn!(error = %e, "guardrails: invoke_pattern failed");
                            }
                        });
                    } else {
                        tracing::warn!(
                            tool = %call.name,
                            "[Guardrails] Tool '{}' is not on the allow list. \
                             Verify this action is safe before proceeding.",
                            call.name
                        );
                    }
                    MiddlewareAction::Continue
                }
            },
            PermissionTier::Deny(reason) => {
                warn!(
                    tool = %call.name,
                    reason = %reason,
                    "guardrails blocked dangerous tool call"
                );
                MiddlewareAction::Halt(format!(
                    "Guardrails blocked: tool '{}' matched deny pattern. Reason: {}",
                    call.name, reason
                ))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// PatternDetector impl
// ---------------------------------------------------------------------------

#[async_trait]
impl PatternDetector for GuardrailsMiddleware {
    fn name(&self) -> &'static str {
        "guardrails"
    }

    /// Detect guardrail violations on a tool call.
    ///
    /// - Deny-tier calls are not handled here (those halt via `Middleware::before_tool`).
    /// - Ask-tier calls in Supervised mode fire `guardrail:violation`.
    /// - Returns nothing when `latest_tool_call` is absent (step boundary).
    async fn detect(&self, ctx: &DetectionContext<'_>) -> Vec<DetectedPattern> {
        let call = match ctx.latest_tool_call {
            Some(c) => c,
            None => return vec![],
        };

        let tc = ToolCall {
            name: call.name.clone(),
            input: call.input.clone(),
        };
        if self.mode == ExecutionMode::Supervised && self.classify(&tc) == PermissionTier::Ask {
            return vec![DetectedPattern {
                pattern: "guardrail:violation".to_string(),
                args: serde_json::json!({
                    "tool_name": call.name,
                    "rule": "not on the allow list",
                }),
            }];
        }

        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::middleware::test_helpers::test_ctx;
    use aeqi_core::detector::ToolCallRecord;

    #[tokio::test]
    async fn safe_command_passes() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "cargo test --workspace".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn rm_rf_root_blocked() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "rm -rf /".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(
            matches!(action, MiddlewareAction::Halt(ref s) if s.contains("Recursive deletion")),
            "expected Halt for rm -rf /, got {action:?}"
        );
    }

    #[tokio::test]
    async fn force_push_blocked() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "git push --force origin main".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(
            matches!(action, MiddlewareAction::Halt(ref s) if s.contains("Force push")),
            "expected Halt for force push, got {action:?}"
        );
    }

    #[tokio::test]
    async fn force_push_short_flag_blocked() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "git push -f origin main".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Halt(_)));
    }

    #[tokio::test]
    async fn drop_table_blocked() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "sqlite3 db.sqlite 'DROP TABLE users;'".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(
            matches!(action, MiddlewareAction::Halt(ref s) if s.contains("DROP TABLE")),
            "expected Halt for DROP TABLE, got {action:?}"
        );
    }

    #[tokio::test]
    async fn case_insensitive_matching() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "drop table users".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Halt(_)));
    }

    #[tokio::test]
    async fn custom_deny_patterns() {
        let mw = GuardrailsMiddleware::new(vec![DenyPattern::new(
            "sudo reboot",
            "Rebooting is not allowed",
        )]);
        let mut ctx = test_ctx();

        // Blocked.
        let call = ToolCall {
            name: "Bash".into(),
            input: "sudo reboot now".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Halt(_)));

        // Not blocked (different command).
        let call = ToolCall {
            name: "Bash".into(),
            input: "sudo apt update".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn read_tool_passes() {
        let mw = GuardrailsMiddleware::with_defaults();
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Read".into(),
            input: "/etc/passwd".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn empty_deny_list_passes_all() {
        let mw = GuardrailsMiddleware::new(vec![]);
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Bash".into(),
            input: "rm -rf /".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    // --- New tiered permission tests ---

    #[tokio::test]
    async fn read_tool_is_allow_tier() {
        let mw = GuardrailsMiddleware::with_defaults();
        let call = ToolCall {
            name: "Read".into(),
            input: "/some/file".into(),
        };
        assert_eq!(mw.classify(&call), PermissionTier::Allow);
    }

    #[tokio::test]
    async fn glob_tool_is_allow_tier() {
        let mw = GuardrailsMiddleware::with_defaults();
        let call = ToolCall {
            name: "Glob".into(),
            input: "**/*.rs".into(),
        };
        assert_eq!(mw.classify(&call), PermissionTier::Allow);
    }

    #[tokio::test]
    async fn unknown_tool_is_ask_tier() {
        let mw = GuardrailsMiddleware::with_defaults();
        let call = ToolCall {
            name: "Write".into(),
            input: "some content".into(),
        };
        assert_eq!(mw.classify(&call), PermissionTier::Ask);
    }

    #[tokio::test]
    async fn ask_tier_passes_in_autonomous_mode() {
        let mw = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Autonomous);
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Write".into(),
            input: "some content".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn ask_tier_fires_pattern_and_continues_in_supervised_mode() {
        let mw = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Supervised);
        let mut ctx = test_ctx();

        let call = ToolCall {
            name: "Write".into(),
            input: "some content".into(),
        };
        let action = mw.before_tool(&mut ctx, &call).await;
        // Detector fires pattern (no registry wired in test_ctx) and returns Continue.
        assert!(
            matches!(action, MiddlewareAction::Continue),
            "expected Continue (pattern fired), got {action:?}"
        );
    }

    #[tokio::test]
    async fn deny_takes_priority_over_allow() {
        // git status is allowed, but git push --force is denied
        let mw = GuardrailsMiddleware::with_defaults();

        let safe_call = ToolCall {
            name: "Bash".into(),
            input: "git status".into(),
        };
        assert_eq!(mw.classify(&safe_call), PermissionTier::Allow);

        let dangerous_call = ToolCall {
            name: "Bash".into(),
            input: "git push --force origin main".into(),
        };
        assert!(matches!(
            mw.classify(&dangerous_call),
            PermissionTier::Deny(_)
        ));
    }

    #[tokio::test]
    async fn ideas_is_allow_tier() {
        let mw = GuardrailsMiddleware::with_defaults();
        let call = ToolCall {
            name: "ideas".into(),
            input: "query".into(),
        };
        assert_eq!(mw.classify(&call), PermissionTier::Allow);
    }

    // --- PatternDetector impl tests ---

    fn detect_ctx_with_call<'a>(record: &'a ToolCallRecord) -> DetectionContext<'a> {
        DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "test",
            latest_tool_call: Some(record),
            last_assistant_message: None,
        }
    }

    #[tokio::test]
    async fn detector_no_tool_call_returns_empty() {
        let d = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Supervised);
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "test",
            latest_tool_call: None,
            last_assistant_message: None,
        };
        assert!(d.detect(&ctx).await.is_empty());
    }

    #[tokio::test]
    async fn detector_ask_tier_supervised_fires_pattern() {
        let d = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Supervised);
        let record = ToolCallRecord {
            name: "Write".to_string(),
            input: r#"{"file_path":"foo.txt","content":"hi"}"#.to_string(),
        };
        let ctx = detect_ctx_with_call(&record);
        let patterns = d.detect(&ctx).await;
        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].pattern, "guardrail:violation");
    }

    #[tokio::test]
    async fn detector_ask_tier_autonomous_returns_empty() {
        let d = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Autonomous);
        let record = ToolCallRecord {
            name: "Write".to_string(),
            input: r#"{}"#.to_string(),
        };
        let ctx = detect_ctx_with_call(&record);
        assert!(d.detect(&ctx).await.is_empty());
    }

    #[tokio::test]
    async fn detector_allow_tier_returns_empty() {
        let d = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Supervised);
        let record = ToolCallRecord {
            name: "Read".to_string(),
            input: r#"{"file_path":"/some/file"}"#.to_string(),
        };
        let ctx = detect_ctx_with_call(&record);
        assert!(d.detect(&ctx).await.is_empty());
    }

    #[tokio::test]
    async fn detector_deny_tier_returns_empty() {
        // Deny-tier is handled by Middleware::before_tool (halt), not by detect().
        let d = GuardrailsMiddleware::with_defaults_mode(ExecutionMode::Supervised);
        let record = ToolCallRecord {
            name: "Bash".to_string(),
            input: "rm -rf /".to_string(),
        };
        let ctx = detect_ctx_with_call(&record);
        // Deny tier: not an ask-tier violation, no pattern fired.
        assert!(d.detect(&ctx).await.is_empty());
    }
}
