//! WebSocket-streaming IPC handlers that write directly to the socket.

use std::sync::Arc;
use std::time::Duration;

use aeqi_core::chat_stream::ChatStreamEvent;
use anyhow::Result;
use tokio::io::AsyncWriteExt;
use tokio::net::unix::OwnedWriteHalf;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;
use tracing::warn;

use crate::execution_registry::ExecutionRegistry;
use crate::stream_registry::StreamRegistry;

const SUBSCRIBE_IDLE_TIMEOUT: Duration = Duration::from_secs(600);

pub async fn handle_subscribe(
    execution_registry: &ExecutionRegistry,
    stream_registry: &Arc<StreamRegistry>,
    session_id: &str,
    writer: &mut OwnedWriteHalf,
) -> Result<()> {
    if session_id.is_empty() {
        return write_json(writer, &no_session_id()).await;
    }
    if !execution_registry.is_active(session_id).await {
        return write_json(writer, &no_active_run(session_id)).await;
    }

    let started_ms_ago = execution_registry
        .started_elapsed_ms(session_id)
        .await
        .unwrap_or(0);
    write_json(writer, &preamble(session_id, started_ms_ago)).await?;

    let sender = stream_registry.get_or_create(session_id).await;
    let (backlog, rx) = sender.snapshot_and_subscribe();

    for event in backlog {
        write_event(writer, &event).await?;
    }

    let completed = forward_live_events(rx, writer, session_id).await?;
    write_json(writer, &done(session_id, completed)).await
}

async fn forward_live_events(
    mut rx: Receiver<ChatStreamEvent>,
    writer: &mut OwnedWriteHalf,
    session_id: &str,
) -> Result<bool> {
    loop {
        match tokio::time::timeout(SUBSCRIBE_IDLE_TIMEOUT, rx.recv()).await {
            Ok(Ok(event)) => {
                let terminal = match &event {
                    ChatStreamEvent::Complete { stop_reason, .. } => {
                        stop_reason != "awaiting_input"
                    }
                    _ => false,
                };
                write_event(writer, &event).await?;
                if terminal {
                    return Ok(true);
                }
            }
            Ok(Err(RecvError::Lagged(n))) => {
                warn!(session_id = %session_id, lagged = n, "subscribe stream lagged");
            }
            Ok(Err(RecvError::Closed)) | Err(_) => return Ok(false),
        }
    }
}

async fn write_event(writer: &mut OwnedWriteHalf, event: &ChatStreamEvent) -> Result<()> {
    let value = serde_json::to_value(event)?;
    write_json(writer, &value).await
}

async fn write_json(writer: &mut OwnedWriteHalf, value: &serde_json::Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    Ok(())
}

fn preamble(session_id: &str, started_ms_ago: u64) -> serde_json::Value {
    serde_json::json!({
        "type": "Subscribed",
        "session_id": session_id,
        "started_ms_ago": started_ms_ago,
    })
}

fn done(session_id: &str, completed: bool) -> serde_json::Value {
    serde_json::json!({
        "done": true,
        "type": "Complete",
        "session_id": session_id,
        "subscribed": true,
        "completed": completed,
    })
}

fn no_active_run(session_id: &str) -> serde_json::Value {
    serde_json::json!({
        "done": true,
        "type": "Complete",
        "session_id": session_id,
        "no_active_run": true,
    })
}

fn no_session_id() -> serde_json::Value {
    serde_json::json!({ "ok": false, "error": "session_id required" })
}
