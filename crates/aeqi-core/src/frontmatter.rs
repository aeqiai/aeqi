//! Shared YAML frontmatter parser for prompt files.
//!
//! All prompts (skills, agents, primers) use the same format:
//! ```text
//! ---
//! name: my-prompt
//! description: What it does
//! tools: [shell, read_file]
//! ---
//!
//! The prompt body (system prompt) goes here...
//! ```

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;
use std::path::Path;

/// Parse a markdown file with YAML frontmatter into (metadata JSON, body string).
pub fn parse_frontmatter(content: &str) -> Result<(serde_json::Value, String)> {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        anyhow::bail!("missing frontmatter (expected --- header)");
    }
    let end = trimmed[3..]
        .find("\n---")
        .context("missing frontmatter closing ---")?;
    let yaml_block = trimmed[3..3 + end].trim();
    let body = trimmed[3 + end + 4..].trim().to_string();
    Ok((parse_yaml(yaml_block), body))
}

/// Parse frontmatter and deserialize metadata into a typed struct.
/// Returns (metadata, body).
pub fn load_frontmatter<T: DeserializeOwned>(content: &str) -> Result<(T, String)> {
    let (json, body) = parse_frontmatter(content)?;
    let meta: T =
        serde_json::from_value(json).context("failed to deserialize frontmatter fields")?;
    Ok((meta, body))
}

/// Load a markdown file from disk and parse its frontmatter.
pub fn load_frontmatter_file<T: DeserializeOwned>(path: &Path) -> Result<(T, String)> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read: {}", path.display()))?;
    load_frontmatter::<T>(&content).with_context(|| format!("failed to parse: {}", path.display()))
}

/// Minimal YAML-like parser for frontmatter key: value pairs.
/// Handles: scalars, inline arrays `[a, b]`, block lists `- item`, nested maps, booleans.
fn parse_yaml(text: &str) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();
        if line.is_empty() || line.starts_with('#') {
            i += 1;
            continue;
        }

        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim().to_string();
            let val = val.trim();

            if val.is_empty() {
                // Next line determines: list (- item) or nested map.
                let next_line = lines.get(i + 1).map(|l| l.trim()).unwrap_or("");
                let is_list = next_line.starts_with("- ");

                if is_list {
                    let mut items: Vec<serde_json::Value> = Vec::new();
                    i += 1;
                    while i < lines.len() {
                        let sub = lines[i];
                        let trimmed = sub.trim();
                        if !sub.starts_with(' ') && !sub.starts_with('\t') && !trimmed.is_empty() {
                            break;
                        }
                        if trimmed.is_empty() {
                            i += 1;
                            continue;
                        }
                        if let Some(first_kv) = trimmed.strip_prefix("- ") {
                            let mut obj = serde_json::Map::new();
                            if let Some((k, v)) = first_kv.split_once(':') {
                                let v = v.trim().trim_matches('"');
                                insert_typed(&mut obj, k.trim(), v);
                            }
                            i += 1;
                            while i < lines.len() {
                                let inner = lines[i].trim();
                                if inner.is_empty() {
                                    i += 1;
                                    continue;
                                }
                                if inner.starts_with("- ")
                                    || (!lines[i].starts_with(' ') && !lines[i].starts_with('\t'))
                                {
                                    break;
                                }
                                if let Some((k, v)) = inner.split_once(':') {
                                    let v = v.trim().trim_matches('"');
                                    insert_typed(&mut obj, k.trim(), v);
                                }
                                i += 1;
                            }
                            items.push(serde_json::Value::Object(obj));
                        } else {
                            i += 1;
                        }
                    }
                    map.insert(key, serde_json::Value::Array(items));
                } else {
                    // Nested map.
                    let mut nested = serde_json::Map::new();
                    i += 1;
                    while i < lines.len() {
                        let sub = lines[i];
                        let trimmed = sub.trim();
                        if !sub.starts_with(' ') && !sub.starts_with('\t') && !trimmed.is_empty() {
                            break;
                        }
                        if trimmed.is_empty() {
                            i += 1;
                            continue;
                        }
                        if let Some((k, v)) = trimmed.split_once(':') {
                            let v = v.trim().trim_matches('"');
                            insert_typed(&mut nested, k.trim(), v);
                        }
                        i += 1;
                    }
                    map.insert(key, serde_json::Value::Object(nested));
                }
                continue;
            }

            // Inline value.
            let val = val.trim_matches('"');
            if val.starts_with('[') && val.ends_with(']') {
                // Inline array: [a, b, c]
                let inner = &val[1..val.len() - 1];
                if inner.trim().is_empty() {
                    map.insert(key, serde_json::Value::Array(Vec::new()));
                } else {
                    let items: Vec<serde_json::Value> = inner
                        .split(',')
                        .map(|s| serde_json::Value::String(s.trim().trim_matches('"').to_string()))
                        .collect();
                    map.insert(key, serde_json::Value::Array(items));
                }
            } else {
                insert_typed(&mut map, &key, val);
            }
        }
        i += 1;
    }
    serde_json::Value::Object(map)
}

fn insert_typed(map: &mut serde_json::Map<String, serde_json::Value>, key: &str, val: &str) {
    let key = key.to_string();
    match val {
        "true" => {
            map.insert(key, serde_json::Value::Bool(true));
        }
        "false" => {
            map.insert(key, serde_json::Value::Bool(false));
        }
        _ => {
            if let Ok(n) = val.parse::<u64>() {
                map.insert(key, serde_json::json!(n));
            } else if let Ok(f) = val.parse::<f64>() {
                map.insert(key, serde_json::json!(f));
            } else {
                map.insert(key, serde_json::Value::String(val.to_string()));
            }
        }
    }
}

/// Execute `!`backtick`` blocks in a prompt string and replace with their stdout.
/// Format: `!`command here`` — the content between markers is passed to `bash -c`.
pub fn expand_shell_commands(prompt: &str) -> String {
    let mut result = String::with_capacity(prompt.len());
    let mut remaining = prompt;

    while let Some(start) = remaining.find("!`") {
        result.push_str(&remaining[..start]);
        let after_marker = &remaining[start + 2..];

        if let Some(end) = after_marker.find('`') {
            let command = &after_marker[..end];
            let output = std::process::Command::new("bash")
                .arg("-c")
                .arg(command)
                .output();

            match output {
                Ok(out) if out.status.success() => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    result.push_str(stdout.trim_end());
                }
                Ok(out) => {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    result.push_str(&format!("[shell error: {}]", stderr.trim()));
                }
                Err(e) => {
                    result.push_str(&format!("[shell exec failed: {e}]"));
                }
            }

            remaining = &after_marker[end + 1..];
        } else {
            result.push_str("!`");
            remaining = after_marker;
        }
    }
    result.push_str(remaining);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_frontmatter() {
        let content = r#"---
name: test-skill
description: A test skill
phase: autonomous
---

You are a test agent."#;

        let (json, body) = parse_frontmatter(content).unwrap();
        assert_eq!(json["name"], "test-skill");
        assert_eq!(json["description"], "A test skill");
        assert_eq!(json["phase"], "autonomous");
        assert_eq!(body, "You are a test agent.");
    }

    #[test]
    fn test_parse_inline_arrays() {
        let content = r#"---
name: test
description: test
tools: [shell, read_file, edit_file]
deny: [write_file]
---

body"#;

        let (json, _) = parse_frontmatter(content).unwrap();
        let tools = json["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 3);
        assert_eq!(tools[0], "shell");
    }

    #[test]
    fn test_parse_booleans_and_numbers() {
        let content = r#"---
name: test
description: test
allow_shell: true
worktree: false
parallel: 3
max_budget_usd: 1.50
---

body"#;

        let (json, _) = parse_frontmatter(content).unwrap();
        assert_eq!(json["allow_shell"], true);
        assert_eq!(json["worktree"], false);
        assert_eq!(json["parallel"], 3);
        assert!((json["max_budget_usd"].as_f64().unwrap() - 1.50).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_nested_map() {
        let content = r#"---
name: ceo
faces:
  greeting: hi
  thinking: hmm
---

body"#;

        let (json, _) = parse_frontmatter(content).unwrap();
        assert_eq!(json["faces"]["greeting"], "hi");
        assert_eq!(json["faces"]["thinking"], "hmm");
    }

    #[test]
    fn test_parse_block_list() {
        let content = r#"---
name: ceo
triggers:
  - name: consolidation
    schedule: every 6h
    skill: memory-consolidation
  - name: brief
    schedule: every 24h
    skill: morning-brief
---

body"#;

        let (json, _) = parse_frontmatter(content).unwrap();
        let triggers = json["triggers"].as_array().unwrap();
        assert_eq!(triggers.len(), 2);
        assert_eq!(triggers[0]["name"], "consolidation");
        assert_eq!(triggers[0]["skill"], "memory-consolidation");
    }

    #[test]
    fn test_missing_frontmatter() {
        let result = parse_frontmatter("No frontmatter here");
        assert!(result.is_err());
    }

    #[test]
    fn test_load_typed() {
        #[derive(serde::Deserialize)]
        struct Meta {
            name: String,
            #[serde(default)]
            tools: Vec<String>,
        }

        let content = r#"---
name: hello
tools: [a, b]
---

body"#;

        let (meta, body): (Meta, String) = load_frontmatter(content).unwrap();
        assert_eq!(meta.name, "hello");
        assert_eq!(meta.tools, vec!["a", "b"]);
        assert_eq!(body, "body");
    }
}
