use anyhow::{Context, Result};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::cli::WorkAction;
use crate::helpers::{daemon_ipc_request, load_config};

pub(crate) async fn cmd_work(config_path: &Option<PathBuf>, action: WorkAction) -> Result<()> {
    match action {
        WorkAction::Start {
            quest_id,
            root,
            repo,
            worktree,
            base,
            no_worktree,
            no_claim,
            dry_run,
            top_k,
        } => {
            let opts = WorkStartOptions {
                quest_id,
                root,
                repo,
                worktree,
                base,
                no_worktree,
                no_claim,
                dry_run,
                top_k,
            };
            cmd_work_start(config_path, opts).await
        }
    }
}

struct WorkStartOptions {
    quest_id: String,
    root: String,
    repo: Option<PathBuf>,
    worktree: Option<PathBuf>,
    base: String,
    no_worktree: bool,
    no_claim: bool,
    dry_run: bool,
    top_k: usize,
}

async fn cmd_work_start(config_path: &Option<PathBuf>, opts: WorkStartOptions) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let repo_path = resolve_repo_path(&config, &opts.root, opts.repo.as_deref())?;
    let git_status = git_status_summary(&repo_path);

    let quest_resp = daemon_ipc_request(
        config_path,
        &serde_json::json!({
            "cmd": "get_quest",
            "quest_id": opts.quest_id,
            "project": opts.root,
        }),
    )
    .await
    .context("load quest context from daemon IPC")?;
    ensure_ok(&quest_resp, "get_quest")?;

    let quest = quest_resp.get("quest").unwrap_or(&Value::Null);
    let idea = quest_resp.get("idea").unwrap_or(&Value::Null);
    let branch = quest
        .get("worktree_branch")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| quest_branch_name(&opts.quest_id));
    let discovered_worktree = discover_worktree(&repo_path, &opts.quest_id, &branch)?;
    let worktree_path = select_worktree_path(
        &opts.quest_id,
        opts.worktree.as_deref(),
        quest.get("worktree_path").and_then(Value::as_str),
        discovered_worktree
            .as_ref()
            .map(|entry| entry.path.as_path()),
    );
    let title = quest_title(quest, idea, &opts.quest_id);
    let body = idea
        .get("content")
        .and_then(Value::as_str)
        .or_else(|| quest.get("body").and_then(Value::as_str))
        .unwrap_or("");
    let idea_query = build_context_query(title, body);
    let graph_query = title;

    println!("Work start: {}", opts.quest_id);
    println!("  title: {title}");
    println!(
        "  status: {} | priority: {} | assignee: {}",
        string_field(quest, "status", "unknown"),
        string_field(quest, "priority", "normal"),
        string_field(quest, "assignee", "-"),
    );
    println!("  root: {}", opts.root);
    println!("  repo: {}", repo_path.display());
    println!("  branch: {branch}");
    println!("  worktree: {}", worktree_path.display());
    println!("  git: {git_status}");
    println!();

    print_related_ideas(config_path, &idea_query, opts.top_k).await?;
    print_graph_hints(&config, &opts.root, graph_query, opts.top_k)?;
    print_worktree_step(
        &repo_path,
        &worktree_path,
        &branch,
        &opts.base,
        discovered_worktree.as_ref(),
        opts.no_worktree,
        opts.dry_run,
    )?;
    let claim = QuestClaim {
        quest_id: &opts.quest_id,
        root: &opts.root,
        worktree_branch: &branch,
        worktree_path: &worktree_path,
        record_worktree: !opts.no_worktree,
        no_claim: opts.no_claim,
        dry_run: opts.dry_run,
    };
    print_claim_step(config_path, claim).await?;
    print_verification_ladder(&opts.root, &repo_path);

    Ok(())
}

fn ensure_ok(response: &Value, action: &str) -> Result<()> {
    if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(());
    }
    let err = response
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    anyhow::bail!("{action} failed: {err}");
}

fn resolve_repo_path(
    config: &aeqi_core::AEQIConfig,
    root: &str,
    override_repo: Option<&Path>,
) -> Result<PathBuf> {
    if let Some(path) = override_repo {
        return Ok(expand_home(path));
    }

    if let Some(path) = config
        .agent_spawns
        .iter()
        .find(|p| p.name == root)
        .map(|p| {
            PathBuf::from(
                p.repo
                    .replace('~', &dirs::home_dir().unwrap_or_default().to_string_lossy()),
            )
        })
    {
        return Ok(path);
    }

    let cwd = std::env::current_dir().context("resolve current directory")?;
    let output = Command::new("git")
        .args([
            "-C",
            cwd.to_string_lossy().as_ref(),
            "rev-parse",
            "--show-toplevel",
        ])
        .output();
    if let Ok(output) = output
        && output.status.success()
    {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }

    anyhow::bail!(
        "project '{root}' has no configured repo; pass --repo or run inside a git checkout"
    );
}

fn expand_home(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix("~/")
        && let Some(home) = dirs::home_dir()
    {
        return home.join(rest);
    }
    path.to_path_buf()
}

fn git_status_summary(repo_path: &Path) -> String {
    let output = Command::new("git")
        .args([
            "-C",
            repo_path.to_string_lossy().as_ref(),
            "status",
            "--short",
            "--branch",
        ])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let mut lines = text.lines();
            let branch = lines.next().unwrap_or("## unknown");
            let dirty = lines.count();
            if dirty == 0 {
                format!("{branch} clean")
            } else {
                format!("{branch} with {dirty} changed path(s)")
            }
        }
        Ok(output) => format!(
            "status unavailable: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
        Err(err) => format!("status unavailable: {err}"),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorktreeEntry {
    path: PathBuf,
    branch: Option<String>,
}

fn discover_worktree(
    repo_path: &Path,
    quest_id: &str,
    branch: &str,
) -> Result<Option<WorktreeEntry>> {
    let output = Command::new("git")
        .args([
            "-C",
            repo_path.to_string_lossy().as_ref(),
            "worktree",
            "list",
            "--porcelain",
        ])
        .output()
        .context("run git worktree list")?;
    if !output.status.success() {
        anyhow::bail!(
            "git worktree list failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(find_quest_worktree(
        &parse_worktree_porcelain(&String::from_utf8_lossy(&output.stdout)),
        quest_id,
        branch,
    ))
}

fn quest_title<'a>(quest: &'a Value, idea: &'a Value, fallback: &'a str) -> &'a str {
    idea.get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .or_else(|| quest.get("title").and_then(Value::as_str))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback)
}

fn string_field<'a>(value: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(fallback)
}

fn build_context_query(title: &str, body: &str) -> String {
    let mut query = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if !body.trim().is_empty() {
        query.push(' ');
        query.push_str(body);
    }
    query
        .split_whitespace()
        .take(80)
        .collect::<Vec<_>>()
        .join(" ")
}

fn select_worktree_path(
    quest_id: &str,
    explicit: Option<&Path>,
    quest_record_path: Option<&str>,
    discovered: Option<&Path>,
) -> PathBuf {
    if let Some(path) = explicit {
        return path.to_path_buf();
    }
    if let Some(path) = quest_record_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.exists())
    {
        return path;
    }
    if let Some(path) = discovered {
        return path.to_path_buf();
    }
    default_worktree_path(quest_id)
}

async fn print_related_ideas(
    config_path: &Option<PathBuf>,
    query: &str,
    top_k: usize,
) -> Result<()> {
    println!("Related ideas:");
    let response = daemon_ipc_request(
        config_path,
        &serde_json::json!({
            "cmd": "search_ideas",
            "query": query,
            "top_k": top_k,
            "compact": true,
        }),
    )
    .await
    .context("search related ideas from daemon IPC")?;
    if !response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        println!(
            "  unavailable: {}",
            response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
        );
        println!();
        return Ok(());
    }

    let ideas = response
        .get("ideas")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(top_k)
        .collect::<Vec<_>>();
    if ideas.is_empty() {
        println!("  none");
    } else {
        for idea in ideas {
            let name = string_field(idea, "name", "(untitled)");
            let id = string_field(idea, "id", "-");
            let snippet = idea
                .get("snippet")
                .and_then(Value::as_str)
                .or_else(|| idea.get("content").and_then(Value::as_str))
                .unwrap_or("");
            println!("  - {name} ({id})");
            if !snippet.is_empty() {
                println!("    {}", text_snippet(snippet, 180));
            }
        }
    }
    println!();
    Ok(())
}

fn print_graph_hints(
    config: &aeqi_core::AEQIConfig,
    root: &str,
    query: &str,
    top_k: usize,
) -> Result<()> {
    println!("Code graph hints:");
    let db_path = config
        .data_dir()
        .join("codegraph")
        .join(format!("{root}.db"));
    if !db_path.exists() {
        println!("  unavailable: graph DB missing at {}", db_path.display());
        println!("  run: aeqi graph index -r {root}");
        println!();
        return Ok(());
    }

    let store = aeqi_graph::GraphStore::open(&db_path)
        .with_context(|| format!("open graph DB at {}", db_path.display()))?;
    let nodes = store
        .search_nodes(query, top_k.saturating_mul(4).max(top_k))?
        .into_iter()
        .filter(|node| !node.file_path.starts_with("tmp/"))
        .take(top_k)
        .collect::<Vec<_>>();
    if nodes.is_empty() {
        println!("  none");
    } else {
        for node in nodes {
            println!(
                "  - {} {} at {}:{}",
                node.label.as_str(),
                node.name,
                node.file_path,
                node.start_line
            );
        }
    }
    println!();
    Ok(())
}

fn print_worktree_step(
    repo_path: &Path,
    worktree_path: &Path,
    branch: &str,
    base: &str,
    discovered: Option<&WorktreeEntry>,
    no_worktree: bool,
    dry_run: bool,
) -> Result<()> {
    println!("Worktree:");
    if no_worktree {
        println!("  skipped by --no-worktree");
        println!();
        return Ok(());
    }
    if let Some(entry) = discovered
        && entry.path == worktree_path
    {
        println!(
            "  adopted: {} ({})",
            entry.path.display(),
            entry.branch.as_deref().unwrap_or("detached")
        );
        println!("  next: cd {}", entry.path.display());
        println!();
        return Ok(());
    }
    if worktree_path.exists() {
        println!("  exists: {}", worktree_path.display());
        println!("  next: cd {}", worktree_path.display());
        println!();
        return Ok(());
    }
    if dry_run {
        println!(
            "  would run: git -C {} worktree add -b {branch} {} {base}",
            repo_path.display(),
            worktree_path.display()
        );
        println!();
        return Ok(());
    }

    let output = Command::new("git")
        .args([
            "-C",
            repo_path.to_string_lossy().as_ref(),
            "worktree",
            "add",
            "-b",
            branch,
            worktree_path.to_string_lossy().as_ref(),
            base,
        ])
        .output()
        .context("run git worktree add")?;
    if !output.status.success() {
        anyhow::bail!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    println!("  created: {}", worktree_path.display());
    println!("  next: cd {}", worktree_path.display());
    println!();
    Ok(())
}

struct QuestClaim<'a> {
    quest_id: &'a str,
    root: &'a str,
    worktree_branch: &'a str,
    worktree_path: &'a Path,
    record_worktree: bool,
    no_claim: bool,
    dry_run: bool,
}

async fn print_claim_step(config_path: &Option<PathBuf>, claim: QuestClaim<'_>) -> Result<()> {
    println!("Quest claim:");
    if claim.no_claim {
        println!("  skipped by --no-claim");
        println!();
        return Ok(());
    }
    if claim.dry_run {
        if claim.record_worktree {
            println!(
                "  would mark {quest_id} in_progress with {} at {}",
                claim.worktree_branch,
                claim.worktree_path.display(),
                quest_id = claim.quest_id
            );
        } else {
            println!("  would mark {} in_progress", claim.quest_id);
        }
        println!();
        return Ok(());
    }

    let mut request = serde_json::json!({
        "cmd": "update_quest",
        "quest_id": claim.quest_id,
        "project": claim.root,
        "status": "in_progress",
    });
    if claim.record_worktree
        && let Some(obj) = request.as_object_mut()
    {
        obj.insert(
            "worktree_branch".to_string(),
            Value::String(claim.worktree_branch.to_string()),
        );
        obj.insert(
            "worktree_path".to_string(),
            Value::String(claim.worktree_path.to_string_lossy().into_owned()),
        );
    }

    let response = daemon_ipc_request(config_path, &request)
        .await
        .context("mark quest in progress from daemon IPC")?;
    ensure_ok(&response, "update_quest")?;
    println!("  marked in_progress");
    println!();
    Ok(())
}

fn print_verification_ladder(root: &str, repo_path: &Path) {
    println!("Verification ladder:");
    if root == "aeqi" || repo_path.join("scripts/ci-local.sh").exists() {
        println!("  - cargo fmt --all --check");
        println!("  - cargo test -p <touched-rust-package>");
        println!("  - node scripts/maintainability-ratchet.mjs");
        println!("  - scripts/public-surface-scan.sh");
        println!("  - scripts/ci-local.sh prepush");
    } else if repo_path.join("package.json").exists() {
        println!("  - npm run check");
        println!("  - npm run build");
    } else {
        println!("  - git diff --check");
        println!("  - repo-specific test/build command for touched files");
    }
}

fn default_worktree_path(quest_id: &str) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".aeqi")
        .join("worktrees")
        .join(quest_id)
}

fn quest_branch_name(quest_id: &str) -> String {
    format!("quest/{}", git_ref_component(quest_id))
}

fn quest_slug(quest_id: &str) -> String {
    let slug = quest_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "quest".to_string()
    } else {
        slug
    }
}

fn git_ref_component(input: &str) -> String {
    let value = input
        .trim()
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '-' => ch,
            _ => '-',
        })
        .collect::<String>();
    let value = value
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let value = value.trim_matches('.').to_string();
    if value.is_empty() {
        quest_slug(input)
    } else {
        value
    }
}

fn parse_worktree_porcelain(input: &str) -> Vec<WorktreeEntry> {
    let mut entries = Vec::new();
    let mut path: Option<PathBuf> = None;
    let mut branch: Option<String> = None;

    for line in input.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if let Some(path) = path.take() {
                entries.push(WorktreeEntry {
                    path,
                    branch: branch.take(),
                });
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("worktree ") {
            path = Some(PathBuf::from(value));
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = value
                .strip_prefix("refs/heads/")
                .or(Some(value))
                .map(str::to_string);
        }
    }

    entries
}

fn find_quest_worktree(
    entries: &[WorktreeEntry],
    quest_id: &str,
    branch: &str,
) -> Option<WorktreeEntry> {
    entries
        .iter()
        .find(|entry| entry.branch.as_deref() == Some(branch))
        .or_else(|| {
            entries.iter().find(|entry| {
                entry
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name == quest_id || name == quest_slug(quest_id))
                    .unwrap_or(false)
            })
        })
        .cloned()
}

fn text_snippet(input: &str, max_chars: usize) -> String {
    let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut snippet = normalized.chars().take(max_chars).collect::<String>();
    snippet.push('…');
    snippet
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quest_slug_is_git_branch_safe() {
        assert_eq!(quest_slug("ch-116.10"), "ch-116-10");
        assert_eq!(quest_slug("  Weird/Quest.ID  "), "weird-quest-id");
        assert_eq!(quest_slug("..."), "quest");
    }

    #[test]
    fn quest_branch_uses_runtime_sandbox_convention() {
        assert_eq!(quest_branch_name("ch-116.10"), "quest/ch-116.10");
        assert_eq!(quest_branch_name("weird/id"), "quest/weird-id");
    }

    #[test]
    fn parse_porcelain_and_find_existing_worktree() {
        let entries = parse_worktree_porcelain(
            "worktree /workspace/aeqi\nHEAD abc123\nbranch refs/heads/main\n\nworktree /workspace/.aeqi/worktrees/ch-116.10\nHEAD def456\nbranch refs/heads/quest/ch-116.10\n\n",
        );

        assert_eq!(entries.len(), 2);
        let found = find_quest_worktree(&entries, "ch-116.10", "quest/ch-116.10")
            .expect("quest worktree found");
        assert_eq!(
            found.path,
            PathBuf::from("/workspace/.aeqi/worktrees/ch-116.10")
        );
    }

    #[test]
    fn select_worktree_prefers_explicit_then_existing_record_then_discovered() {
        let explicit = PathBuf::from("/tmp/explicit");
        let discovered = PathBuf::from("/tmp/discovered");

        assert_eq!(
            select_worktree_path(
                "ch-116.10",
                Some(&explicit),
                Some("/missing"),
                Some(&discovered)
            ),
            explicit
        );
        assert_eq!(
            select_worktree_path("ch-116.10", None, Some("/missing"), Some(&discovered)),
            discovered
        );
    }

    #[test]
    fn context_query_is_bounded_and_normalized() {
        let query = build_context_query(
            "Quest   title",
            "body with\nextra whitespace and enough words to keep this readable",
        );
        assert_eq!(
            query,
            "Quest title body with extra whitespace and enough words to keep this readable"
        );
    }
}
