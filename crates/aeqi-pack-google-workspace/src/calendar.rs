//! Google Calendar tools — list_events / create_event / update_event /
//! delete_event.
//!
//! Per-agent scoping (each agent's calendar is independent of the next).
//! `list_events` only needs `calendar.readonly`; create / update / delete
//! need the full `calendar` scope.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{CALENDAR_BASE, GoogleApiClient, GoogleApiError};

const PROVIDER: &str = "google";
const NAME: &str = "oauth_token";
const SCOPE_RO: &str = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPE_RW: &str = "https://www.googleapis.com/auth/calendar";

fn need(scopes: Vec<&'static str>) -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Agent).with_scopes(scopes)
}

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

fn calendar_id_or_primary(args: &Value) -> String {
    args.get("calendar_id")
        .and_then(|v| v.as_str())
        .unwrap_or("primary")
        .to_string()
}

// ------------------------------------------------------------------------
// calendar.list_events
// ------------------------------------------------------------------------

pub struct CalendarListEventsTool;

#[async_trait]
impl Tool for CalendarListEventsTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.list_events requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.list_events".into(),
            description: "List events on a Google Calendar within an RFC3339 time window. Defaults to the agent's primary calendar.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "time_min":    { "type": "string", "description": "RFC3339 start (inclusive)" },
                    "time_max":    { "type": "string", "description": "RFC3339 end (exclusive)" },
                    "calendar_id": { "type": "string", "description": "Calendar id, default 'primary'" }
                },
                "required": ["time_min", "time_max"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.list_events"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RO])]
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
        if let Err(e) = client.ensure_scopes(&[SCOPE_RO]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let time_min = args.get("time_min").and_then(|v| v.as_str()).unwrap_or("");
        let time_max = args.get("time_max").and_then(|v| v.as_str()).unwrap_or("");
        if time_min.is_empty() || time_max.is_empty() {
            return Ok(ToolResult::error("missing 'time_min' or 'time_max'"));
        }
        let url = format!(
            "{}/calendars/{}/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
            urlencoding::encode(time_min),
            urlencoding::encode(time_max),
        );
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let events = resp
            .get("items")
            .cloned()
            .unwrap_or(Value::Array(Vec::new()));
        Ok(
            ToolResult::success(serde_json::to_string(&events).unwrap_or_default())
                .with_data(json!({ "events": events })),
        )
    }
}

// ------------------------------------------------------------------------
// calendar.create_event
// ------------------------------------------------------------------------

pub struct CalendarCreateEventTool;

#[async_trait]
impl Tool for CalendarCreateEventTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.create_event requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.create_event".into(),
            description: "Create a calendar event. Set `conferencing_meet=true` to attach a Google Meet link via conferenceData.createRequest. Returns the new event id and (when conferencing) the Meet join link.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title":        { "type": "string" },
                    "start":        { "type": "string", "description": "RFC3339 start (e.g. 2026-04-25T15:00:00-07:00)" },
                    "end":          { "type": "string", "description": "RFC3339 end" },
                    "attendees":    { "type": "array", "items": { "type": "string" } },
                    "description":  { "type": "string" },
                    "location":     { "type": "string" },
                    "conferencing_meet": { "type": "boolean", "description": "Attach a Google Meet conference" },
                    "calendar_id":  { "type": "string", "description": "Default 'primary'" }
                },
                "required": ["title", "start", "end"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.create_event"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RW])]
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
        if let Err(e) = client.ensure_scopes(&[SCOPE_RW]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let start = args.get("start").and_then(|v| v.as_str()).unwrap_or("");
        let end = args.get("end").and_then(|v| v.as_str()).unwrap_or("");
        if title.is_empty() || start.is_empty() || end.is_empty() {
            return Ok(ToolResult::error("missing 'title', 'start', or 'end'"));
        }
        let mut body = json!({
            "summary": title,
            "start": { "dateTime": start },
            "end":   { "dateTime": end },
        });
        if let Some(desc) = args.get("description").and_then(|v| v.as_str())
            && !desc.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("description".into(), Value::String(desc.into()));
        }
        if let Some(loc) = args.get("location").and_then(|v| v.as_str())
            && !loc.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("location".into(), Value::String(loc.into()));
        }
        if let Some(arr) = args.get("attendees").and_then(|v| v.as_array()) {
            let attendees: Vec<Value> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| json!({ "email": s }))
                .collect();
            if let Some(obj) = body.as_object_mut() {
                obj.insert("attendees".into(), Value::Array(attendees));
            }
        }
        let want_meet = args
            .get("conferencing_meet")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let mut url = format!(
            "{}/calendars/{}/events",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
        );
        if want_meet {
            url.push_str("?conferenceDataVersion=1");
            if let Some(obj) = body.as_object_mut() {
                obj.insert(
                    "conferenceData".into(),
                    json!({
                        "createRequest": {
                            "requestId": format!("aeqi-{}", uuid_v4_lite()),
                            "conferenceSolutionKey": { "type": "hangoutsMeet" }
                        }
                    }),
                );
            }
        }
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let event_id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let meet_link = extract_meet_link(&resp);
        Ok(ToolResult::success(format!(
            "created event id={event_id}{}",
            meet_link
                .as_ref()
                .map(|l| format!(" meet={l}"))
                .unwrap_or_default()
        ))
        .with_data(json!({
            "event_id": event_id,
            "meet_link": meet_link,
            "html_link": resp.get("htmlLink").cloned().unwrap_or(Value::Null),
        })))
    }
}

/// Pull the Meet join URI out of a Calendar event response. Google nests it
/// under `conferenceData.entryPoints[].uri` where `entryPointType == "video"`.
pub fn extract_meet_link(event: &Value) -> Option<String> {
    let entries = event
        .get("conferenceData")
        .and_then(|c| c.get("entryPoints"))
        .and_then(|v| v.as_array())?;
    for ep in entries {
        if ep
            .get("entryPointType")
            .and_then(|v| v.as_str())
            .map(|s| s == "video")
            .unwrap_or(false)
            && let Some(uri) = ep.get("uri").and_then(|v| v.as_str())
        {
            return Some(uri.to_string());
        }
    }
    None
}

/// Tiny UUID-v4-shaped string. We don't pull the `uuid` crate into this
/// module — `requestId` only needs to be unique per createRequest call.
fn uuid_v4_lite() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:032x}")
}

// ------------------------------------------------------------------------
// calendar.update_event
// ------------------------------------------------------------------------

pub struct CalendarUpdateEventTool;

#[async_trait]
impl Tool for CalendarUpdateEventTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.update_event requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.update_event".into(),
            description: "Patch fields on an existing calendar event. Only the fields you pass are sent — title/description/location/start/end/attendees. Uses PATCH semantics so unspecified fields are preserved.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "event_id":    { "type": "string" },
                    "title":       { "type": "string" },
                    "description": { "type": "string" },
                    "location":    { "type": "string" },
                    "start":       { "type": "string" },
                    "end":         { "type": "string" },
                    "attendees":   { "type": "array", "items": { "type": "string" } },
                    "calendar_id": { "type": "string" }
                },
                "required": ["event_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.update_event"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RW])]
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
        if let Err(e) = client.ensure_scopes(&[SCOPE_RW]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let event_id = args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
        if event_id.is_empty() {
            return Ok(ToolResult::error("missing 'event_id'"));
        }
        let mut body = json!({});
        let obj = body.as_object_mut().unwrap();
        if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
            obj.insert("summary".into(), Value::String(t.into()));
        }
        if let Some(d) = args.get("description").and_then(|v| v.as_str()) {
            obj.insert("description".into(), Value::String(d.into()));
        }
        if let Some(l) = args.get("location").and_then(|v| v.as_str()) {
            obj.insert("location".into(), Value::String(l.into()));
        }
        if let Some(s) = args.get("start").and_then(|v| v.as_str()) {
            obj.insert("start".into(), json!({ "dateTime": s }));
        }
        if let Some(e) = args.get("end").and_then(|v| v.as_str()) {
            obj.insert("end".into(), json!({ "dateTime": e }));
        }
        if let Some(arr) = args.get("attendees").and_then(|v| v.as_array()) {
            let attendees: Vec<Value> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| json!({ "email": s }))
                .collect();
            obj.insert("attendees".into(), Value::Array(attendees));
        }
        if obj.is_empty() {
            return Ok(ToolResult::error(
                "no fields to update — pass at least one of title/description/location/start/end/attendees",
            ));
        }
        let url = format!(
            "{}/calendars/{}/events/{}",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
            urlencoding::encode(event_id),
        );
        let resp: Value = match client.patch_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success(format!("updated event id={event_id}"))
            .with_data(json!({ "event": resp })))
    }
}

// ------------------------------------------------------------------------
// calendar.delete_event
// ------------------------------------------------------------------------

pub struct CalendarDeleteEventTool;

#[async_trait]
impl Tool for CalendarDeleteEventTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "calendar.delete_event requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "calendar.delete_event".into(),
            description: "Delete a calendar event by id. Irreversible.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "event_id":    { "type": "string" },
                    "calendar_id": { "type": "string" }
                },
                "required": ["event_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "calendar.delete_event"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SCOPE_RW])]
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
        if let Err(e) = client.ensure_scopes(&[SCOPE_RW]) {
            return Ok(into_tool_error(e));
        }
        let cal = calendar_id_or_primary(&args);
        let event_id = args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
        if event_id.is_empty() {
            return Ok(ToolResult::error("missing 'event_id'"));
        }
        let url = format!(
            "{}/calendars/{}/events/{}",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&cal),
            urlencoding::encode(event_id),
        );
        match client.delete_no_body(url).await {
            Ok(()) => Ok(ToolResult::success(format!("deleted event id={event_id}"))
                .with_data(json!({ "event_id": event_id, "deleted": true }))),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(CalendarListEventsTool),
        std::sync::Arc::new(CalendarCreateEventTool),
        std::sync::Arc::new(CalendarUpdateEventTool),
        std::sync::Arc::new(CalendarDeleteEventTool),
    ]
}

pub const READONLY_SCOPE: &str = SCOPE_RO;
pub const FULL_SCOPE: &str = SCOPE_RW;
pub const CALENDAR_API_BASE: &str = CALENDAR_BASE;
