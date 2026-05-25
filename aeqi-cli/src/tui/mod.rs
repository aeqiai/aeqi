//! AEQI Chat TUI — synthesized from CC + Hermes, built better in Rust.
//!
//! Architecture: inline-mode ratatui (NOT alternate screen). Output scrolls
//! naturally above a pinned bottom area with status bar + input.
//! Daemon client model: session survives TUI disconnect.

pub mod highlight;
pub mod markdown;
pub mod render;
pub mod state;

use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use aeqi_core::ChatStreamEvent;
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::terminal;

use crate::helpers::load_config;
use state::{AgentState, AgentVisual, AppState};

// ---------------------------------------------------------------------------
// WebSocket background thread
// ---------------------------------------------------------------------------

enum WsCommand {
    Send(String),
    Quit,
}

fn spawn_ws_thread(
    url: String,
    headers: Vec<(String, String)>,
    cmd_rx: mpsc::Receiver<WsCommand>,
    event_tx: mpsc::Sender<ChatStreamEvent>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use tungstenite::Message;
        use tungstenite::client::IntoClientRequest;
        use tungstenite::http::{HeaderName, HeaderValue};

        let mut request = match url.into_client_request() {
            Ok(request) => request,
            Err(e) => {
                let _ = event_tx.send(ChatStreamEvent::Error {
                    message: format!("WebSocket request failed: {e}"),
                    recoverable: false,
                });
                return;
            }
        };
        for (name, value) in headers {
            let name = match HeaderName::from_bytes(name.as_bytes()) {
                Ok(name) => name,
                Err(e) => {
                    let _ = event_tx.send(ChatStreamEvent::Error {
                        message: format!("WebSocket header failed: {e}"),
                        recoverable: false,
                    });
                    return;
                }
            };
            let value = match HeaderValue::from_str(&value) {
                Ok(value) => value,
                Err(e) => {
                    let _ = event_tx.send(ChatStreamEvent::Error {
                        message: format!("WebSocket header failed: {e}"),
                        recoverable: false,
                    });
                    return;
                }
            };
            request.headers_mut().insert(name, value);
        }

        let mut ws = match tungstenite::connect(request) {
            Ok((ws, _)) => ws,
            Err(e) => {
                let _ = event_tx.send(ChatStreamEvent::Error {
                    message: format!("WebSocket connect failed: {e}"),
                    recoverable: false,
                });
                return;
            }
        };

        if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = ws.get_ref() {
            tcp.set_nonblocking(true).ok();
        }

        loop {
            // Check outbound commands.
            match cmd_rx.try_recv() {
                Ok(WsCommand::Send(text)) => {
                    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = ws.get_ref() {
                        tcp.set_nonblocking(false).ok();
                    }
                    if ws.send(Message::Text(text.into())).is_err() {
                        break;
                    }
                    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = ws.get_ref() {
                        tcp.set_nonblocking(true).ok();
                    }
                }
                Ok(WsCommand::Quit) => break,
                Err(mpsc::TryRecvError::Disconnected) => break,
                Err(mpsc::TryRecvError::Empty) => {}
            }

            // Check inbound messages.
            match ws.read() {
                Ok(Message::Text(text)) => {
                    if let Ok(evt) = serde_json::from_str::<ChatStreamEvent>(&text)
                        && event_tx.send(evt).is_err()
                    {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(tungstenite::Error::Io(ref e)) if e.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                _ => {}
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

fn process_ws_event(state: &mut AppState, evt: ChatStreamEvent, stdout: &mut impl Write) {
    match evt {
        ChatStreamEvent::StepStart { model, .. } => {
            state.model = model;
            state.agent_state = AgentState::Thinking;
            state.open_response_box();
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
            // Start streaming line
            let _ = write!(stdout, "  ");
        }
        ChatStreamEvent::TextDelta { text } => {
            if state.agent_state == AgentState::Thinking {
                render::clear_thinking(stdout);
                state.agent_state = AgentState::Streaming;
            }
            state.append_streaming(&text);
            render::print_streaming_delta(stdout, &text);
        }
        ChatStreamEvent::ToolStart {
            tool_name,
            tool_use_id: _,
        } => {
            state.agent_state = AgentState::Working;
            // Newline after any streaming text.
            if !state.streaming_text.is_empty() {
                let _ = writeln!(stdout);
            }
            state.push_system(&format!("  ⚙ {tool_name}..."));
            let _ = writeln!(stdout, "  \x1b[90m⚙ {tool_name}...\x1b[0m");
        }
        ChatStreamEvent::ToolComplete {
            tool_name,
            success,
            duration_ms,
            output_preview,
            ..
        } => {
            let detail = if output_preview.len() > 60 {
                format!("{}...", &output_preview[..57])
            } else {
                output_preview
            };
            state.push_tool_activity(&tool_name, &detail, success, duration_ms);
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::StepComplete {
            prompt_tokens,
            completion_tokens,
            ..
        } => {
            state.tokens = prompt_tokens + completion_tokens;
            state.context_pct = context_pct(state.tokens, &state.model);
            state.steps += 1;
        }
        ChatStreamEvent::Complete {
            total_prompt_tokens,
            total_completion_tokens,
            cost_usd,
            ..
        } => {
            // Finalize: newline after streaming, close response box.
            if !state.streaming_text.is_empty() {
                let _ = writeln!(stdout);
            }
            state.close_response_box();
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);

            state.tokens = total_prompt_tokens + total_completion_tokens;
            state.context_pct = context_pct(state.tokens, &state.model);
            state.cost = cost_usd;
            state.agent_state = AgentState::Idle;
        }
        ChatStreamEvent::Status { message } => {
            state.push_system(&message);
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::Error { message, .. } => {
            state.push_error(&message);
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::Compacted {
            original_messages,
            remaining_messages,
            ..
        } => {
            state.push_system(&format!(
                "♻ Compacted {original_messages} → {remaining_messages} messages"
            ));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::DelegateStart {
            worker_name,
            task_subject,
        } => {
            state.push_system(&format!("→ Delegating to {worker_name}: {task_subject}"));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::DelegateComplete {
            worker_name,
            outcome,
        } => {
            state.push_system(&format!("← {worker_name}: {outcome}"));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::IdeaActivity {
            action,
            name,
            preview,
        } => {
            let icon = if action == "recalled" { "📖" } else { "💾" };
            let short = if preview.len() > 60 {
                format!("{}...", &preview[..57])
            } else {
                preview
            };
            state.push_system(&format!("{icon} {action} [{name}]: {short}"));
        }
        ChatStreamEvent::Tombstone { reason, .. } => {
            // Discard partial output from a failed streaming attempt.
            if !state.streaming_text.is_empty() {
                let _ = writeln!(stdout);
                state.streaming_text.clear();
            }
            state.push_system(&format!("↺ Retrying: {reason}"));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
            state.agent_state = AgentState::Thinking;
        }
        ChatStreamEvent::ToolProgress { .. } => {
            // Show spinner during tool execution.
            render::print_thinking(stdout, state);
        }
        ChatStreamEvent::EventFired {
            event_name,
            pattern,
            ..
        } => {
            let label = if event_name.is_empty() {
                pattern
            } else {
                event_name
            };
            state.push_system(&format!("event {label} fired"));
        }
        ChatStreamEvent::FileChanged {
            path,
            operation,
            bytes,
            ..
        } => {
            let op = match operation {
                aeqi_core::chat_stream::FileOperation::Created => "created",
                aeqi_core::chat_stream::FileOperation::Modified => "edited",
            };
            let short_path = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&path);
            state.push_system(&format!("{op} {short_path} ({bytes}B)"));
        }
        ChatStreamEvent::FileDeleted { path, .. } => {
            let short_path = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&path);
            state.push_system(&format!("deleted {short_path}"));
        }
        ChatStreamEvent::ToolSummarized {
            tool_name,
            original_bytes,
            summary,
            ..
        } => {
            let short = if summary.len() > 60 {
                format!("{}...", &summary[..57])
            } else {
                summary
            };
            state.push_system(&format!(
                "{tool_name} output summarized ({original_bytes}B): {short}"
            ));
        }
        ChatStreamEvent::SnipCompacted { tokens_freed } => {
            state.push_system(&format!("✂ snip: freed ~{tokens_freed} tokens"));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::MicroCompacted { cleared } => {
            state.push_system(&format!(
                "✂ microcompact: cleared {cleared} old tool result(s)"
            ));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::ContextCollapsed { tokens_freed } => {
            state.push_system(&format!("✂ collapse: freed ~{tokens_freed} tokens"));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
        ChatStreamEvent::UserInjected {
            text, after_step, ..
        } => {
            let preview: String = text.chars().take(60).collect();
            state.push_system(&format!("↩ user (after step {after_step}): {preview}"));
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
    }
}

/// Compute the percentage of a model's context window used by `tokens`.
/// Returns 0 if the model isn't set yet or lookup fails.
fn context_pct(tokens: u32, model: &str) -> u32 {
    if model.is_empty() {
        return 0;
    }
    let window = aeqi_providers::context_window_for_model(model);
    if window == 0 {
        return 0;
    }
    ((tokens as u64 * 100 / window as u64).min(100)) as u32
}

// ---------------------------------------------------------------------------
// Slash command handling
// ---------------------------------------------------------------------------

fn handle_slash_command(
    cmd: &str,
    state: &mut AppState,
    stdout: &mut impl Write,
    cmd_tx: &mpsc::Sender<WsCommand>,
) -> bool {
    let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
    let command = parts[0].trim_start_matches('/');
    let _args = parts.get(1).unwrap_or(&"");

    match command {
        "exit" | "quit" | "q" => {
            state.should_quit = true;
            return true;
        }
        "new" | "reset" => {
            state.messages.clear();
            state.streaming_text.clear();
            state.tokens = 0;
            state.context_pct = 0;
            state.cost = 0.0;
            state.steps = 0;
            state.start_time = std::time::Instant::now();
            let _ = writeln!(stdout, "\n  \x1b[90m✦ New conversation\x1b[0m\n");
        }
        "status" => {
            let face = state.agent.face("idle");
            let _ = writeln!(
                stdout,
                "\n  {face} {} | {} | {} tokens | {} steps | {} | {}\n",
                state.agent.name,
                state.model,
                render::format_number(state.tokens),
                state.steps,
                if state.cost > 0.0 {
                    format!("${:.4}", state.cost)
                } else {
                    "$0".to_string()
                },
                state.elapsed_str(),
            );
        }
        "model" => {
            let _ = writeln!(
                stdout,
                "\n  Current model: {}\n",
                if state.model.is_empty() {
                    "(not set)"
                } else {
                    &state.model
                }
            );
        }
        "help" => {
            let _ = writeln!(stdout, "\n  \x1b[1mSlash Commands\x1b[0m");
            let _ = writeln!(stdout, "  /new      — start fresh conversation");
            let _ = writeln!(stdout, "  /status   — show session stats");
            let _ = writeln!(stdout, "  /model    — show current model");
            let _ = writeln!(stdout, "  /help     — this message");
            let _ = writeln!(stdout, "  /exit     — quit\n");
        }
        _ => {
            // Unknown slash command — send to agent as a regular message.
            let mut msg = serde_json::json!({
                "message": cmd,
                "agent_id": state.agent_id,
                "project": state.project,
            });
            if let Some(ref role_id) = state.acting_role_id {
                msg["as_role_id"] = serde_json::json!(role_id);
            }
            let _ = cmd_tx.send(WsCommand::Send(msg.to_string()));
            state.push_user(cmd);
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Platform account-key chat
// ---------------------------------------------------------------------------

async fn platform_get_json(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &str,
    path: &str,
    trust_id: Option<&str>,
) -> Result<serde_json::Value> {
    let url = format!(
        "{}/{}",
        api_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    let mut request = client.get(url).bearer_auth(api_key);
    if let Some(trust_id) = trust_id {
        request = request
            .header("x-trust", trust_id)
            .header("x-entity", trust_id);
    }
    let response = request.send().await?.error_for_status()?;
    Ok(response.json().await?)
}

fn json_label(value: &serde_json::Value, keys: &[&str], fallback: &str) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn choose_json_item<'a>(
    title: &str,
    items: &'a [serde_json::Value],
    label_keys: &[&str],
) -> Result<Option<&'a serde_json::Value>> {
    if items.is_empty() {
        return Ok(None);
    }
    if items.len() == 1 {
        return Ok(items.first());
    }

    eprintln!();
    eprintln!("  \x1b[1m{title}:\x1b[0m");
    for (i, item) in items.iter().enumerate() {
        let label = json_label(item, label_keys, "(unnamed)");
        let id = item
            .get("id")
            .or_else(|| item.get("trust_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if id.is_empty() {
            eprintln!("    \x1b[36m{}\x1b[0m. {label}", i + 1);
        } else {
            eprintln!("    \x1b[36m{}\x1b[0m. {label} \x1b[90m{id}\x1b[0m", i + 1);
        }
    }
    eprintln!();
    eprint!("  Choose [1]: ");
    io::stderr().flush()?;

    let mut choice = String::new();
    io::stdin().read_line(&mut choice)?;
    let choice = choice.trim();
    let idx = if choice.is_empty() {
        0
    } else if let Ok(n) = choice.parse::<usize>() {
        n.saturating_sub(1).min(items.len() - 1)
    } else {
        items
            .iter()
            .position(|item| {
                item.get("id")
                    .or_else(|| item.get("trust_id"))
                    .and_then(|v| v.as_str())
                    .map(|id| id == choice)
                    .unwrap_or(false)
                    || json_label(item, label_keys, "").eq_ignore_ascii_case(choice)
            })
            .unwrap_or(0)
    };
    Ok(items.get(idx))
}

fn websocket_url(api_url: &str, trust_id: &str) -> String {
    let mut base = api_url.trim_end_matches('/').to_string();
    if let Some(rest) = base.strip_prefix("https://") {
        base = format!("wss://{rest}");
    } else if let Some(rest) = base.strip_prefix("http://") {
        base = format!("ws://{rest}");
    }
    format!(
        "{base}/api/chat/stream?trust_id={}",
        urlencoding::encode(trust_id)
    )
}

async fn run_remote_chat(
    api_url: String,
    api_key: String,
    agent_name: Option<&str>,
    project: Option<&str>,
    entity: Option<&str>,
    role: Option<&str>,
) -> Result<()> {
    let client = reqwest::Client::new();

    let entities_json = platform_get_json(&client, &api_url, &api_key, "/api/entities", None)
        .await
        .context("list platform companies")?;
    let entities = entities_json
        .get("entities")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let trust_id = if let Some(entity) = entity {
        entity.to_string()
    } else {
        let selected = choose_json_item("Companies", &entities, &["display_name", "name"])?
            .context("no companies available for this account")?;
        selected
            .get("id")
            .or_else(|| selected.get("trust_id"))
            .and_then(|v| v.as_str())
            .context("selected company has no id")?
            .to_string()
    };

    let me_json = platform_get_json(&client, &api_url, &api_key, "/api/auth/me", None)
        .await
        .ok();
    let user_id = me_json
        .as_ref()
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let roles_path = format!("/api/roles?trust_id={}", urlencoding::encode(&trust_id));
    let roles_json = platform_get_json(&client, &api_url, &api_key, &roles_path, Some(&trust_id))
        .await
        .unwrap_or_else(|_| serde_json::json!({"roles": []}));
    let mut roles = roles_json
        .get("roles")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if let Some(ref uid) = user_id {
        let personal = roles
            .iter()
            .filter(|role| {
                role.get("occupant_kind").and_then(|v| v.as_str()) == Some("human")
                    && role.get("occupant_id").and_then(|v| v.as_str()) == Some(uid.as_str())
            })
            .cloned()
            .collect::<Vec<_>>();
        if !personal.is_empty() {
            roles = personal;
        }
    }
    let acting_role_id = if let Some(role) = role {
        Some(role.to_string())
    } else {
        choose_json_item("Acting roles", &roles, &["occupant_name", "title", "name"])?
            .and_then(|selected| selected.get("id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
    };

    let agents_path = format!("/api/agents?trust_id={}", urlencoding::encode(&trust_id));
    let agents_json = platform_get_json(&client, &api_url, &api_key, &agents_path, Some(&trust_id))
        .await
        .context("list platform agents")?;
    let agents_all = agents_json
        .get("agents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut agents = agents_all
        .iter()
        .filter(|agent| agent.get("status").and_then(|v| v.as_str()) == Some("active"))
        .cloned()
        .collect::<Vec<_>>();
    if agents.is_empty() {
        agents = agents_all;
    }

    let selected_agent = if let Some(name) = agent_name {
        agents
            .iter()
            .find(|agent| {
                agent.get("id").and_then(|v| v.as_str()) == Some(name)
                    || agent.get("name").and_then(|v| v.as_str()) == Some(name)
            })
            .with_context(|| format!("agent not found in selected company: {name}"))?
    } else {
        choose_json_item("Agents", &agents, &["name"])?.context("no agents available")?
    };

    let agent_id = selected_agent
        .get("id")
        .and_then(|v| v.as_str())
        .context("selected agent has no id")?
        .to_string();
    let name = json_label(selected_agent, &["name"], "Assistant");
    let color = selected_agent
        .get("color")
        .and_then(|v| v.as_str())
        .map(AgentVisual::parse_hex_color)
        .unwrap_or((72, 202, 228));
    let avatar = selected_agent
        .get("avatar")
        .and_then(|v| v.as_str())
        .unwrap_or("◆")
        .to_string();
    let faces = selected_agent
        .get("faces")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let visual = AgentVisual {
        name,
        color,
        avatar,
        faces,
    };

    let (event_tx, event_rx) = mpsc::channel::<ChatStreamEvent>();
    let (cmd_tx, cmd_rx) = mpsc::channel::<WsCommand>();
    let ws_handle = Some(spawn_ws_thread(
        websocket_url(&api_url, &trust_id),
        vec![("authorization".to_string(), format!("Bearer {api_key}"))],
        cmd_rx,
        event_tx,
    ));
    eprintln!("  \x1b[90m(connected to {api_url}, company {trust_id})\x1b[0m");
    if let Some(ref role_id) = acting_role_id {
        eprintln!("  \x1b[90m(acting role: {role_id})\x1b[0m");
    }

    run_tui_loop(
        visual,
        Some(agent_id),
        acting_role_id,
        project.map(|s| s.to_string()),
        cmd_tx,
        event_rx,
        ws_handle,
    )
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Interactive chat TUI — the aeqi chat experience.
pub async fn run(
    config_path: &Option<PathBuf>,
    agent_name: Option<&str>,
    project: Option<&str>,
    api_url: Option<&str>,
    api_key: Option<&str>,
    entity: Option<&str>,
    role: Option<&str>,
) -> Result<()> {
    let remote_api_key = api_key
        .map(str::to_string)
        .or_else(|| std::env::var("AEQI_API_KEY").ok())
        .filter(|s| !s.trim().is_empty());
    if let Some(remote_api_key) = remote_api_key {
        let remote_api_url = api_url
            .map(str::to_string)
            .or_else(|| std::env::var("AEQI_API_URL").ok())
            .unwrap_or_else(|| "https://app.aeqi.ai".to_string());
        return run_remote_chat(
            remote_api_url,
            remote_api_key,
            agent_name,
            project,
            entity,
            role,
        )
        .await;
    }

    let (config, _) = load_config(config_path)?;
    let data_dir = config.data_dir();

    // Resolve persistent agent.
    let registry = aeqi_orchestrator::agent_registry::AgentRegistry::open(&data_dir)?;
    let mut agent: Option<aeqi_orchestrator::agent_registry::Agent> = if let Some(name) = agent_name
    {
        // Explicit --agent flag → resolve by name.
        registry.get_active_by_name(name).await?
    } else {
        // No flag → check how many active agents exist.
        let active = registry.list_active().await.unwrap_or_default();
        match active.len() {
            0 => None,                                     // Will trigger spawn prompt below.
            1 => Some(active.into_iter().next().unwrap()), // Only one → use it.
            _ => {
                // Multiple agents → interactive picker.
                eprintln!();
                eprintln!("  \x1b[1mYour agents:\x1b[0m");
                for (i, a) in active.iter().enumerate() {
                    let display = &a.name;
                    let avatar = a.avatar.as_deref().unwrap_or("●");
                    let last = a
                        .last_active
                        .map(|t| {
                            let ago = (chrono::Utc::now() - t).num_hours();
                            if ago < 1 {
                                "just now".to_string()
                            } else if ago < 24 {
                                format!("{ago}h ago")
                            } else {
                                format!("{}d ago", ago / 24)
                            }
                        })
                        .unwrap_or_else(|| "never".to_string());
                    let sessions = a.session_count;
                    eprintln!(
                        "    \x1b[36m{}\x1b[0m. {avatar} {display:<16} (last: {last}, {sessions} sessions)",
                        i + 1
                    );
                }
                eprintln!();
                let default_name = &active[0].name;
                eprint!("  Chat with? [1={default_name}]: ");
                io::stderr().flush()?;

                let mut choice = String::new();
                io::stdin().read_line(&mut choice)?;
                let choice = choice.trim();

                let idx = if choice.is_empty() {
                    0
                } else if let Ok(n) = choice.parse::<usize>() {
                    n.saturating_sub(1).min(active.len() - 1)
                } else {
                    // Try name match.
                    active.iter().position(|a| a.name == choice).unwrap_or(0)
                };
                Some(active.into_iter().nth(idx).unwrap())
            }
        }
    };

    // No agents exist → prompt for a name and spawn a bare persistent agent.
    // Persona content (identity, instructions, memories) is added afterwards
    // as ideas tagged `identity`/`evergreen`. For a pre-threaded multi-agent
    // company, use `aeqi template spawn <slug>` instead.
    if agent.is_none() {
        eprintln!();
        eprintln!("  \x1b[1mNo agent found.\x1b[0m");
        eprintln!();
        eprintln!("  AEQI uses persistent agents — they remember you across sessions.");
        eprintln!("  Spawn one to get started, or run `aeqi template spawn <slug>` for");
        eprintln!("  a pre-threaded company.");
        eprintln!();

        eprint!("  Name for the new agent: ");
        io::stderr().flush()?;

        let mut name = String::new();
        io::stdin().read_line(&mut name)?;
        let name = name.trim();
        if name.is_empty() {
            eprintln!("  No name given. Run `aeqi agent spawn <name>` manually.");
            return Ok(());
        }

        match registry.spawn(name, project, None).await {
            Ok(spawned) => {
                let display = &spawned.name;
                eprintln!();
                eprintln!(
                    "  \x1b[32m✓ Spawned {display}\x1b[0m (id: {})",
                    &spawned.id[..8]
                );
                eprintln!("  Entity memory will accumulate across sessions.");
                eprintln!();
                agent = Some(spawned);
            }
            Err(e) => {
                eprintln!("  \x1b[31m✗ Failed to spawn {name}: {e}\x1b[0m");
                return Ok(());
            }
        }
    }

    let visual = match &agent {
        Some(a) => {
            let color = a
                .color
                .as_ref()
                .map(|c| AgentVisual::parse_hex_color(c))
                .unwrap_or((255, 215, 0));
            let mut faces = std::collections::HashMap::new();
            if let Some(ref f) = a.faces {
                faces = f.clone();
            }
            AgentVisual {
                name: a.name.clone(),
                color,
                avatar: a.avatar.clone().unwrap_or_else(|| "⚕".into()),
                faces,
            }
        }
        None => AgentVisual::default_agent(),
    };

    let agent_id = agent.as_ref().map(|a| a.id.clone());
    let agent_record = agent.clone();

    // Decide mode: daemon (WebSocket) or direct (in-process agent loop).
    let daemon_running = is_daemon_running(&config);

    let (event_tx, event_rx) = mpsc::channel::<ChatStreamEvent>();
    let (cmd_tx, cmd_rx) = mpsc::channel::<WsCommand>();
    let mut ws_handle: Option<std::thread::JoinHandle<()>> = None;
    if daemon_running {
        // Daemon mode: connect via WebSocket.
        let bind = &config.web.bind;
        let port = bind
            .rsplit(':')
            .next()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(8400);
        let ws_url = format!("ws://127.0.0.1:{port}/api/chat/stream");
        ws_handle = Some(spawn_ws_thread(
            ws_url,
            Vec::new(),
            cmd_rx,
            event_tx.clone(),
        ));
        eprintln!("  \x1b[90m(connected to daemon)\x1b[0m");
    } else {
        // Direct mode: run a single greeting turn in-process.
        // Multi-turn chat requires the daemon — start it with `aeqi start`.
        eprintln!("  \x1b[90m(direct mode — no daemon; start daemon for multi-turn chat)\x1b[0m");
        if let Err(e) = spawn_direct_agent(&config, agent_record.as_ref(), event_tx.clone()) {
            eprintln!("  \x1b[31m✗ Failed to start agent: {e}\x1b[0m");
            return Ok(());
        }
        // Drain cmd_rx in a background thread so senders don't block.
        std::thread::spawn(move || {
            while let Ok(cmd) = cmd_rx.recv() {
                if matches!(cmd, WsCommand::Quit) {
                    break;
                }
            }
        });
    }

    run_tui_loop(
        visual,
        agent_id,
        None,
        project.map(|s| s.to_string()),
        cmd_tx,
        event_rx,
        ws_handle,
    )
}

fn run_tui_loop(
    visual: AgentVisual,
    agent_id: Option<String>,
    acting_role_id: Option<String>,
    project: Option<String>,
    cmd_tx: mpsc::Sender<WsCommand>,
    event_rx: mpsc::Receiver<ChatStreamEvent>,
    ws_handle: Option<std::thread::JoinHandle<()>>,
) -> Result<()> {
    // Enter raw mode for input handling (NOT alternate screen).
    terminal::enable_raw_mode()?;
    let mut stdout = io::stdout();

    // Print banner.
    let (r, g, b) = visual.color;
    let face = visual.face("greeting");
    eprintln!();
    let _ = writeln!(
        stdout,
        "\r  \x1b[38;2;{r};{g};{b};1m{face} {}\x1b[0m",
        visual.name,
    );
    let _ = writeln!(
        stdout,
        "\r  \x1b[90mtype /help for commands, /exit to quit\x1b[0m\n"
    );
    stdout.flush()?;

    // Set up ratatui for the bottom area only.
    // We use a small viewport at the bottom of the terminal.
    let backend = ratatui::backend::CrosstermBackend::new(io::stderr());
    let mut term = ratatui::Terminal::with_options(
        backend,
        ratatui::TerminalOptions {
            viewport: ratatui::Viewport::Inline(4), // 4 rows: status bar (1) + input (3)
        },
    )?;

    let mut state = AppState::new(visual);
    state.agent_id = agent_id;
    state.acting_role_id = acting_role_id;
    state.project = project;

    // Main event loop.
    loop {
        // Draw the pinned bottom area.
        term.draw(|f| render::draw_bottom(f, f.area(), &state))?;

        // Drain WebSocket events.
        while let Ok(evt) = event_rx.try_recv() {
            process_ws_event(&mut state, evt, &mut stdout);
        }

        // Show thinking indicator during agent work.
        if matches!(
            state.agent_state,
            AgentState::Thinking | AgentState::Working
        ) {
            render::print_thinking(&mut stdout, &state);
        }

        // Poll crossterm events.
        if event::poll(Duration::from_millis(80))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        if state.agent_state != AgentState::Idle {
                            // Interrupt the agent (not quit).
                            state.push_system("⏹ Interrupted");
                            let _ = writeln!(stdout, "\r  \x1b[33m⏹ Interrupted\x1b[0m");
                            state.agent_state = AgentState::Idle;
                        } else {
                            state.should_quit = true;
                        }
                    }
                    KeyCode::Esc => {
                        state.should_quit = true;
                    }
                    KeyCode::Enter => {
                        let text = state.input.trim().to_string();
                        if !text.is_empty() {
                            state.input.clear();
                            state.cursor_pos = 0;

                            if text.starts_with('/') {
                                handle_slash_command(&text, &mut state, &mut stdout, &cmd_tx);
                            } else {
                                state.push_user(&text);
                                render::print_message(
                                    &mut stdout,
                                    state.messages.last().unwrap(),
                                    &state,
                                    80,
                                );

                                let mut msg = serde_json::json!({
                                    "message": text,
                                    "agent_id": state.agent_id,
                                    "project": state.project,
                                });
                                if let Some(ref role_id) = state.acting_role_id {
                                    msg["as_role_id"] = serde_json::json!(role_id);
                                }
                                let _ = cmd_tx.send(WsCommand::Send(msg.to_string()));
                            }
                        }
                    }
                    KeyCode::Backspace => {
                        if state.cursor_pos > 0 {
                            state.cursor_pos -= 1;
                            state.input.remove(state.cursor_pos);
                        }
                    }
                    KeyCode::Left => {
                        state.cursor_pos = state.cursor_pos.saturating_sub(1);
                    }
                    KeyCode::Right => {
                        if state.cursor_pos < state.input.len() {
                            state.cursor_pos += 1;
                        }
                    }
                    KeyCode::Up => {
                        state.history_up();
                    }
                    KeyCode::Down => {
                        state.history_down();
                    }
                    KeyCode::Home => {
                        state.cursor_pos = 0;
                    }
                    KeyCode::End => {
                        state.cursor_pos = state.input.len();
                    }
                    KeyCode::Char(c) => {
                        state.input.insert(state.cursor_pos, c);
                        state.cursor_pos += 1;
                    }
                    _ => {}
                }
            }
        }

        // Advance spinner.
        state.tick += 1;

        if state.should_quit {
            break;
        }
    }

    // Cleanup.
    let _ = cmd_tx.send(WsCommand::Quit);
    term.clear()?;
    terminal::disable_raw_mode()?;
    if let Some(handle) = ws_handle {
        let _ = handle.join();
    }

    let face = state.agent.face("idle");
    eprintln!("\n  \x1b[90m{face} goodbye\x1b[0m\n");

    Ok(())
}

// ---------------------------------------------------------------------------
// Direct mode — in-process agent loop
// ---------------------------------------------------------------------------

/// Check if the daemon is running by testing the IPC socket.
fn is_daemon_running(config: &aeqi_core::AEQIConfig) -> bool {
    let sock_path = config.data_dir().join("rm.sock");
    std::os::unix::net::UnixStream::connect(&sock_path).is_ok()
}

/// Spawn a single-greeting agent turn directly in-process (no daemon).
/// Multi-turn chat requires the daemon.
fn spawn_direct_agent(
    config: &aeqi_core::AEQIConfig,
    agent_record: Option<&aeqi_orchestrator::agent_registry::Agent>,
    event_tx: mpsc::Sender<ChatStreamEvent>,
) -> Result<()> {
    use crate::helpers::{build_provider_for_runtime, build_tools};
    use aeqi_core::traits::LogObserver;
    use aeqi_core::{Agent, AgentConfig, ProviderKind};

    // Build provider from config.
    let model_override = agent_record.and_then(|a| a.model.as_deref());
    let provider = build_provider_for_runtime(config, ProviderKind::OpenRouter, model_override)?;

    // Build tools with cwd.
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let tools = build_tools(&cwd);

    // Build system prompt from agent record.
    let system_prompt = "You are a helpful AI agent.".to_string();

    // Agent config.
    let model = agent_record
        .and_then(|a| a.model.as_deref())
        .unwrap_or("stepfun/step-3.5-flash:free")
        .to_string();

    let agent_config = AgentConfig {
        model,
        max_iterations: 10,
        name: agent_record
            .map(|a| a.name.clone())
            .unwrap_or_else(|| "shadow".into()),
        agent_id: agent_record.map(|a| a.id.clone()),
        ancestor_ids: Vec::new(),
        session_file: agent_record.map(|a| {
            config
                .data_dir()
                .join("sessions")
                .join(format!("{}.json", a.id))
        }),
        ..Default::default()
    };

    let observer: std::sync::Arc<dyn aeqi_core::traits::Observer> =
        std::sync::Arc::new(LogObserver);

    let mut agent = Agent::new(agent_config, provider, tools, observer, system_prompt);

    // Chat stream sender for TUI events.
    let (stream_sender, mut stream_rx) = aeqi_core::ChatStreamSender::new(64);
    agent = agent.with_chat_stream(stream_sender);

    // Bridge: ChatStreamEvent from agent → event_tx for TUI.
    tokio::spawn(async move {
        while let Ok(evt) = stream_rx.recv().await {
            if event_tx.send(evt).is_err() {
                break;
            }
        }
    });

    // Spawn the single greeting turn.
    tokio::spawn(async move {
        match agent
            .run("The user just connected. Greet them briefly.")
            .await
        {
            Ok(result) => {
                tracing::info!(
                    stop = ?result.stop_reason,
                    iterations = result.iterations,
                    "direct agent greeting completed"
                );
            }
            Err(e) => {
                tracing::error!("direct agent error: {e}");
            }
        }
    });

    Ok(())
}
