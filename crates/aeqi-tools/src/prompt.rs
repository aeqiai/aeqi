use aeqi_core::frontmatter;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A prompt file — MD with YAML frontmatter.
///
/// Unified format for all prompts (identities, workflows, knowledge, tools).
/// Frontmatter holds content metadata only. Runtime concerns (model, budget,
/// parallelism) belong on the consumer, not the file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prompt {
    pub name: String,
    pub description: String,
    /// Tags for categorization and filtering (replaces `phase` / `group`).
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub triggers: Vec<String>,
    /// Natural-language description of when to auto-invoke.
    #[serde(default)]
    pub when_to_use: Option<String>,
    /// Named arguments for `$arg` substitution in the body.
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub argument_hint: Option<String>,
    /// Enable `!`backtick`` shell expansion in the body.
    #[serde(default)]
    pub allow_shell: bool,
    /// Allowed tools (empty = all allowed).
    #[serde(default)]
    pub tools: Vec<String>,
    /// Denied tools.
    #[serde(default)]
    pub deny: Vec<String>,
    /// The prompt body (system prompt). Populated from the MD body, not frontmatter.
    #[serde(skip)]
    pub body: String,
    /// Prefix prepended to user messages when invoking this prompt.
    #[serde(default)]
    pub user_prefix: String,
    /// Other prompts to load into the session (composed at session start).
    #[serde(default)]
    pub session_prompts: Vec<String>,
    /// Other prompts to re-read each turn (composed as turn context).
    #[serde(default)]
    pub turn_prompts: Vec<String>,
    /// Path to the source `.md` file on disk.
    #[serde(skip)]
    pub source_path: Option<PathBuf>,
}

impl Prompt {
    /// Load a prompt from an MD file with YAML frontmatter.
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read prompt: {}", path.display()))?;
        let mut prompt_file = Self::parse(&content)
            .with_context(|| format!("failed to parse prompt: {}", path.display()))?;
        if prompt_file.name.is_empty()
            && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
        {
            prompt_file.name = stem.to_string();
        }
        prompt_file.source_path = Some(path.to_path_buf());
        Ok(prompt_file)
    }

    /// Parse an MD string with YAML frontmatter into a Prompt.
    pub fn parse(content: &str) -> Result<Self> {
        let (mut parsed, body): (Self, String) = frontmatter::load_frontmatter(content)?;
        parsed.body = body;
        Ok(parsed)
    }

    /// Discover all prompts (`.md` files) in a directory.
    pub fn discover(dir: &Path) -> Result<Vec<Self>> {
        let mut prompts = Vec::new();
        if !dir.exists() {
            return Ok(prompts);
        }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "md") {
                match Self::load(&path) {
                    Ok(p) => prompts.push(p),
                    Err(e) => {
                        tracing::warn!(path = %path.display(), error = %e, "skipping invalid prompt");
                    }
                }
            }
        }
        prompts.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(prompts)
    }

    /// Build the full system prompt for this prompt.
    pub fn system_prompt(&self, base_identity: &str) -> String {
        let mut prompt = self.body.clone();

        if self.allow_shell {
            prompt = frontmatter::expand_shell_commands(&prompt);
        }

        if base_identity.is_empty() {
            prompt
        } else {
            format!(
                "{}\n\n---\n\n# Prompt: {}\n\n{}",
                base_identity, self.name, prompt
            )
        }
    }

    /// Whether this prompt has auto-invocation criteria.
    pub fn has_auto_trigger(&self) -> bool {
        self.when_to_use.is_some()
    }

    /// Substitute `$arg_name` placeholders in the body.
    pub fn substitute_args(&self, args: &std::collections::HashMap<String, String>) -> String {
        let mut prompt = self.body.clone();
        for (key, value) in args {
            prompt = prompt.replace(&format!("${key}"), value);
        }
        prompt
    }

    /// Check if a tool is allowed by this prompt's policy.
    pub fn is_tool_allowed(&self, tool_name: &str) -> bool {
        if !self.deny.is_empty() && self.deny.contains(&tool_name.to_string()) {
            return false;
        }
        if !self.tools.is_empty() {
            return self.tools.contains(&tool_name.to_string());
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_prompt() {
        let md = r#"---
name: deploy
description: Deploy a service
tags: [workflow, implement]
when_to_use: Use when the user wants to deploy to production
arguments: [service, env]
argument_hint: "<service> <env>"
tools: [shell, read_file]
---

Deploy $service to $env"#;

        let p = Prompt::parse(md).unwrap();
        assert_eq!(p.name, "deploy");
        assert_eq!(p.tags, vec!["workflow", "implement"]);
        assert_eq!(
            p.when_to_use.as_deref(),
            Some("Use when the user wants to deploy to production")
        );
        assert!(p.has_auto_trigger());
        assert_eq!(p.arguments, vec!["service", "env"]);
        assert_eq!(p.argument_hint.as_deref(), Some("<service> <env>"));
    }

    #[test]
    fn test_minimal_prompt() {
        let md = r#"---
name: health-check
description: Check health
tags: [autonomous]
tools: [shell]
---

Check health"#;

        let p = Prompt::parse(md).unwrap();
        assert_eq!(p.name, "health-check");
        assert_eq!(p.tags, vec!["autonomous"]);
        assert!(!p.has_auto_trigger());
        assert!(p.arguments.is_empty());
    }

    #[test]
    fn test_argument_substitution() {
        let md = r#"---
name: test
description: test
arguments: [name, target]
---

Deploy $name to $target environment"#;

        let p = Prompt::parse(md).unwrap();
        let mut args = std::collections::HashMap::new();
        args.insert("name".to_string(), "myapp".to_string());
        args.insert("target".to_string(), "production".to_string());

        let result = p.substitute_args(&args);
        assert_eq!(result, "Deploy myapp to production environment");
    }

    #[test]
    fn test_shell_expansion_in_prompt() {
        let md = r#"---
name: test
description: test
allow_shell: true
---

Date: !`echo 2026-04-01` and host: !`echo testhost`"#;

        let p = Prompt::parse(md).unwrap();
        let prompt = p.system_prompt("");
        assert!(prompt.contains("2026-04-01"), "got: {prompt}");
        assert!(prompt.contains("testhost"), "got: {prompt}");
        assert!(!prompt.contains("!`"), "shell markers should be replaced");
    }

    #[test]
    fn test_shell_expansion_disabled_by_default() {
        let md = r#"---
name: test
description: test
---

Should not expand: !`echo danger`"#;

        let p = Prompt::parse(md).unwrap();
        let prompt = p.system_prompt("");
        assert!(prompt.contains("!`echo danger`"));
    }

    #[test]
    fn test_tool_allowed() {
        let md = r#"---
name: test
description: test
tools: [shell, read_file]
deny: [write_file]
---

test"#;

        let p = Prompt::parse(md).unwrap();
        assert!(p.is_tool_allowed("shell"));
        assert!(p.is_tool_allowed("read_file"));
        assert!(!p.is_tool_allowed("write_file"));
        assert!(!p.is_tool_allowed("edit_file"));
    }

    #[test]
    fn test_tags_filtering() {
        let md = r#"---
name: test
description: test
tags: [workflow, implement, rust]
---

body"#;

        let p = Prompt::parse(md).unwrap();
        assert!(p.tags.contains(&"workflow".to_string()));
        assert!(p.tags.contains(&"implement".to_string()));
        assert!(p.tags.contains(&"rust".to_string()));
    }
}
