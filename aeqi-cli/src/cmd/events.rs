//! Operator CLI for event handlers.
//!
//! `install-defaults` backfills the two standard schedule events
//! (`daily-digest`, `weekly-consolidate`) on every existing agent.
//! `AgentRegistry::install_default_scheduled_events` already runs per-agent
//! at spawn, but agents that predate that hook need this retroactive
//! installer. Dispatched via the daemon so writes go through the same
//! code path as the live runtime and the unique-name index enforces
//! idempotency across repeated runs.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::PathBuf;

use crate::cli::EventsAction;
use crate::helpers::{daemon_ipc_request, load_config, resolve_agents_dir};

pub(crate) async fn cmd_events(config_path: &Option<PathBuf>, action: EventsAction) -> Result<()> {
    match action {
        EventsAction::List { agent } => cmd_events_list(config_path, agent).await,
        EventsAction::InstallDefaults { agents, dry_run } => {
            cmd_events_install_defaults(config_path, agents, dry_run).await
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EventListRow {
    id: String,
    agent_id: Option<String>,
    agent_name: Option<String>,
    scope: String,
    name: String,
    pattern: String,
    enabled: bool,
    cooldown_secs: u64,
}

#[derive(Debug, Clone)]
struct AgentEventFilter {
    hint: String,
    local_agent_exists: bool,
}

async fn cmd_events_list(config_path: &Option<PathBuf>, agent: Option<String>) -> Result<()> {
    let rows = load_event_rows(config_path, agent.as_deref()).await?;
    if rows.is_empty() {
        if let Some(agent) = agent {
            println!("No event handlers found for agent '{agent}'.");
        } else {
            println!("No event handlers configured.");
        }
        return Ok(());
    }

    print!("{}", format_event_rows(&rows));
    Ok(())
}

async fn load_event_rows(
    config_path: &Option<PathBuf>,
    agent: Option<&str>,
) -> Result<Vec<EventListRow>> {
    let (config, config_path_resolved) = load_config(config_path)?;
    let db_path = config.data_dir().join("aeqi.db");
    if !db_path.exists() {
        return Ok(Vec::new());
    }

    let agent_filter = agent.map(|hint| AgentEventFilter {
        hint: hint.to_string(),
        local_agent_exists: local_agent_exists(&config, &config_path_resolved, hint),
    });
    tokio::task::spawn_blocking(move || load_event_rows_from_db(db_path, agent_filter))
        .await
        .context("event list query task failed")?
}

fn load_event_rows_from_db(
    db_path: PathBuf,
    agent: Option<AgentEventFilter>,
) -> Result<Vec<EventListRow>> {
    let conn = Connection::open(&db_path)
        .with_context(|| format!("failed to open event database at {}", db_path.display()))?;

    if !table_exists(&conn, "events")? {
        return Ok(Vec::new());
    }

    if let Some(agent_filter) = agent {
        let Some((agent_id, agent_name)) = resolve_agent(&conn, &agent_filter.hint)? else {
            if agent_filter.local_agent_exists {
                return load_global_event_rows(&conn);
            }
            anyhow::bail!("agent not found: {}", agent_filter.hint);
        };

        let mut stmt = conn.prepare(
            "SELECT e.id,
                    e.agent_id,
                    CASE WHEN e.agent_id = ?1 THEN ?2 ELSE NULL END AS agent_name,
                    e.scope,
                    e.name,
                    e.pattern,
                    e.enabled,
                    e.cooldown_secs
               FROM events e
              WHERE e.agent_id = ?1 OR e.agent_id IS NULL
              ORDER BY CASE WHEN e.agent_id IS NULL THEN 0 ELSE 1 END, e.name",
        )?;
        return read_event_rows(&mut stmt, params![agent_id, agent_name]);
    }

    let mut stmt = conn.prepare(
        "SELECT e.id,
                e.agent_id,
                a.name AS agent_name,
                e.scope,
                e.name,
                e.pattern,
                e.enabled,
                e.cooldown_secs
           FROM events e
           LEFT JOIN agents a ON a.id = e.agent_id
          ORDER BY COALESCE(a.name, '(global)'), e.name",
    )?;
    read_event_rows(&mut stmt, [])
}

fn load_global_event_rows(conn: &Connection) -> Result<Vec<EventListRow>> {
    let mut stmt = conn.prepare(
        "SELECT e.id,
                e.agent_id,
                NULL AS agent_name,
                e.scope,
                e.name,
                e.pattern,
                e.enabled,
                e.cooldown_secs
           FROM events e
          WHERE e.agent_id IS NULL
          ORDER BY e.name",
    )?;
    read_event_rows(&mut stmt, [])
}

fn local_agent_exists(
    config: &aeqi_core::config::AEQIConfig,
    config_path_resolved: &std::path::Path,
    hint: &str,
) -> bool {
    if config.agents.iter().any(|agent| agent.name == hint) {
        return true;
    }

    let agents_dir = resolve_agents_dir(config_path_resolved);
    aeqi_core::discover_agents(&agents_dir)
        .map(|agents| agents.iter().any(|agent| agent.name == hint))
        .unwrap_or(false)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    Ok(exists)
}

fn resolve_agent(conn: &Connection, hint: &str) -> Result<Option<(String, String)>> {
    if !table_exists(conn, "agents")? {
        return Ok(None);
    }

    let has_quest_prefix = column_exists(conn, "agents", "quest_prefix")?;
    let sql = if has_quest_prefix {
        "SELECT id, name
           FROM agents
          WHERE id = ?1 OR name = ?1 OR quest_prefix = ?1
          ORDER BY CASE WHEN id = ?1 THEN 0 WHEN name = ?1 THEN 1 ELSE 2 END
          LIMIT 1"
    } else {
        "SELECT id, name
           FROM agents
          WHERE id = ?1 OR name = ?1
          ORDER BY CASE WHEN id = ?1 THEN 0 ELSE 1 END
          LIMIT 1"
    };

    conn.query_row(sql, params![hint], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()
        .map_err(Into::into)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn read_event_rows<P>(stmt: &mut rusqlite::Statement<'_>, params: P) -> Result<Vec<EventListRow>>
where
    P: rusqlite::Params,
{
    let rows = stmt
        .query_map(params, |row| {
            Ok(EventListRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                agent_name: row.get(2)?,
                scope: row.get(3)?,
                name: row.get(4)?,
                pattern: row.get(5)?,
                enabled: row.get::<_, i64>(6)? != 0,
                cooldown_secs: row.get::<_, i64>(7)?.max(0) as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

impl EventListRow {
    fn status(&self) -> &'static str {
        if self.enabled { "enabled" } else { "disabled" }
    }

    fn agent_label(&self) -> String {
        self.agent_name
            .as_deref()
            .or(self.agent_id.as_deref())
            .unwrap_or("(global)")
            .to_string()
    }

    fn short_id(&self) -> &str {
        self.id.get(..8).unwrap_or(self.id.as_str())
    }
}

fn format_event_rows(rows: &[EventListRow]) -> String {
    let headers = [
        "STATUS", "SCOPE", "AGENT", "NAME", "PATTERN", "COOLDOWN", "ID",
    ];
    let mut widths = headers.map(str::len);

    let rendered: Vec<[String; 7]> = rows
        .iter()
        .map(|row| {
            [
                row.status().to_string(),
                row.scope.clone(),
                row.agent_label(),
                row.name.clone(),
                row.pattern.clone(),
                format!("{}s", row.cooldown_secs),
                row.short_id().to_string(),
            ]
        })
        .collect();

    for rendered_row in &rendered {
        for (idx, value) in rendered_row.iter().enumerate() {
            widths[idx] = widths[idx].max(value.len());
        }
    }

    let mut out = String::new();
    out.push_str(&format!(
        "{:<w0$}  {:<w1$}  {:<w2$}  {:<w3$}  {:<w4$}  {:>w5$}  {:<w6$}\n",
        headers[0],
        headers[1],
        headers[2],
        headers[3],
        headers[4],
        headers[5],
        headers[6],
        w0 = widths[0],
        w1 = widths[1],
        w2 = widths[2],
        w3 = widths[3],
        w4 = widths[4],
        w5 = widths[5],
        w6 = widths[6],
    ));
    out.push_str(&format!(
        "{}  {}  {}  {}  {}  {}  {}\n",
        "-".repeat(widths[0]),
        "-".repeat(widths[1]),
        "-".repeat(widths[2]),
        "-".repeat(widths[3]),
        "-".repeat(widths[4]),
        "-".repeat(widths[5]),
        "-".repeat(widths[6]),
    ));

    for row in rendered {
        out.push_str(&format!(
            "{:<w0$}  {:<w1$}  {:<w2$}  {:<w3$}  {:<w4$}  {:>w5$}  {:<w6$}\n",
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            row[6],
            w0 = widths[0],
            w1 = widths[1],
            w2 = widths[2],
            w3 = widths[3],
            w4 = widths[4],
            w5 = widths[5],
            w6 = widths[6],
        ));
    }

    out
}

async fn cmd_events_install_defaults(
    config_path: &Option<PathBuf>,
    agents: Vec<String>,
    dry_run: bool,
) -> Result<()> {
    let mut req = serde_json::json!({
        "cmd": "install_default_events",
        "dry_run": dry_run,
    });
    if !agents.is_empty() {
        req["agent_names"] = serde_json::Value::Array(
            agents
                .iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect(),
        );
    }

    let resp = daemon_ipc_request(config_path, &req).await?;

    if !resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        anyhow::bail!("install_default_events failed: {err}");
    }

    let installed = resp.get("installed").and_then(|v| v.as_u64()).unwrap_or(0);
    let skipped = resp
        .get("skipped_existing")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let targeted = resp.get("agents").and_then(|v| v.as_u64()).unwrap_or(0);

    let prefix = if dry_run { "[dry-run] " } else { "" };
    println!(
        "{prefix}install-defaults: {targeted} agent(s) targeted, {installed} event(s) installed, {skipped} already present",
    );

    // Per-agent detail, if the daemon returned a breakdown.
    if let Some(rows) = resp.get("details").and_then(|v| v.as_array()) {
        for row in rows {
            let name = row.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let created = row.get("installed").and_then(|v| v.as_u64()).unwrap_or(0);
            let skip = row
                .get("skipped_existing")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            println!("  {prefix}{name} ({id}): +{created} installed, {skip} existing");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{EventListRow, format_event_rows};

    #[test]
    fn format_event_rows_includes_enabled_and_disabled_status() {
        let rows = vec![
            EventListRow {
                id: "12345678-aaaa-bbbb-cccc-000000000000".to_string(),
                agent_id: None,
                agent_name: None,
                scope: "global".to_string(),
                name: "session-primer".to_string(),
                pattern: "session:start".to_string(),
                enabled: true,
                cooldown_secs: 0,
            },
            EventListRow {
                id: "abcdef12-aaaa-bbbb-cccc-000000000000".to_string(),
                agent_id: Some("agent-1".to_string()),
                agent_name: Some("shadow".to_string()),
                scope: "self".to_string(),
                name: "daily-digest".to_string(),
                pattern: "schedule:0 9 * * *".to_string(),
                enabled: false,
                cooldown_secs: 300,
            },
        ];

        let rendered = format_event_rows(&rows);

        assert!(rendered.contains("STATUS"));
        assert!(rendered.contains("enabled"));
        assert!(rendered.contains("disabled"));
        assert!(rendered.contains("(global)"));
        assert!(rendered.contains("shadow"));
        assert!(rendered.contains("12345678"));
        assert!(rendered.contains("abcdef12"));
    }
}
