//! User-writable markdown hook surface for the AEQI agent runtime.
//!
//! Users drop `.md` files into `.aeqi/hooks/` at the project root.
//! Each file has YAML frontmatter that declares when and how to fire:
//!
//! ```text
//! ---
//! on: PreToolUse
//! tool: shell
//! action: block
//! message: "Direct shell access is disabled in this project."
//! ---
//!
//! This rule blocks all direct shell tool calls.
//! ```
//!
//! Supported frontmatter fields:
//! - `on`: `PreToolUse` | `PostToolUse` (required)
//! - `tool`: tool name to match (optional — omit to match all tools)
//! - `agent`: agent id to match (optional — omit to match all agents)
//! - `action`: `block` | `warn` | `allow` (required)
//! - `message`: text returned/logged when the rule fires (optional)

use crate::frontmatter::load_frontmatter;
use crate::traits::{LoopAction, Observer};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tracing::{debug, warn};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Which lifecycle event a hook fires on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookTrigger {
    PreToolUse,
    PostToolUse,
}

/// What to do when a rule matches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookAction {
    /// Return an error to the LLM: "Hook blocked: <message>".
    Block,
    /// Log + inject a warning into the agent's next message.
    Warn,
    /// No-op — explicit allow overriding earlier rules.
    Allow,
}

/// A single loaded hook rule.
#[derive(Debug, Clone)]
pub struct HookRule {
    /// Lifecycle event that triggers this rule.
    pub trigger: HookTrigger,
    /// Optional tool name filter (case-insensitive). `None` = match all.
    pub tool_match: Option<String>,
    /// Optional agent id filter (exact). `None` = match all agents.
    pub agent_match: Option<String>,
    /// Action to take when the rule fires.
    pub action: HookAction,
    /// Message displayed on warn/block. May be empty.
    pub message: String,
    /// Absolute path of the source markdown file (for diagnostics).
    pub source_path: PathBuf,
}

// ---------------------------------------------------------------------------
// Frontmatter deserialization
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct HookMeta {
    on: String,
    tool: Option<String>,
    agent: Option<String>,
    action: String,
    #[serde(default)]
    message: String,
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/// Read all `*.md` files from `dir` and parse them as hook rules.
///
/// Files that are missing frontmatter, have unknown `on:` values, or have
/// unknown `action:` values are skipped with a warning — they do not abort
/// the load.
///
/// This function is synchronous. Call it inside `tokio::task::spawn_blocking`
/// from async contexts.
pub fn load_hooks_from_dir(dir: &Path) -> Vec<HookRule> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            debug!(path = %dir.display(), error = %e, "hooks dir not found or unreadable — no hooks loaded");
            return Vec::new();
        }
    };

    let mut rules = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                warn!(path = %path.display(), error = %e, "failed to read hook file");
                continue;
            }
        };

        match parse_hook_file(&content, &path) {
            Ok(rule) => {
                debug!(
                    path = %path.display(),
                    trigger = ?rule.trigger,
                    action = ?rule.action,
                    "loaded hook rule"
                );
                rules.push(rule);
            }
            Err(e) => {
                warn!(path = %path.display(), error = %e, "skipping invalid hook file");
            }
        }
    }

    rules
}

fn parse_hook_file(content: &str, path: &Path) -> anyhow::Result<HookRule> {
    let (meta, _body): (HookMeta, String) = load_frontmatter(content)?;

    let trigger = match meta.on.as_str() {
        "PreToolUse" => HookTrigger::PreToolUse,
        "PostToolUse" => HookTrigger::PostToolUse,
        other => {
            anyhow::bail!("unknown `on` value: {other:?} (expected PreToolUse or PostToolUse)")
        }
    };

    let action = match meta.action.as_str() {
        "block" => HookAction::Block,
        "warn" => HookAction::Warn,
        "allow" => HookAction::Allow,
        other => {
            anyhow::bail!("unknown `action` value: {other:?} (expected block, warn, or allow)")
        }
    };

    Ok(HookRule {
        trigger,
        tool_match: meta.tool,
        agent_match: meta.agent,
        action,
        message: meta.message,
        source_path: path.to_path_buf(),
    })
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/// Return all rules that match the given event, tool name, and agent id.
pub fn match_hooks<'a>(
    rules: &'a [HookRule],
    trigger: &HookTrigger,
    tool_name: &str,
    agent_id: Option<&str>,
) -> Vec<&'a HookRule> {
    rules
        .iter()
        .filter(|r| {
            // Trigger must match.
            if &r.trigger != trigger {
                return false;
            }
            // Tool filter: if set, must match case-insensitively.
            if let Some(ref t) = r.tool_match
                && !t.eq_ignore_ascii_case(tool_name)
            {
                return false;
            }
            // Agent filter: if set, must match the provided agent_id exactly.
            if let Some(ref a) = r.agent_match {
                match agent_id {
                    Some(id) if a == id => {}
                    _ => return false,
                }
            }
            true
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Rule application
// ---------------------------------------------------------------------------

/// Apply the first matching rule from `matched` and return the corresponding
/// [`LoopAction`]. Rules are evaluated in order; the first non-Allow rule wins.
///
/// `post` distinguishes warning messages (pre-use vs post-use wording).
fn apply_hook_rules(matched: Vec<&HookRule>, tool_name: &str, post: bool) -> LoopAction {
    matched
        .into_iter()
        .map(|rule| match rule.action {
            HookAction::Block => {
                let reason = if rule.message.is_empty() {
                    format!("blocked by hook rule ({})", rule.source_path.display())
                } else {
                    rule.message.clone()
                };
                warn!(tool = %tool_name, rule = %rule.source_path.display(), "hook blocked tool call");
                LoopAction::Halt(format!("Hook blocked: {reason}"))
            }
            HookAction::Warn => {
                let label = if post { "post-use" } else { "pre-use" };
                let msg = if rule.message.is_empty() {
                    format!(
                        "[hook warning] Tool `{tool_name}` {label} matched rule in {}",
                        rule.source_path.display()
                    )
                } else {
                    format!("[hook warning] {}", rule.message)
                };
                warn!(tool = %tool_name, rule = %rule.source_path.display(), "hook warned on tool call");
                LoopAction::Inject(vec![msg])
            }
            HookAction::Allow => LoopAction::Continue,
        })
        .next()
        .unwrap_or(LoopAction::Continue)
}

// ---------------------------------------------------------------------------
// Observer
// ---------------------------------------------------------------------------

/// An [`Observer`] that fires loaded hook rules at PreToolUse / PostToolUse.
///
/// Construct with [`HooksObserver::load`] (async, uses `spawn_blocking`) or
/// [`HooksObserver::from_rules`] (synchronous, for tests).
pub struct HooksObserver {
    rules: Vec<HookRule>,
    agent_id: Option<String>,
}

impl HooksObserver {
    /// Load hook rules from `<project_dir>/.aeqi/hooks/*.md` asynchronously.
    ///
    /// Returns an observer with zero rules if the directory does not exist.
    pub async fn load(project_dir: &Path, agent_id: Option<String>) -> Self {
        let hooks_dir = project_dir.join(".aeqi").join("hooks");
        let dir = hooks_dir.clone();
        let rules = tokio::task::spawn_blocking(move || load_hooks_from_dir(&dir))
            .await
            .unwrap_or_default();
        debug!(
            dir = %hooks_dir.display(),
            count = rules.len(),
            "hooks observer initialized"
        );
        Self { rules, agent_id }
    }

    /// Construct directly from a set of rules (used in tests).
    pub fn from_rules(rules: Vec<HookRule>, agent_id: Option<String>) -> Self {
        Self { rules, agent_id }
    }

    fn agent_id_ref(&self) -> Option<&str> {
        self.agent_id.as_deref()
    }
}

#[async_trait]
impl Observer for HooksObserver {
    fn name(&self) -> &str {
        "hooks"
    }

    async fn record(&self, _event: crate::traits::Event) {}

    async fn before_tool(&self, tool_name: &str, _input: &Value) -> LoopAction {
        let matched = match_hooks(
            &self.rules,
            &HookTrigger::PreToolUse,
            tool_name,
            self.agent_id_ref(),
        );
        apply_hook_rules(matched, tool_name, false)
    }

    async fn after_tool(&self, tool_name: &str, _output: &str, _is_error: bool) -> LoopAction {
        let matched = match_hooks(
            &self.rules,
            &HookTrigger::PostToolUse,
            tool_name,
            self.agent_id_ref(),
        );
        apply_hook_rules(matched, tool_name, true)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rule(trigger: HookTrigger, tool: Option<&str>, action: HookAction) -> HookRule {
        HookRule {
            trigger,
            tool_match: tool.map(|s| s.to_string()),
            agent_match: None,
            action,
            message: "test message".to_string(),
            source_path: PathBuf::from("test.md"),
        }
    }

    // --- Parsing tests ---

    #[test]
    fn test_parse_block_rule() {
        let content = r#"---
on: PreToolUse
tool: shell
action: block
message: "No shell in this project."
---

Rule body."#;
        let rule = parse_hook_file(content, Path::new("deny-shell.md")).unwrap();
        assert_eq!(rule.trigger, HookTrigger::PreToolUse);
        assert_eq!(rule.tool_match.as_deref(), Some("shell"));
        assert_eq!(rule.action, HookAction::Block);
        assert_eq!(rule.message, "No shell in this project.");
    }

    #[test]
    fn test_parse_warn_no_tool_filter() {
        let content = r#"---
on: PostToolUse
action: warn
message: "Post-use warning."
---"#;
        let rule = parse_hook_file(content, Path::new("warn-all.md")).unwrap();
        assert_eq!(rule.trigger, HookTrigger::PostToolUse);
        assert!(rule.tool_match.is_none());
        assert_eq!(rule.action, HookAction::Warn);
    }

    #[test]
    fn test_parse_unknown_trigger_returns_error() {
        let content = r#"---
on: Unknown
action: warn
---"#;
        assert!(parse_hook_file(content, Path::new("x.md")).is_err());
    }

    #[test]
    fn test_parse_unknown_action_returns_error() {
        let content = r#"---
on: PreToolUse
action: maybe
---"#;
        assert!(parse_hook_file(content, Path::new("x.md")).is_err());
    }

    // --- Matching tests ---

    #[test]
    fn test_match_by_trigger() {
        let rules = vec![
            make_rule(HookTrigger::PreToolUse, None, HookAction::Warn),
            make_rule(HookTrigger::PostToolUse, None, HookAction::Warn),
        ];
        let pre = match_hooks(&rules, &HookTrigger::PreToolUse, "shell", None);
        assert_eq!(pre.len(), 1);
        assert_eq!(pre[0].trigger, HookTrigger::PreToolUse);
    }

    #[test]
    fn test_match_by_tool_name_case_insensitive() {
        let rules = vec![make_rule(
            HookTrigger::PreToolUse,
            Some("Shell"),
            HookAction::Block,
        )];
        assert_eq!(
            match_hooks(&rules, &HookTrigger::PreToolUse, "shell", None).len(),
            1
        );
        assert_eq!(
            match_hooks(&rules, &HookTrigger::PreToolUse, "SHELL", None).len(),
            1
        );
        assert_eq!(
            match_hooks(&rules, &HookTrigger::PreToolUse, "read", None).len(),
            0
        );
    }

    #[test]
    fn test_no_match_for_wrong_agent() {
        let mut rule = make_rule(HookTrigger::PreToolUse, None, HookAction::Block);
        rule.agent_match = Some("agent-abc".to_string());
        let rules = vec![rule];
        // Wrong agent: no match.
        assert_eq!(
            match_hooks(&rules, &HookTrigger::PreToolUse, "shell", Some("agent-xyz")).len(),
            0
        );
        // Right agent: match.
        assert_eq!(
            match_hooks(&rules, &HookTrigger::PreToolUse, "shell", Some("agent-abc")).len(),
            1
        );
    }

    // --- Observer behaviour tests ---

    #[tokio::test]
    async fn test_pre_hook_block_returns_halt() {
        let obs = HooksObserver::from_rules(
            vec![make_rule(
                HookTrigger::PreToolUse,
                Some("shell"),
                HookAction::Block,
            )],
            None,
        );
        let action = obs.before_tool("shell", &serde_json::json!({})).await;
        assert!(matches!(action, LoopAction::Halt(_)));
    }

    #[tokio::test]
    async fn test_pre_hook_warn_returns_inject() {
        let obs = HooksObserver::from_rules(
            vec![make_rule(
                HookTrigger::PreToolUse,
                Some("read"),
                HookAction::Warn,
            )],
            None,
        );
        let action = obs.before_tool("read", &serde_json::json!({})).await;
        assert!(matches!(action, LoopAction::Inject(_)));
    }

    #[tokio::test]
    async fn test_post_hook_warn_returns_inject() {
        let obs = HooksObserver::from_rules(
            vec![make_rule(
                HookTrigger::PostToolUse,
                Some("write"),
                HookAction::Warn,
            )],
            None,
        );
        let action = obs.after_tool("write", "ok", false).await;
        assert!(matches!(action, LoopAction::Inject(_)));
    }

    #[tokio::test]
    async fn test_no_matching_rule_returns_continue() {
        let obs = HooksObserver::from_rules(
            vec![make_rule(
                HookTrigger::PreToolUse,
                Some("shell"),
                HookAction::Block,
            )],
            None,
        );
        // Different tool — no match.
        let action = obs.before_tool("read", &serde_json::json!({})).await;
        assert!(matches!(action, LoopAction::Continue));
    }

    #[tokio::test]
    async fn test_load_hooks_from_dir_with_tempdir() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let hooks_dir = dir.path().join(".aeqi").join("hooks");
        std::fs::create_dir_all(&hooks_dir).unwrap();

        let hook_content = r#"---
on: PreToolUse
tool: shell
action: block
message: "test block"
---
"#;
        let mut f = std::fs::File::create(hooks_dir.join("deny.md")).unwrap();
        f.write_all(hook_content.as_bytes()).unwrap();

        let obs = HooksObserver::load(dir.path(), None).await;
        let action = obs.before_tool("shell", &serde_json::json!({})).await;
        assert!(matches!(action, LoopAction::Halt(_)));
    }
}
