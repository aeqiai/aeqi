//! In-process mock MCP server + transport.
//!
//! Used by the test suite (and downstream consumers writing integration
//! tests against the MCP client) so we don't have to spawn `npx` or any
//! external Node runtime.
//!
//! `MockServer` speaks the same JSON-RPC envelope as a real MCP server.
//! It owns the inbound channel and simulates the protocol — `initialize`,
//! `tools/list`, `tools/call`, plus a manual `push_notification()` for
//! `tools/list_changed` testing.

use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc, oneshot};

use crate::errors::McpError;
use crate::protocol::{MCP_PROTOCOL_VERSION, McpToolDescriptor};
use crate::transport::{Transport, TransportChannels, TransportClosed};

type ToolHandler = Arc<dyn Fn(Value) -> Value + Send + Sync>;

/// Configurable mock MCP server. Construct, register tools, hand the
/// resulting [`MockTransport`] to the client, and the client thinks it
/// is talking to a real MCP server over stdio.
pub struct MockServer {
    inner: Arc<Mutex<MockState>>,
}

struct MockState {
    tools: Vec<McpToolDescriptor>,
    handlers: HashMap<String, ToolHandler>,
    /// Pushed every time the test calls `push_tools_list_changed`.
    push_inbound: Option<mpsc::Sender<String>>,
    /// Filled when the client connects — lets `push_tools_list_changed`
    /// signal the live transport.
    initialised: bool,
}

impl Default for MockServer {
    fn default() -> Self {
        Self::new()
    }
}

impl MockServer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MockState {
                tools: Vec::new(),
                handlers: HashMap::new(),
                push_inbound: None,
                initialised: false,
            })),
        }
    }

    /// Register a tool. The handler maps the call's `params.arguments`
    /// JSON to the tool result content.
    pub async fn register_tool(
        &self,
        name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
        handler: impl Fn(Value) -> Value + Send + Sync + 'static,
    ) {
        let name: String = name.into();
        let mut s = self.inner.lock().await;
        s.tools.push(McpToolDescriptor {
            name: name.clone(),
            description: Some(description.into()),
            input_schema,
        });
        s.handlers.insert(name, Arc::new(handler));
    }

    pub fn transport(&self) -> MockTransport {
        MockTransport {
            state: self.inner.clone(),
        }
    }

    /// Drive `notifications/tools/list_changed` to the connected client.
    /// Caller is expected to have updated the tool list (via
    /// `register_tool`) before sending. Returns `true` if a client was
    /// listening; `false` otherwise.
    pub async fn push_tools_list_changed(&self) -> bool {
        let s = self.inner.lock().await;
        if let Some(tx) = &s.push_inbound {
            let payload = json!({
                "jsonrpc": "2.0",
                "method": "notifications/tools/list_changed",
                "params": {},
            });
            tx.send(payload.to_string()).await.is_ok()
        } else {
            false
        }
    }
}

#[derive(Clone)]
pub struct MockTransport {
    state: Arc<Mutex<MockState>>,
}

#[async_trait]
impl Transport for MockTransport {
    async fn connect(&self) -> Result<TransportChannels, McpError> {
        let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);
        let (inbound_tx, inbound_rx) = mpsc::channel::<String>(64);
        let (_closed_tx, closed_rx) = oneshot::channel::<TransportClosed>();

        // Wire the push-notification channel into shared state.
        {
            let mut s = self.state.lock().await;
            s.push_inbound = Some(inbound_tx.clone());
            s.initialised = true;
        }

        let state = self.state.clone();
        tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                let req: Value = match serde_json::from_str(&msg) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let id = req.get("id").cloned();
                let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
                let params = req
                    .get("params")
                    .cloned()
                    .unwrap_or(Value::Object(Default::default()));

                let response = match method {
                    "initialize" => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "protocolVersion": MCP_PROTOCOL_VERSION,
                            "capabilities": {"tools": {}},
                            "serverInfo": {"name": "mock", "version": "0.0.0"},
                        }
                    }),
                    "tools/list" => {
                        let s = state.lock().await;
                        let tools = serde_json::to_value(&s.tools).unwrap_or(Value::Array(vec![]));
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {"tools": tools},
                        })
                    }
                    "tools/call" => {
                        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let args = params
                            .get("arguments")
                            .cloned()
                            .unwrap_or(Value::Object(Default::default()));
                        let s = state.lock().await;
                        if let Some(handler) = s.handlers.get(name).cloned() {
                            drop(s);
                            let content = handler(args);
                            json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": {
                                    "content": [{"type": "text", "text": content.to_string()}],
                                    "isError": false,
                                }
                            })
                        } else {
                            json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {"code": -32601, "message": "unknown tool"},
                            })
                        }
                    }
                    "notifications/initialized" => continue,
                    other => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {"code": -32601, "message": format!("method not found: {other}")},
                    }),
                };
                if inbound_tx.send(response.to_string()).await.is_err() {
                    break;
                }
            }
        });

        Ok(TransportChannels {
            outbound_tx,
            inbound_rx,
            closed: closed_rx,
        })
    }

    fn description(&self) -> String {
        "mock".to_string()
    }
}
