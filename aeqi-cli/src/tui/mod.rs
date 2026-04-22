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
use anyhow::Result;
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
    cmd_rx: mpsc::Receiver<WsCommand>,
    event_tx: mpsc::Sender<ChatStreamEvent>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use tungstenite::Message;

        let mut ws = match tungstenite::connect(&url) {
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
            idea_ids,
            ..
        } => {
            let label = if event_name.is_empty() {
                pattern
            } else {
                event_name
            };
            state.push_system(&format!("event {label} → {} idea(s)", idea_ids.len()));
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
                state.agent.display_name,
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
            let msg = serde_json::json!({
                "message": cmd,
                "agent_id": state.agent_id,
                "project": state.project,
            });
            let _ = cmd_tx.send(WsCommand::Send(msg.to_string()));
            state.push_user(cmd);
            render::print_message(stdout, state.messages.last().unwrap(), state, 80);
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Interactive chat TUI — the aeqi chat experience.
pub async fn run(
    config_path: &Option<PathBuf>,
    agent_name: Option<&str>,
    project: Option<&str>,
) -> Result<()> {
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
                    let display = a.display_name.as_deref().unwrap_or(&a.name);
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
                let default_name = active[0].display_name.as_deref().unwrap_or(&active[0].name);
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
                    active
                        .iter()
                        .position(|a| {
                            a.name == choice
                                || a.display_name
                                    .as_deref()
                                    .is_some_and(|d| d.eq_ignore_ascii_case(choice))
                        })
                        .unwrap_or(0)
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

        match registry.spawn(name, None, project, None).await {
            Ok(spawned) => {
                let display = spawned.display_name.as_deref().unwrap_or(&spawned.name);
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
                display_name: a.display_name.as_deref().unwrap_or(&a.name).to_string(),
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
    let mut _direct_input_tx: Option<tokio::sync::mpsc::UnboundedSender<aeqi_core::SessionInput>> =
        None;

    if daemon_running {
        // Daemon mode: connect via WebSocket.
        let bind = &config.web.bind;
        let port = bind
            .rsplit(':')
            .next()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(8400);
        let ws_url = format!("ws://127.0.0.1:{port}/api/chat/stream");
        ws_handle = Some(spawn_ws_thread(ws_url, cmd_rx, event_tx.clone()));
        eprintln!("  \x1b[90m(connected to daemon)\x1b[0m");
    } else {
        // Direct mode: run agent loop in-process.
        eprintln!("  \x1b[90m(direct mode — no daemon)\x1b[0m");
        let direct_result = spawn_direct_agent(&config, agent_record.as_ref(), event_tx.clone());
        match direct_result {
            Ok((input_tx, _join)) => {
                _direct_input_tx = Some(input_tx.clone());
                // Bridge: WsCommand::Send → parse message → push to input_tx
                let input_tx_for_bridge = input_tx;
                std::thread::spawn(move || {
                    while let Ok(cmd) = cmd_rx.recv() {
                        match cmd {
                            WsCommand::Send(json) => {
                                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json)
                                {
                                    if let Some(msg) =
                                        parsed.get("message").and_then(|v| v.as_str())
                                    {
                                        let _ = input_tx_for_bridge
                                            .send(aeqi_core::SessionInput::text(msg));
                                    }
                                }
                            }
                            WsCommand::Quit => break,
                        }
                    }
                });
            }
            Err(e) => {
                eprintln!("  \x1b[31m✗ Failed to start agent: {e}\x1b[0m");
                return Ok(());
            }
        }
    }

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
        visual.display_name,
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
    state.project = project.map(|s| s.to_string());

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

                                let msg = serde_json::json!({
                                    "message": text,
                                    "agent_id": state.agent_id,
                                    "project": state.project,
                                });
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

/// Spawn the agent loop directly in-process (no daemon).
/// Returns a sender for pushing messages + a join handle.
fn spawn_direct_agent(
    config: &aeqi_core::AEQIConfig,
    agent_record: Option<&aeqi_orchestrator::agent_registry::Agent>,
    event_tx: mpsc::Sender<ChatStreamEvent>,
) -> Result<(
    tokio::sync::mpsc::UnboundedSender<aeqi_core::SessionInput>,
    tokio::task::JoinHandle<()>,
)> {
    use crate::helpers::{build_provider_for_runtime, build_tools};
    use aeqi_core::traits::LogObserver;
    use aeqi_core::{Agent, AgentConfig, ProviderKind, SessionType};

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
        max_iterations: 90,
        name: agent_record
            .map(|a| a.name.clone())
            .unwrap_or_else(|| "shadow".into()),
        agent_id: agent_record.map(|a| a.id.clone()),
        ancestor_ids: Vec::new(),
        session_type: SessionType::Perpetual,
        session_file: agent_record.map(|a| {
            config
                .data_dir()
                .join("sessions")
                .join(format!("{}.json", a.id))
        }),
        ..Default::default()
    };

    // Build agent with perpetual input channel.
    let observer: std::sync::Arc<dyn aeqi_core::traits::Observer> =
        std::sync::Arc::new(LogObserver);

    let mut agent = Agent::new(agent_config, provider, tools, observer, system_prompt);

    // Chat stream sender for TUI events.
    let (stream_sender, mut stream_rx) = aeqi_core::ChatStreamSender::new(64);
    agent = agent.with_chat_stream(stream_sender);

    // Perpetual input channel.
    let (agent_with_input, input_tx) = agent.with_perpetual_input();

    // Bridge: ChatStreamEvent from agent → event_tx for TUI.
    tokio::spawn(async move {
        while let Ok(evt) = stream_rx.recv().await {
            if event_tx.send(evt).is_err() {
                break;
            }
        }
    });

    // Spawn the agent loop.
    let join = tokio::spawn(async move {
        match agent_with_input
            .run("The user just connected. Greet them briefly.")
            .await
        {
            Ok(result) => {
                tracing::info!(
                    stop = ?result.stop_reason,
                    iterations = result.iterations,
                    "direct agent session ended"
                );
            }
            Err(e) => {
                tracing::error!("direct agent error: {e}");
            }
        }
    });

    Ok((input_tx, join))
}
