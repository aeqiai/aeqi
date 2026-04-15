use aeqi_quests::{Priority, Quest, QuestStatus};
use anyhow::Result;
use chrono::{Local, Utc};
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;

use crate::helpers::{
    daemon_ipc_request, format_project_org_hint, load_config_with_agents, open_quests_for_project,
};

#[derive(Debug, Clone, Default, Serialize)]
struct DaemonMonitor {
    online: bool,
    ready: Option<bool>,
    registered_owner_count: Option<u64>,
    configured_projects: Option<u64>,
    configured_advisors: Option<u64>,
    max_workers: Option<u64>,
    cost_today_usd: Option<f64>,
    daily_budget_usd: Option<f64>,
    budget_remaining_usd: Option<f64>,
    warnings: Vec<String>,
    blocking_reasons: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectMonitor {
    name: String,
    repo: String,
    repo_present: bool,
    runtime_provider: String,
    model: String,
    org_hint: String,
    open_quests: usize,
    ready_quests: usize,
    blocked_quests: usize,
    in_progress_quests: usize,
    critical_ready_quests: usize,
    budget_blocked_quests: usize,
    stalled: bool,
    top_ready_quests: Vec<String>,
    top_blocked_quests: Vec<String>,
    quest_store_error: Option<String>,
}

#[derive(Debug, Serialize)]
struct MonitorReport {
    generated_at: String,
    daemon: DaemonMonitor,
    projects: Vec<ProjectMonitor>,
    interventions: Vec<String>,
}

pub(crate) async fn cmd_monitor(
    config_path: &Option<PathBuf>,
    project_filter: Option<&str>,
    watch: bool,
    interval_secs: u64,
    json: bool,
) -> Result<()> {
    if watch && json {
        anyhow::bail!("`aeqi monitor --json` does not support `--watch`");
    }

    loop {
        let report = build_monitor_report(config_path, project_filter).await?;
        if json {
            println!("{}", serde_json::to_string_pretty(&report)?);
            return Ok(());
        }

        render_monitor_report(&report);

        if !watch {
            return Ok(());
        }

        std::io::stdout().flush().ok();
        tokio::time::sleep(std::time::Duration::from_secs(interval_secs.max(1))).await;
        print!("\x1B[2J\x1B[H");
    }
}

async fn build_monitor_report(
    config_path: &Option<PathBuf>,
    project_filter: Option<&str>,
) -> Result<MonitorReport> {
    let (config, _) = load_config_with_agents(config_path)?;

    let projects_cfg: Vec<_> = if let Some(name) = project_filter {
        let projects: Vec<_> = config
            .agent_spawns
            .iter()
            .filter(|project| project.name == name)
            .collect();
        if projects.is_empty() {
            anyhow::bail!("project not found: {name}");
        }
        projects
    } else {
        config.agent_spawns.iter().collect()
    };

    let daemon = load_daemon_monitor(config_path).await;
    let mut projects = Vec::new();
    for project in projects_cfg {
        let runtime = config.runtime_for_company(&project.name);
        projects.push(build_project_monitor(
            &config,
            &project.name,
            &project.repo,
            &runtime.provider.to_string(),
            &config.model_for_company(&project.name),
        ));
    }

    let interventions = build_interventions(&daemon, &projects);

    Ok(MonitorReport {
        generated_at: Utc::now().to_rfc3339(),
        daemon,
        projects,
        interventions,
    })
}

async fn load_daemon_monitor(config_path: &Option<PathBuf>) -> DaemonMonitor {
    let request = serde_json::json!({ "cmd": "readiness" });
    let response = match daemon_ipc_request(config_path, &request).await {
        Ok(response) => response,
        Err(error) => {
            return DaemonMonitor {
                error: Some(error.to_string()),
                ..DaemonMonitor::default()
            };
        }
    };

    if !response
        .get("ok")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return DaemonMonitor {
            error: response
                .get("error")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .or_else(|| Some("daemon returned an unknown readiness error".to_string())),
            ..DaemonMonitor::default()
        };
    }

    DaemonMonitor {
        online: true,
        ready: response.get("ready").and_then(serde_json::Value::as_bool),
        registered_owner_count: json_u64(&response, "registered_owner_count"),
        configured_projects: json_u64(&response, "configured_projects"),
        configured_advisors: json_u64(&response, "configured_advisors"),
        max_workers: json_u64(&response, "max_workers"),
        cost_today_usd: response
            .get("cost_today_usd")
            .and_then(serde_json::Value::as_f64),
        daily_budget_usd: response
            .get("daily_budget_usd")
            .and_then(serde_json::Value::as_f64),
        budget_remaining_usd: response
            .get("budget_remaining_usd")
            .and_then(serde_json::Value::as_f64),
        warnings: string_array(&response, "warnings"),
        blocking_reasons: string_array(&response, "blocking_reasons"),
        error: None,
    }
}

fn build_project_monitor(
    config: &aeqi_core::AEQIConfig,
    project_name: &str,
    repo: &str,
    runtime_provider: &str,
    model: &str,
) -> ProjectMonitor {
    let repo_present = PathBuf::from(repo).exists();
    let org_hint = format_project_org_hint(config, project_name)
        .trim()
        .to_string();

    let store = match open_quests_for_project(project_name) {
        Ok(store) => store,
        Err(error) => {
            return ProjectMonitor {
                name: project_name.to_string(),
                repo: repo.to_string(),
                repo_present,
                runtime_provider: runtime_provider.to_string(),
                model: model.to_string(),
                org_hint,
                open_quests: 0,
                ready_quests: 0,
                blocked_quests: 0,
                in_progress_quests: 0,
                critical_ready_quests: 0,
                budget_blocked_quests: 0,
                stalled: false,
                top_ready_quests: Vec::new(),
                top_blocked_quests: Vec::new(),
                quest_store_error: Some(error.to_string()),
            };
        }
    };

    let all_quests = store.all();
    let ready_quests = store.ready();
    let open_quests: Vec<_> = all_quests
        .iter()
        .copied()
        .filter(|q| !q.is_closed())
        .collect();
    let blocked_quests = sort_quests(
        open_quests
            .iter()
            .copied()
            .filter(|q| q.status == QuestStatus::Blocked)
            .collect(),
    );
    let in_progress_quests = open_quests
        .iter()
        .filter(|q| q.status == QuestStatus::InProgress)
        .count();
    let critical_ready_quests = ready_quests
        .iter()
        .filter(|q| q.priority == Priority::Critical)
        .count();
    let budget_blocked_quests = open_quests
        .iter()
        .filter(|q| {
            q.status == QuestStatus::Blocked
                && q.labels
                    .iter()
                    .any(|label| label.eq_ignore_ascii_case("budget-blocked"))
        })
        .count();

    ProjectMonitor {
        name: project_name.to_string(),
        repo: repo.to_string(),
        repo_present,
        runtime_provider: runtime_provider.to_string(),
        model: model.to_string(),
        org_hint,
        open_quests: open_quests.len(),
        ready_quests: ready_quests.len(),
        blocked_quests: blocked_quests.len(),
        in_progress_quests,
        critical_ready_quests,
        budget_blocked_quests,
        stalled: !open_quests.is_empty() && ready_quests.is_empty() && in_progress_quests == 0,
        top_ready_quests: ready_quests
            .iter()
            .take(3)
            .map(|q| quest_brief(q))
            .collect(),
        top_blocked_quests: blocked_quests
            .iter()
            .take(3)
            .map(|q| quest_brief(q))
            .collect(),
        quest_store_error: None,
    }
}

fn sort_quests(mut quests: Vec<&Quest>) -> Vec<&Quest> {
    quests.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    quests
}

fn quest_brief(quest: &Quest) -> String {
    format!("{} [{}] {}", quest.id, quest.priority, quest.name)
}

fn build_interventions(daemon: &DaemonMonitor, projects: &[ProjectMonitor]) -> Vec<String> {
    let mut interventions = Vec::new();

    if !daemon.online {
        interventions.push(
            "Daemon is offline, so patrols, watchdogs, and chat ingress are inactive. Start it with `aeqi daemon start` or `aeqi daemon install --start`.".to_string(),
        );
    }

    for reason in &daemon.blocking_reasons {
        if reason.contains("budget exhausted") {
            interventions.push(
                "Daily budget is exhausted. Raise `[security].max_cost_per_day_usd` or wait for the budget window to reset before expecting new autonomous work.".to_string(),
            );
        } else if reason.contains("skipped") {
            interventions.push(
                "Some configured owners were skipped because their directories are missing. Fix those paths and rerun `aeqi doctor --strict`.".to_string(),
            );
        } else if reason.contains("zero worker capacity") {
            interventions.push(
                "Registered owners expose zero worker capacity. Increase `max_workers` on the affected project or advisor before relying on background execution.".to_string(),
            );
        } else if reason.contains("no projects or advisor agents") {
            interventions.push(
                "No runnable owners are configured. Add a project or advisor, then rerun `aeqi setup` or `aeqi doctor --strict`.".to_string(),
            );
        }
    }

    let mut project_actions = Vec::new();
    for project in projects {
        if !project.repo_present {
            project_actions.push(format!(
                "{} points at a missing repo path ({}). Fix the repo path before trusting autonomous execution there.",
                project.name, project.repo
            ));
        }
        if let Some(error) = &project.quest_store_error {
            project_actions.push(format!(
                "{} quest board could not be opened ({error}). Fix the project directory before expecting patrols or monitor detail.",
                project.name
            ));
        }
        if project.budget_blocked_quests > 0 {
            project_actions.push(format!(
                "{} has {} budget-blocked quest(s). Lower quest burn, switch runtime, or raise project/day budgets.",
                project.name, project.budget_blocked_quests
            ));
        }
        if project.stalled && project.blocked_quests > 0 {
            let focus = project
                .top_blocked_quests
                .first()
                .cloned()
                .unwrap_or_else(|| "blocked work".to_string());
            project_actions.push(format!(
                "{} is stalled with blocked work and no active execution. Start with `{focus}` and inspect `aeqi audit --company {}`.",
                project.name, project.name
            ));
        } else if project.critical_ready_quests > 0 {
            project_actions.push(format!(
                "{} has {} critical ready quest(s). Pull them into execution with `aeqi ready --company {}` or let the daemon patrol pick them up.",
                project.name, project.critical_ready_quests, project.name
            ));
        } else if project.ready_quests > 0 && project.in_progress_quests == 0 {
            project_actions.push(format!(
                "{} has {} ready quest(s) but no active work. That is idle capacity or a stopped daemon.",
                project.name, project.ready_quests
            ));
        }
    }

    project_actions.sort();
    interventions.extend(project_actions);

    interventions.sort();
    interventions.dedup();
    interventions.truncate(8);

    if interventions.is_empty() {
        interventions.push(
            "No immediate interventions detected. Keep `aeqi monitor --watch` open while the daemon runs to spot drift early.".to_string(),
        );
    }

    interventions
}

fn render_monitor_report(report: &MonitorReport) {
    let generated = chrono::DateTime::parse_from_rfc3339(&report.generated_at)
        .map(|ts| ts.with_timezone(&Local))
        .unwrap_or_else(|_| Local::now());
    println!("AEQI Monitor");
    println!("Generated: {}", generated.format("%Y-%m-%d %H:%M:%S %Z"));
    println!(
        "Mode: {}",
        if report.daemon.online {
            "live daemon + local quest state"
        } else {
            "local quest state only"
        }
    );

    println!("\nControl Plane");
    if report.daemon.online {
        println!(
            "  readiness: {}",
            if report.daemon.ready == Some(true) {
                "READY"
            } else {
                "BLOCKED"
            }
        );
        if let Some(count) = report.daemon.registered_owner_count {
            let configured_projects = report.daemon.configured_projects.unwrap_or(0);
            let configured_advisors = report.daemon.configured_advisors.unwrap_or(0);
            println!(
                "  owners: {} registered ({} projects, {} advisors configured)",
                count, configured_projects, configured_advisors
            );
        }
        if let Some(max_workers) = report.daemon.max_workers {
            println!("  worker capacity: {} max", max_workers);
        }
        if let (Some(spent), Some(budget), Some(remaining)) = (
            report.daemon.cost_today_usd,
            report.daemon.daily_budget_usd,
            report.daemon.budget_remaining_usd,
        ) {
            let pct = if budget > 0.0 {
                (spent / budget * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };
            println!(
                "  budget: ${spent:.2} / ${budget:.2} used ({pct:.0}%), ${remaining:.2} remaining"
            );
        }
    } else {
        println!("  readiness: unavailable");
        if let Some(error) = &report.daemon.error {
            println!("  daemon: {error}");
        }
    }

    if !report.daemon.blocking_reasons.is_empty() {
        println!("\nBlocking");
        for reason in &report.daemon.blocking_reasons {
            println!("  - {reason}");
        }
    }
    if !report.daemon.warnings.is_empty() {
        println!("\nWarnings");
        for warning in &report.daemon.warnings {
            println!("  - {warning}");
        }
    }

    println!("\nProjects");
    if report.projects.is_empty() {
        println!("  (no projects selected)");
    } else {
        for project in &report.projects {
            let repo_state = if project.repo_present {
                "ok"
            } else {
                "missing"
            };
            let org_suffix = if project.org_hint.is_empty() {
                String::new()
            } else {
                format!(" {}", project.org_hint)
            };
            println!(
                "  {:<16} open={:<3} ready={:<3} blocked={:<3} active={:<3} critical={:<3} repo={} runtime={} model={}{}",
                project.name,
                project.open_quests,
                project.ready_quests,
                project.blocked_quests,
                project.in_progress_quests,
                project.critical_ready_quests,
                repo_state,
                project.runtime_provider,
                project.model,
                org_suffix,
            );
            if let Some(error) = &project.quest_store_error {
                println!("    quest-store-error: {error}");
                continue;
            }
            if project.stalled {
                println!("    state: stalled");
            }
            if !project.top_ready_quests.is_empty() {
                println!("    ready: {}", project.top_ready_quests.join(" | "));
            }
            if !project.top_blocked_quests.is_empty() {
                println!("    blocked: {}", project.top_blocked_quests.join(" | "));
            }
        }
    }

    println!("\nInterventions");
    for (index, action) in report.interventions.iter().enumerate() {
        println!("  {}. {}", index + 1, action);
    }
}

fn json_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(serde_json::Value::as_u64)
}

fn json_u64_nested(value: &serde_json::Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_u64()
}

fn string_array(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{DaemonMonitor, ProjectMonitor, build_interventions};

    #[test]
    fn monitor_interventions_prioritize_control_plane_failures() {
        let daemon = DaemonMonitor {
            online: false,
            blocking_reasons: vec![
                "daily budget exhausted ($50.00 spent of $50.00)".to_string(),
                "1 configured project(s) were skipped because their directories were missing"
                    .to_string(),
            ],
            ..DaemonMonitor::default()
        };
        let projects = vec![ProjectMonitor {
            name: "alpha".to_string(),
            repo: "/tmp/alpha".to_string(),
            repo_present: true,
            runtime_provider: "openrouter".to_string(),
            model: "x".to_string(),
            org_hint: String::new(),
            open_quests: 3,
            ready_quests: 0,
            blocked_quests: 2,
            in_progress_quests: 0,
            critical_ready_quests: 0,
            budget_blocked_quests: 1,
            stalled: true,
            top_ready_quests: Vec::new(),
            top_blocked_quests: vec!["aa-001 [high] unblock deploy".to_string()],
            quest_store_error: None,
        }];

        let interventions = build_interventions(&daemon, &projects);

        assert!(
            interventions
                .iter()
                .any(|item| item.contains("Daemon is offline"))
        );
        assert!(
            interventions
                .iter()
                .any(|item| item.contains("Daily budget is exhausted"))
        );
        assert!(
            interventions
                .iter()
                .any(|item| item.contains("alpha is stalled"))
        );
    }

    #[test]
    fn monitor_interventions_highlight_critical_ready_backlog() {
        let daemon = DaemonMonitor {
            online: true,
            ..DaemonMonitor::default()
        };
        let projects = vec![ProjectMonitor {
            name: "beta".to_string(),
            repo: "/tmp/beta".to_string(),
            repo_present: true,
            runtime_provider: "anthropic".to_string(),
            model: "claude".to_string(),
            org_hint: String::new(),
            open_quests: 4,
            ready_quests: 2,
            blocked_quests: 0,
            in_progress_quests: 0,
            critical_ready_quests: 1,
            budget_blocked_quests: 0,
            stalled: false,
            top_ready_quests: vec!["bb-001 [critical] ship release".to_string()],
            top_blocked_quests: Vec::new(),
            quest_store_error: None,
        }];

        let interventions = build_interventions(&daemon, &projects);

        assert_eq!(interventions.len(), 1);
        assert!(interventions[0].contains("critical ready quest"));
        assert!(interventions[0].contains("aeqi ready --company beta"));
    }

    #[test]
    fn monitor_interventions_fallback_when_clear() {
        let interventions = build_interventions(
            &DaemonMonitor {
                online: true,
                ..DaemonMonitor::default()
            },
            &[],
        );
        assert_eq!(interventions.len(), 1);
        assert!(interventions[0].contains("aeqi monitor --watch"));
    }
}
