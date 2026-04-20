//! Generic side-process bridge.
//!
//! Wraps a child process that speaks JSON-lines over stdio (see
//! `bridges/baileys/src/bridge.mjs` for the reference peer). Lets channels
//! whose protocols can't be implemented directly in Rust — Baileys
//! (WhatsApp Web), iLink (personal Weixin) — run as a supervised side
//! process while the rest of the runtime keeps the `Channel` /
//! `SessionGateway` trait surface.
//!
//! Wire protocol (one JSON object per line):
//!   command:  {"id": "<uuid>", "method": "<name>", "params": {...}}
//!   response: {"id": "<uuid>", "result": ...}  OR  {"id": "<uuid>", "error": "..."}
//!   event:    {"event": "<name>", "data": ...}                       (no id)
//!
//! The supervisor owns the process and routes frames. A command `call()`
//! writes a frame with a fresh uuid and awaits the matching response.
//! Unsolicited events arrive on a broadcast channel that channel impls
//! subscribe to.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, broadcast, oneshot};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// An event emitted by the bridge process with no associated request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeEvent {
    pub event: String,
    #[serde(default)]
    pub data: Value,
}

/// Spawnable bridge — owns the child, a write half on stdin, and a
/// routing table for outstanding calls. Clone-safe via internal `Arc`.
#[derive(Clone)]
pub struct BridgeClient {
    inner: Arc<BridgeInner>,
}

struct BridgeInner {
    name: String,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    events_tx: broadcast::Sender<BridgeEvent>,
    // Holding the child keeps the OS process alive; dropping the client
    // kills it.
    _child: Arc<Mutex<Child>>,
}

impl BridgeClient {
    /// Spawn `node <script>` (or any interpreter) and begin serving
    /// JSON-lines frames. `name` is a short label used in log lines.
    pub async fn spawn(name: impl Into<String>, program: &str, args: &[&str]) -> Result<Self> {
        let name = name.into();
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to spawn bridge `{}` via `{}`", name, program))?;

        let stdin = child.stdin.take().context("bridge child missing stdin")?;
        let stdout = child.stdout.take().context("bridge child missing stdout")?;
        let stderr = child.stderr.take().context("bridge child missing stderr")?;

        let (events_tx, _) = broadcast::channel::<BridgeEvent>(128);
        let pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>> =
            Mutex::new(HashMap::new());

        let inner = Arc::new(BridgeInner {
            name: name.clone(),
            stdin: Mutex::new(stdin),
            pending,
            events_tx: events_tx.clone(),
            _child: Arc::new(Mutex::new(child)),
        });

        // Forward stderr → tracing so bridge-side panics/warnings surface.
        let stderr_name = name.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                warn!(target: "aeqi_gates::bridge", bridge = %stderr_name, "{}", line);
            }
        });

        // Drive stdout: route responses to oneshot senders, broadcast events.
        let inner_read = inner.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        if let Err(e) = dispatch_frame(&inner_read, line).await {
                            error!(
                                target: "aeqi_gates::bridge",
                                bridge = %inner_read.name,
                                error = %e,
                                line = %line,
                                "bridge frame dispatch failed"
                            );
                        }
                    }
                    Ok(None) => {
                        info!(target: "aeqi_gates::bridge", bridge = %inner_read.name, "bridge stdout closed");
                        break;
                    }
                    Err(e) => {
                        error!(target: "aeqi_gates::bridge", bridge = %inner_read.name, error = %e, "bridge stdout read error");
                        break;
                    }
                }
            }
            // Fail any still-pending calls with a clear reason.
            let mut pend = inner_read.pending.lock().await;
            for (_, tx) in pend.drain() {
                let _ = tx.send(Err("bridge exited".into()));
            }
        });

        Ok(Self { inner })
    }

    /// Subscribe to unsolicited events from the bridge. Each subscriber
    /// gets its own receiver; lag on one does not back-pressure others.
    pub fn subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.inner.events_tx.subscribe()
    }

    /// Invoke a named method on the bridge and await the response.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        let frame = serde_json::json!({ "id": id, "method": method, "params": params });
        let line = serde_json::to_string(&frame)? + "\n";

        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().await.insert(id.clone(), tx);

        {
            let mut stdin = self.inner.stdin.lock().await;
            stdin
                .write_all(line.as_bytes())
                .await
                .with_context(|| format!("write to bridge `{}`", self.inner.name))?;
            stdin.flush().await.ok();
        }

        match rx.await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(msg)) => Err(anyhow!("bridge error: {}", msg)),
            Err(_) => Err(anyhow!(
                "bridge `{}` closed before responding to `{}`",
                self.inner.name,
                method
            )),
        }
    }

    /// Fire-and-forget: send a frame with no id, do not wait for reply.
    /// Used for lifecycle hints like `shutdown`.
    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        let frame = serde_json::json!({ "method": method, "params": params });
        let line = serde_json::to_string(&frame)? + "\n";
        let mut stdin = self.inner.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await.ok();
        Ok(())
    }
}

async fn dispatch_frame(inner: &BridgeInner, line: &str) -> Result<()> {
    let v: Value = serde_json::from_str(line).context("parse bridge frame")?;

    // Event frame: {"event": "...", "data": ...}
    if let Some(event_name) = v.get("event").and_then(|x| x.as_str()) {
        let ev = BridgeEvent {
            event: event_name.to_string(),
            data: v.get("data").cloned().unwrap_or(Value::Null),
        };
        debug!(target: "aeqi_gates::bridge", bridge = %inner.name, event = %event_name, "bridge event");
        let _ = inner.events_tx.send(ev);
        return Ok(());
    }

    // Response frame: {"id": "...", "result": ...} or {"id": "...", "error": "..."}
    if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
        let mut pend = inner.pending.lock().await;
        if let Some(tx) = pend.remove(id) {
            if let Some(err) = v.get("error").and_then(|x| x.as_str()) {
                let _ = tx.send(Err(err.to_string()));
            } else {
                let result = v.get("result").cloned().unwrap_or(Value::Null);
                let _ = tx.send(Ok(result));
            }
            return Ok(());
        }
        warn!(target: "aeqi_gates::bridge", bridge = %inner.name, id = %id, "response for unknown id");
        return Ok(());
    }

    warn!(target: "aeqi_gates::bridge", bridge = %inner.name, "frame without event/id: {}", line);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn bridge_script() -> PathBuf {
        // crates/aeqi-gates → ../../bridges/baileys/src/bridge.mjs
        let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop(); // crates/
        p.pop(); // repo root
        p.push("bridges/baileys/src/bridge.mjs");
        p
    }

    #[tokio::test]
    async fn ping_roundtrip_and_ready_event() {
        let script = bridge_script();
        if !script.exists() {
            eprintln!("skipping bridge ping test: {} missing", script.display());
            return;
        }
        let client = BridgeClient::spawn("baileys-test", "node", &[script.to_str().unwrap()])
            .await
            .expect("spawn bridge");

        let mut events = client.subscribe();
        // Expect a `ready_bridge` bootstrap event shortly after spawn.
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut saw_ready = false;
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_millis(500), events.recv()).await {
                Ok(Ok(ev)) if ev.event == "ready_bridge" => {
                    saw_ready = true;
                    break;
                }
                _ => continue,
            }
        }
        assert!(saw_ready, "bridge did not emit ready_bridge event");

        let resp = client
            .call("ping", serde_json::json!({"hello": "world"}))
            .await
            .expect("ping call");
        assert_eq!(resp.get("pong").and_then(|v| v.as_bool()), Some(true));

        client
            .notify("shutdown", Value::Null)
            .await
            .expect("shutdown");
    }
}
