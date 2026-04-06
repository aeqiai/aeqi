use anyhow::Result;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use crate::cli::NotesAction;
use crate::helpers::load_config;

/// Send an IPC request to the running daemon.
fn ipc_request(
    data_dir: &std::path::Path,
    request: &serde_json::Value,
) -> Result<serde_json::Value> {
    let sock_path = data_dir.join("rm.sock");
    let stream = std::os::unix::net::UnixStream::connect(&sock_path).map_err(|e| {
        anyhow::anyhow!("failed to connect to daemon IPC socket: {e}. Is the daemon running?")
    })?;
    let mut writer = io::BufWriter::new(&stream);
    let mut reader = io::BufReader::new(&stream);

    let mut req_bytes = serde_json::to_vec(request)?;
    req_bytes.push(b'\n');
    writer.write_all(&req_bytes)?;
    writer.flush()?;

    let mut line = String::new();
    reader.read_line(&mut line)?;
    let response: serde_json::Value = serde_json::from_str(&line)?;
    Ok(response)
}

pub(crate) async fn cmd_notes(config_path: &Option<PathBuf>, action: NotesAction) -> Result<()> {
    let (config, _) = load_config(config_path)?;
    let data_dir = config.data_dir();

    match action {
        NotesAction::List { company, limit } => {
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "notes",
                    "project": company,
                    "limit": limit,
                }),
            )?;
            let entries = resp.get("entries").and_then(|v| v.as_array());
            match entries {
                Some(entries) if entries.is_empty() => {
                    println!("No entries for project '{company}'.");
                }
                Some(entries) => {
                    for entry in entries {
                        let key = entry.get("key").and_then(|v| v.as_str()).unwrap_or("?");
                        let content = entry.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let agent = entry.get("agent").and_then(|v| v.as_str()).unwrap_or("?");
                        let created = entry
                            .get("created_at")
                            .and_then(|v| v.as_str())
                            .unwrap_or("?");
                        println!("[{created}] {key} by {agent} | {content}");
                    }
                }
                None => {
                    let error = resp
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown error");
                    eprintln!("Error: {error}");
                }
            }
        }
        NotesAction::Post {
            company,
            key,
            content,
            tags,
            durability: _,
        } => {
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "post_notes",
                    "project": company,
                    "key": key,
                    "content": content,
                    "tags": tags,
                    "agent": "cli",
                }),
            )?;
            if resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                let id = resp
                    .get("entry")
                    .and_then(|e| e.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                println!("Posted {key} (id: {id})");
            } else {
                let error = resp
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                eprintln!("Error: {error}");
            }
        }
        NotesAction::Query {
            company,
            tags,
            limit,
        } => {
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "notes",
                    "project": company,
                    "tags": tags,
                    "limit": limit,
                }),
            )?;
            let entries = resp.get("entries").and_then(|v| v.as_array());
            match entries {
                Some(entries) if entries.is_empty() => {
                    println!("No matching entries.");
                }
                Some(entries) => {
                    for entry in entries {
                        let key = entry.get("key").and_then(|v| v.as_str()).unwrap_or("?");
                        let content = entry.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let agent = entry.get("agent").and_then(|v| v.as_str()).unwrap_or("?");
                        println!("{key}: {content} (by {agent})");
                    }
                }
                None => {
                    let error = resp
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown error");
                    eprintln!("Error: {error}");
                }
            }
        }
        NotesAction::Get { company, key } => {
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "get_notes",
                    "project": company,
                    "key": key,
                }),
            )?;
            if let Some(entry) = resp.get("entry").filter(|v| !v.is_null()) {
                let key = entry.get("key").and_then(|v| v.as_str()).unwrap_or("?");
                let content = entry.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let agent = entry.get("agent").and_then(|v| v.as_str()).unwrap_or("?");
                println!("{key}: {content} (by {agent})");
            } else {
                println!("No entry found for key '{key}'.");
            }
        }
        NotesAction::Claim {
            company,
            resource,
            content,
            agent,
        } => {
            let agent = agent.as_deref().unwrap_or("cli");
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "claim_notes",
                    "project": company,
                    "resource": resource,
                    "content": content,
                    "agent": agent,
                }),
            )?;
            match resp.get("result").and_then(|v| v.as_str()) {
                Some("acquired") => println!("Claimed: {resource}"),
                Some("renewed") => println!("Renewed claim: {resource}"),
                Some("held") => {
                    let holder = resp.get("holder").and_then(|v| v.as_str()).unwrap_or("?");
                    let content = resp.get("content").and_then(|v| v.as_str()).unwrap_or("");
                    println!("Held by {holder}: {content}");
                }
                _ => {
                    let error = resp
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown error");
                    eprintln!("Error: {error}");
                }
            }
        }
        NotesAction::Release {
            company,
            resource,
            agent,
            force,
        } => {
            let agent = agent.as_deref().unwrap_or("cli");
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "release_notes",
                    "project": company,
                    "resource": resource,
                    "agent": agent,
                    "force": force,
                }),
            )?;
            if resp
                .get("released")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                println!("Released: {resource}");
            } else {
                println!("No claim found for '{resource}' (or not owned by {agent}).");
            }
        }
        NotesAction::Delete { company, key } => {
            let resp = ipc_request(
                &data_dir,
                &serde_json::json!({
                    "cmd": "delete_notes",
                    "project": company,
                    "key": key,
                }),
            )?;
            if resp
                .get("deleted")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                println!("Deleted: {key}");
            } else {
                println!("No entry found for key '{key}'.");
            }
        }
    }

    Ok(())
}
