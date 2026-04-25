//! Gmail tools — search / read / send / label / archive.
//!
//! Each tool consumes a `UsableCredential` resolved by T1.9's `oauth2`
//! lifecycle. Per-agent scoping is declared via `ScopeHint::Agent` so two
//! agents using `gmail.read` see two different mailboxes.
//!
//! The five tools split into two scope tiers:
//!
//! | Scope                                                   | Tools                       |
//! | ------------------------------------------------------- | --------------------------- |
//! | `https://www.googleapis.com/auth/gmail.readonly`        | `gmail.search`, `gmail.read` |
//! | `https://www.googleapis.com/auth/gmail.modify`          | `gmail.send`, `gmail.label`, `gmail.archive` |
//!
//! Tools always declare the narrowest scope they need; the bootstrap consent
//! flow concatenates the union.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use base64::Engine;
use serde_json::{Value, json};

use crate::api::{GMAIL_BASE, GoogleApiClient, GoogleApiError};

const PROVIDER: &str = "google";
const NAME: &str = "oauth_token";
const SCOPE_READONLY: &str = "https://www.googleapis.com/auth/gmail.readonly";
const SCOPE_MODIFY: &str = "https://www.googleapis.com/auth/gmail.modify";

fn build_credential_need(scopes: Vec<&'static str>) -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Agent).with_scopes(scopes)
}

/// Pull the (single) credential off the resolved slot vec. Returns `None`
/// when the slot is missing — callers turn that into a `missing_credential`
/// `ToolResult::error` at the call site (kept inline so we don't burn a
/// `Result<_, ToolResult>` shape that triggers `result_large_err`).
fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error("missing_credential: provider=google name=oauth_token (no agent-scoped Google credential found — run the bootstrap flow first)").with_data(json!({"reason_code": "missing_credential"}))
}

fn build_client(cred: &UsableCredential) -> GoogleApiClient<'_> {
    let base_override = cred
        .metadata
        .get("aeqi_test_base")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut c = GoogleApiClient::new(cred);
    if let Some(b) = base_override {
        c = c.with_base(b.clone(), b);
    }
    c
}

fn into_tool_error(err: GoogleApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    if let GoogleApiError::AuthExpired { credential_id } = &err {
        data["credential_id"] = json!(credential_id);
    }
    ToolResult::error(err.to_string()).with_data(data)
}

// ------------------------------------------------------------------------
// gmail.search
// ------------------------------------------------------------------------

pub struct GmailSearchTool;

#[async_trait]
impl Tool for GmailSearchTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "gmail.search requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "gmail.search".into(),
            description: "Search the agent's Gmail mailbox using Gmail's search syntax. Returns up to `max_results` matching messages with id, from, subject, snippet, timestamp, and thread_id. Reads only — no modifications.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Gmail search query (e.g. 'from:foo@example.com is:unread')" },
                    "max_results": { "type": "integer", "description": "Max messages to return (default 10, hard cap 100)" }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "gmail.search"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![build_credential_need(vec![SCOPE_READONLY])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_READONLY]) {
            return Ok(into_tool_error(e));
        }
        let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let max_results = args
            .get("max_results")
            .and_then(|v| v.as_u64())
            .unwrap_or(10)
            .clamp(1, 100);
        let list_url = format!(
            "{}/gmail/v1/users/me/messages?q={}&maxResults={}",
            client.gmail_base().trim_end_matches('/'),
            urlencoding::encode(query),
            max_results,
        );
        let list: Value = match client.get(list_url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let mut out = Vec::new();
        if let Some(arr) = list.get("messages").and_then(|v| v.as_array()) {
            for m in arr {
                let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let detail_url = format!(
                    "{}/gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject",
                    client.gmail_base().trim_end_matches('/'),
                );
                let detail: Value = match client.get(detail_url).await {
                    Ok(v) => v,
                    Err(e) => return Ok(into_tool_error(e)),
                };
                out.push(json!({
                    "id": id,
                    "thread_id": detail.get("threadId").cloned().unwrap_or(Value::Null),
                    "snippet": detail.get("snippet").cloned().unwrap_or(Value::Null),
                    "from": header_value(&detail, "From"),
                    "subject": header_value(&detail, "Subject"),
                    "timestamp": detail
                        .get("internalDate")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                }));
            }
        }
        Ok(
            ToolResult::success(serde_json::to_string(&out).unwrap_or_default())
                .with_data(json!({ "messages": out })),
        )
    }
}

fn header_value(detail: &Value, name: &str) -> Value {
    detail
        .get("payload")
        .and_then(|p| p.get("headers"))
        .and_then(|h| h.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|h| {
                let hn = h.get("name").and_then(|v| v.as_str())?;
                if hn.eq_ignore_ascii_case(name) {
                    h.get("value").cloned()
                } else {
                    None
                }
            })
        })
        .unwrap_or(Value::Null)
}

// ------------------------------------------------------------------------
// gmail.read
// ------------------------------------------------------------------------

pub struct GmailReadTool;

#[async_trait]
impl Tool for GmailReadTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "gmail.read requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "gmail.read".into(),
            description: "Read a Gmail message by id. Returns plain-text body, optional HTML body, and metadata for any attachments. Reads only.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "message_id": { "type": "string", "description": "Gmail message id (from gmail.search results)" }
                },
                "required": ["message_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "gmail.read"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![build_credential_need(vec![SCOPE_READONLY])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_READONLY]) {
            return Ok(into_tool_error(e));
        }
        let message_id = args
            .get("message_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if message_id.is_empty() {
            return Ok(ToolResult::error("missing 'message_id'"));
        }
        let url = format!(
            "{}/gmail/v1/users/me/messages/{message_id}?format=full",
            client.gmail_base().trim_end_matches('/'),
        );
        let raw: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let mut text = String::new();
        let mut html = String::new();
        let mut attachments: Vec<Value> = Vec::new();
        walk_payload(raw.get("payload"), &mut text, &mut html, &mut attachments);
        let data = json!({
            "id": message_id,
            "thread_id": raw.get("threadId").cloned().unwrap_or(Value::Null),
            "snippet": raw.get("snippet").cloned().unwrap_or(Value::Null),
            "from": header_value(&raw, "From"),
            "to": header_value(&raw, "To"),
            "subject": header_value(&raw, "Subject"),
            "body_text": text,
            "body_html": html,
            "attachments": attachments,
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

fn walk_payload(
    part: Option<&Value>,
    text: &mut String,
    html: &mut String,
    attachments: &mut Vec<Value>,
) {
    let Some(p) = part else { return };
    let mime = p.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
    let body = p.get("body");
    if let Some(filename) = p.get("filename").and_then(|v| v.as_str())
        && !filename.is_empty()
    {
        attachments.push(json!({
            "filename": filename,
            "mime_type": mime,
            "size": body.and_then(|b| b.get("size")).cloned().unwrap_or(Value::Null),
            "attachment_id": body.and_then(|b| b.get("attachmentId")).cloned().unwrap_or(Value::Null),
        }));
    }
    if let Some(data) = body.and_then(|b| b.get("data")).and_then(|v| v.as_str())
        && let Ok(decoded) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data)
        && let Ok(s) = String::from_utf8(decoded)
    {
        if mime == "text/plain" {
            text.push_str(&s);
        } else if mime == "text/html" {
            html.push_str(&s);
        }
    }
    if let Some(parts) = p.get("parts").and_then(|v| v.as_array()) {
        for child in parts {
            walk_payload(Some(child), text, html, attachments);
        }
    }
}

// ------------------------------------------------------------------------
// gmail.send
// ------------------------------------------------------------------------

pub struct GmailSendTool;

#[async_trait]
impl Tool for GmailSendTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "gmail.send requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "gmail.send".into(),
            description: "Send an email from the agent's Gmail account. Constructs an RFC 5322 message, base64url-encodes it, and POSTs to users.messages.send. Returns the sent message id.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "to":      { "type": "string", "description": "Comma-separated To addresses" },
                    "cc":      { "type": "string", "description": "Comma-separated Cc addresses" },
                    "bcc":     { "type": "string", "description": "Comma-separated Bcc addresses" },
                    "subject": { "type": "string" },
                    "body":    { "type": "string", "description": "Plain text body" },
                    "reply_to_thread_id": { "type": "string", "description": "Optional Gmail threadId to reply within" }
                },
                "required": ["to", "subject", "body"]
            }),
        }
    }

    fn name(&self) -> &str {
        "gmail.send"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![build_credential_need(vec![SCOPE_MODIFY])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_MODIFY]) {
            return Ok(into_tool_error(e));
        }
        let to = args.get("to").and_then(|v| v.as_str()).unwrap_or("");
        let cc = args.get("cc").and_then(|v| v.as_str()).unwrap_or("");
        let bcc = args.get("bcc").and_then(|v| v.as_str()).unwrap_or("");
        let subject = args.get("subject").and_then(|v| v.as_str()).unwrap_or("");
        let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");
        if to.is_empty() {
            return Ok(ToolResult::error("missing 'to'"));
        }
        let raw = build_rfc5322(to, cc, bcc, subject, body);
        let raw_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw.as_bytes());
        // Inline `post_gmail_send` so we can attach `threadId` when present.
        let url = format!(
            "{}/gmail/v1/users/me/messages/send",
            client.gmail_base().trim_end_matches('/'),
        );
        let mut body_json = json!({ "raw": raw_b64 });
        if let Some(tid) = args.get("reply_to_thread_id").and_then(|v| v.as_str())
            && !tid.is_empty()
            && let Some(obj) = body_json.as_object_mut()
        {
            obj.insert("threadId".into(), Value::String(tid.into()));
        }
        let resp: Value = match client.post_json(url, body_json).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(ToolResult::success(format!("sent message id={id}"))
            .with_data(json!({ "message_id": id, "thread_id": resp.get("threadId").cloned().unwrap_or(Value::Null) })))
    }
}

/// Construct an RFC 5322 message. Base64url encoding happens at the call
/// site so this stays a pure string-builder we can unit-test.
pub fn build_rfc5322(to: &str, cc: &str, bcc: &str, subject: &str, body: &str) -> String {
    let mut msg = String::new();
    msg.push_str(&format!("To: {to}\r\n"));
    if !cc.is_empty() {
        msg.push_str(&format!("Cc: {cc}\r\n"));
    }
    if !bcc.is_empty() {
        msg.push_str(&format!("Bcc: {bcc}\r\n"));
    }
    msg.push_str(&format!("Subject: {subject}\r\n"));
    msg.push_str("MIME-Version: 1.0\r\n");
    msg.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
    msg.push_str("\r\n");
    msg.push_str(body);
    msg
}

// ------------------------------------------------------------------------
// gmail.label
// ------------------------------------------------------------------------

pub struct GmailLabelTool;

#[async_trait]
impl Tool for GmailLabelTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "gmail.label requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "gmail.label".into(),
            description: "Add and/or remove labels on a Gmail message. Pass `add_labels` and/or `remove_labels` as arrays of label ids (e.g. INBOX, UNREAD, or custom Label_123 ids).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "message_id":    { "type": "string" },
                    "add_labels":    { "type": "array", "items": { "type": "string" } },
                    "remove_labels": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["message_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "gmail.label"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![build_credential_need(vec![SCOPE_MODIFY])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_MODIFY]) {
            return Ok(into_tool_error(e));
        }
        let message_id = args
            .get("message_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if message_id.is_empty() {
            return Ok(ToolResult::error("missing 'message_id'"));
        }
        let add: Vec<String> = args
            .get("add_labels")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let remove: Vec<String> = args
            .get("remove_labels")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if add.is_empty() && remove.is_empty() {
            return Ok(ToolResult::error(
                "no labels to add or remove — pass add_labels or remove_labels",
            ));
        }
        let url = format!(
            "{}/gmail/v1/users/me/messages/{message_id}/modify",
            client.gmail_base().trim_end_matches('/'),
        );
        let body = json!({
            "addLabelIds": add,
            "removeLabelIds": remove,
        });
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success(serde_json::to_string(&resp).unwrap_or_default())
            .with_data(json!({ "applied_add": add, "applied_remove": remove, "label_ids": resp.get("labelIds").cloned().unwrap_or(Value::Null) })))
    }
}

// ------------------------------------------------------------------------
// gmail.archive
// ------------------------------------------------------------------------

pub struct GmailArchiveTool;

#[async_trait]
impl Tool for GmailArchiveTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "gmail.archive requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "gmail.archive".into(),
            description: "Archive a Gmail message by removing the INBOX label. The message remains in All Mail and is searchable.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "message_id": { "type": "string" }
                },
                "required": ["message_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "gmail.archive"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![build_credential_need(vec![SCOPE_MODIFY])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        if let Err(e) = client.ensure_scopes(&[SCOPE_MODIFY]) {
            return Ok(into_tool_error(e));
        }
        let message_id = args
            .get("message_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if message_id.is_empty() {
            return Ok(ToolResult::error("missing 'message_id'"));
        }
        let url = format!(
            "{}/gmail/v1/users/me/messages/{message_id}/modify",
            client.gmail_base().trim_end_matches('/'),
        );
        let empty: Vec<String> = Vec::new();
        let body = json!({
            "addLabelIds": empty,
            "removeLabelIds": ["INBOX"],
        });
        match client.post_json::<Value>(url, body).await {
            Ok(resp) => Ok(ToolResult::success(format!("archived {message_id}"))
                .with_data(json!({"message_id": message_id, "label_ids": resp.get("labelIds").cloned().unwrap_or(Value::Null)}))),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

/// All five Gmail tools as a `Vec` ready to be registered in a tool registry.
pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(GmailSearchTool),
        std::sync::Arc::new(GmailReadTool),
        std::sync::Arc::new(GmailSendTool),
        std::sync::Arc::new(GmailLabelTool),
        std::sync::Arc::new(GmailArchiveTool),
    ]
}

// Re-export so tests can pin scope strings without re-typing them.
pub const READONLY_SCOPE: &str = SCOPE_READONLY;
pub const MODIFY_SCOPE: &str = SCOPE_MODIFY;
pub const GMAIL_API_BASE: &str = GMAIL_BASE;
