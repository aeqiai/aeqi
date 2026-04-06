use crate::cli::HooksAction;
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub(crate) async fn cmd_hooks(action: HooksAction) -> Result<()> {
    match action {
        HooksAction::Test {
            script,
            input,
            tool,
        } => cmd_hooks_test(&script, input.as_deref(), &tool).await,
        HooksAction::Validate => cmd_hooks_validate().await,
        HooksAction::List => cmd_hooks_list().await,
        HooksAction::Bench { script, iterations } => {
            cmd_hooks_bench(script.as_deref(), iterations).await
        }
    }
}

// --- Claude Code settings.json schema (partial) ---

#[derive(Debug, Deserialize)]
struct ClaudeSettings {
    hooks: Option<HashMap<String, Vec<HookMatcher>>>,
}

#[derive(Debug, Deserialize)]
struct HookMatcher {
    matcher: String,
    hooks: Vec<HookDef>,
}

#[derive(Debug, Deserialize)]
struct HookDef {
    #[serde(rename = "type")]
    _hook_type: String,
    command: String,
}

fn scripts_dir() -> PathBuf {
    PathBuf::from("/home/claudedev/aeqi/scripts")
}

fn find_settings() -> Result<PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    let path = PathBuf::from(&home).join(".claude/settings.json");
    if path.exists() {
        Ok(path)
    } else {
        bail!("Claude Code settings.json not found at {}", path.display());
    }
}

fn parse_settings(path: &Path) -> Result<ClaudeSettings> {
    let content = std::fs::read_to_string(path)?;
    serde_json::from_str(&content).context("Failed to parse settings.json")
}

/// Extract the script path from a hook command string.
/// Returns None for inline echo commands (static deny hooks).
fn extract_script_path(command: &str) -> Option<&str> {
    if command.starts_with("echo ") || command.starts_with("touch ") {
        return None;
    }
    command.split_whitespace().next()
}

/// Resolve a script name to a full path (accepts name, name.sh, or full path).
fn resolve_script(name: &str) -> PathBuf {
    let path = PathBuf::from(name);
    if path.exists() {
        return path;
    }
    let with_ext = scripts_dir().join(format!("{}.sh", name));
    if with_ext.exists() {
        return with_ext;
    }
    let direct = scripts_dir().join(name);
    if direct.exists() {
        return direct;
    }
    path
}

/// Extract the deny reason from an inline echo hook command.
fn extract_inline_reason(command: &str) -> Option<String> {
    let marker = "permissionDecisionReason\":\"";
    let start = command.find(marker)? + marker.len();
    let rest = &command[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// --- Subcommands ---

pub(crate) async fn cmd_hooks_test(script: &str, input: Option<&str>, tool: &str) -> Result<()> {
    let script_path = resolve_script(script);
    if !script_path.exists() {
        bail!("Script not found: {}", script_path.display());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = script_path.metadata()?.permissions().mode();
        if mode & 0o111 == 0 {
            bail!(
                "Script not executable: {}  (chmod +x to fix)",
                script_path.display()
            );
        }
    }

    let default_input =
        r#"{"file_path":"/home/claudedev/aeqi/crates/aeqi-core/src/lib.rs"}"#.to_string();
    let tool_input = input.unwrap_or(&default_input);

    println!("Script:  {}", script_path.display());
    println!("Tool:    {}", tool);
    println!("Input:   {}", tool_input);
    println!("---");

    let start = Instant::now();
    let output = Command::new(&script_path)
        .env("CLAUDE_TOOL_INPUT", tool_input)
        .env("CLAUDE_TOOL", tool)
        .env("AEQI_CONFIG", "/home/claudedev/aeqi/config/aeqi.toml")
        .output()
        .with_context(|| format!("Failed to execute {}", script_path.display()))?;
    let elapsed = start.elapsed();

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Exit code
    let code = output.status.code().unwrap_or(-1);
    if code != 0 {
        println!("[FAIL] exit={}", code);
    } else {
        println!("[OK]   exit=0");
    }

    println!("       time={:.1}ms", elapsed.as_secs_f64() * 1000.0);

    if !stderr.is_empty() {
        println!("       stderr: {}", stderr.trim());
    }

    if stdout.trim().is_empty() {
        println!("       output: (empty — no hook decision emitted, passes through)");
        return Ok(());
    }

    // Validate JSON and extract decision
    match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        Ok(json) => {
            let decision = json
                .pointer("/hookSpecificOutput/permissionDecision")
                .and_then(|v| v.as_str())
                .unwrap_or("(missing)");
            let reason = json
                .pointer("/hookSpecificOutput/permissionDecisionReason")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match decision {
                "allow" => print!("       decision: ALLOW"),
                "deny" => print!("       decision: DENY"),
                other => print!("       decision: {}", other),
            }
            if !reason.is_empty() {
                println!(" — {}", reason);
            } else {
                println!();
            }
            println!("       json: valid");
        }
        Err(e) => {
            println!("[WARN] json: INVALID — {}", e);
            println!("       raw output: {}", stdout.trim());
        }
    }

    Ok(())
}

pub(crate) async fn cmd_hooks_validate() -> Result<()> {
    let settings_path = find_settings()?;
    let settings = parse_settings(&settings_path)?;

    let hooks = match &settings.hooks {
        Some(h) => h,
        None => {
            println!("No hooks configured in {}", settings_path.display());
            return Ok(());
        }
    };

    let event_order = [
        "SessionStart",
        "PreToolUse",
        "PostToolUse",
        "Notification",
        "Stop",
    ];

    let mut total = 0u32;
    let mut ok = 0u32;
    let mut warn = 0u32;
    let mut fail = 0u32;

    for event in &event_order {
        let matchers = match hooks.get(*event) {
            Some(m) => m,
            None => continue,
        };

        for matcher in matchers {
            for hook in &matcher.hooks {
                total += 1;

                let script_path = match extract_script_path(&hook.command) {
                    Some(p) => p,
                    None => {
                        // Inline command (echo/touch) — validate JSON output
                        if hook.command.starts_with("echo ") {
                            let content = hook.command.trim_start_matches("echo ");
                            let unquoted = content.trim_matches('\'');
                            match serde_json::from_str::<serde_json::Value>(unquoted) {
                                Ok(_) => {
                                    ok += 1;
                                    println!(
                                        "  [OK]   {:<15} {:<30} inline deny",
                                        event, matcher.matcher
                                    );
                                }
                                Err(_) => {
                                    warn += 1;
                                    println!(
                                        "  [WARN] {:<15} {:<30} inline — invalid JSON",
                                        event, matcher.matcher
                                    );
                                }
                            }
                        } else {
                            ok += 1;
                            println!(
                                "  [OK]   {:<15} {:<30} inline command",
                                event, matcher.matcher
                            );
                        }
                        continue;
                    }
                };

                let path = PathBuf::from(script_path);
                let mut issues: Vec<&str> = Vec::new();

                if !path.exists() {
                    issues.push("NOT FOUND");
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if let Ok(meta) = path.metadata()
                            && meta.permissions().mode() & 0o111 == 0
                        {
                            issues.push("NOT EXECUTABLE");
                        }
                    }

                    // Check shebang
                    if let Ok(content) = std::fs::read_to_string(&path)
                        && !content.starts_with("#!")
                    {
                        issues.push("NO SHEBANG");
                    }

                    // Dry-run: execute with empty input and check for crashes
                    let test = Command::new(&path)
                        .env("CLAUDE_TOOL_INPUT", "{}")
                        .env("CLAUDE_TOOL", "Edit")
                        .env("AEQI_CONFIG", "/home/claudedev/aeqi/config/aeqi.toml")
                        .output();

                    match test {
                        Ok(output) if !output.status.success() => {
                            issues.push("NON-ZERO EXIT ON DRY RUN");
                        }
                        Err(_) => {
                            issues.push("FAILED TO EXECUTE");
                        }
                        _ => {}
                    }
                }

                let script_name = Path::new(script_path)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| script_path.to_string());

                if issues.is_empty() {
                    ok += 1;
                    println!(
                        "  [OK]   {:<15} {:<30} {}",
                        event, matcher.matcher, script_name
                    );
                } else {
                    fail += 1;
                    println!(
                        "  [FAIL] {:<15} {:<30} {} — {}",
                        event,
                        matcher.matcher,
                        script_name,
                        issues.join(", ")
                    );
                }
            }
        }
    }

    println!();
    println!(
        "{} hooks: {} ok, {} warnings, {} failures",
        total, ok, warn, fail
    );
    if fail > 0 {
        std::process::exit(1);
    }
    Ok(())
}

pub(crate) async fn cmd_hooks_list() -> Result<()> {
    let settings_path = find_settings()?;
    let settings = parse_settings(&settings_path)?;

    let hooks = match &settings.hooks {
        Some(h) => h,
        None => {
            println!("No hooks configured.");
            return Ok(());
        }
    };

    let event_order = [
        "SessionStart",
        "PreToolUse",
        "PostToolUse",
        "Notification",
        "Stop",
    ];

    for event in &event_order {
        let matchers = match hooks.get(*event) {
            Some(m) => m,
            None => continue,
        };

        println!("{}:", event);
        for matcher in matchers {
            let label = if matcher.matcher.is_empty() {
                "(all)"
            } else {
                &matcher.matcher
            };

            for hook in &matcher.hooks {
                let display = if let Some(reason) = extract_inline_reason(&hook.command) {
                    format!("deny: {}", &reason[..reason.len().min(60)])
                } else if let Some(path) = extract_script_path(&hook.command) {
                    Path::new(path)
                        .file_name()
                        .map(|f| f.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.to_string())
                } else {
                    hook.command[..hook.command.len().min(50)].to_string()
                };
                println!("  {:<35} -> {}", label, display);
            }
        }
        println!();
    }

    Ok(())
}

pub(crate) async fn cmd_hooks_bench(script: Option<&str>, iterations: u32) -> Result<()> {
    let scripts: Vec<PathBuf> = if let Some(name) = script {
        vec![resolve_script(name)]
    } else {
        // Bench all check-* and mark-* scripts (the hot-path hooks)
        let dir = scripts_dir();
        let mut paths = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("check-") || name.starts_with("mark-") {
                paths.push(entry.path());
            }
        }
        paths.sort();
        paths
    };

    let default_input = r#"{"file_path":"/home/claudedev/aeqi/crates/aeqi-core/src/lib.rs"}"#;

    // Ensure recall gate is set for benchmarking
    let home = std::env::var("HOME").context("HOME not set")?;
    let gate = PathBuf::from(&home).join(".aeqi/session/recall.gate");
    let _ = std::fs::File::create(&gate);

    println!(
        "{:<20} {:>8} {:>8} {:>8} {:>8} {:>8}  n={}",
        "script", "avg", "p50", "p99", "min", "max", iterations
    );
    println!("{}", "-".repeat(78));

    for script_path in &scripts {
        if !script_path.exists() {
            println!(
                "{:<20} NOT FOUND",
                script_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
            );
            continue;
        }

        let name = script_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let mut times: Vec<f64> = Vec::with_capacity(iterations as usize);

        for _ in 0..iterations {
            let start = Instant::now();
            let _ = Command::new(script_path)
                .env("CLAUDE_TOOL_INPUT", default_input)
                .env("CLAUDE_TOOL", "Edit")
                .env("AEQI_CONFIG", "/home/claudedev/aeqi/config/aeqi.toml")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            times.push(start.elapsed().as_secs_f64() * 1000.0);
        }

        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let len = times.len();
        let avg = times.iter().sum::<f64>() / len as f64;
        let p50 = times[len / 2];
        let p99 = times[((len as f64 * 0.99) as usize).min(len - 1)];
        let min = times[0];
        let max = times[len - 1];

        println!(
            "{:<20} {:>6.1}ms {:>6.1}ms {:>6.1}ms {:>6.1}ms {:>6.1}ms",
            name, avg, p50, p99, min, max
        );
    }

    // Cleanup
    let _ = std::fs::remove_file(&gate);

    Ok(())
}
