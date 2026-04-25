//! Google Meet tools — `meet.create` and `meet.list_active`.
//!
//! Spec ambiguity resolved here: Google's first-party Meet REST API is
//! limited (it gates Workspace-only "Spaces" + transcripts behind paid
//! tiers and gives consumer accounts almost nothing standalone). The
//! pragmatic, industry-standard path is to *always* go through Calendar
//! with `conferenceData.createRequest` — that's how every Workspace tool
//! (Zoom plug-ins, Slack scheduler, Calendly, etc.) creates Meet links
//! today.
//!
//! - `meet.create` → POST a Calendar event with `conferenceData` and
//!   surface the Meet join link. The event is the source of truth; the
//!   link is just the entry point.
//! - `meet.list_active` → GET Calendar events spanning "now" that have
//!   `conferenceData.entryPoints[].entryPointType=video`.
//!
//! Both reuse the Calendar client + scope.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use chrono::{Duration, Utc};
use serde_json::{Value, json};

use crate::api::{GoogleApiClient, GoogleApiError};
use crate::calendar::extract_meet_link;

const PROVIDER: &str = "google";
const NAME: &str = "oauth_token";
const SCOPE_RW: &str = "https://www.googleapis.com/auth/calendar";

fn need() -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Agent).with_scopes(vec![SCOPE_RW])
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

// ------------------------------------------------------------------------
// meet.create
// ------------------------------------------------------------------------

pub struct MeetCreateTool;

#[async_trait]
impl Tool for MeetCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "meet.create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "meet.create".into(),
            description: "Create a Google Meet meeting. Implementation: posts a primary-calendar event spanning `duration_minutes` from now with conferenceData.createRequest, returns the Meet join link. Optional attendees are invited.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "topic":            { "type": "string", "description": "Meeting title shown on the calendar entry" },
                    "duration_minutes": { "type": "integer", "description": "Length in minutes (default 30)" },
                    "attendees":        { "type": "array", "items": { "type": "string" } }
                },
                "required": ["topic"]
            }),
        }
    }

    fn name(&self) -> &str {
        "meet.create"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
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
        let topic = args.get("topic").and_then(|v| v.as_str()).unwrap_or("");
        if topic.is_empty() {
            return Ok(ToolResult::error("missing 'topic'"));
        }
        let dur = args
            .get("duration_minutes")
            .and_then(|v| v.as_i64())
            .unwrap_or(30)
            .clamp(5, 480);
        let now = Utc::now();
        let end = now + Duration::minutes(dur);
        let mut body = json!({
            "summary": topic,
            "start": { "dateTime": now.to_rfc3339() },
            "end":   { "dateTime": end.to_rfc3339() },
            "conferenceData": {
                "createRequest": {
                    "requestId": format!("aeqi-meet-{}", now.timestamp_nanos_opt().unwrap_or(0)),
                    "conferenceSolutionKey": { "type": "hangoutsMeet" }
                }
            }
        });
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
        let url = format!(
            "{}/calendars/primary/events?conferenceDataVersion=1",
            client.calendar_base().trim_end_matches('/')
        );
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let link = extract_meet_link(&resp).unwrap_or_default();
        let event_id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if link.is_empty() {
            // Calendar accepted the event but no Meet link was provisioned —
            // commonly happens on consumer accounts without Meet linking.
            return Ok(ToolResult::error("calendar event created but Google did not provision a Meet link (account may not have Meet enabled)")
                .with_data(json!({ "event_id": event_id, "reason_code": "meet_unavailable" })));
        }
        Ok(
            ToolResult::success(format!("meet={link}")).with_data(json!({
                "event_id": event_id,
                "meet_link": link,
                "starts_at": now.to_rfc3339(),
                "ends_at": end.to_rfc3339(),
            })),
        )
    }
}

// ------------------------------------------------------------------------
// meet.list_active
// ------------------------------------------------------------------------

pub struct MeetListActiveTool;

#[async_trait]
impl Tool for MeetListActiveTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "meet.list_active requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "meet.list_active".into(),
            description: "List currently-running Google Meet meetings (calendar events spanning 'now' with a Meet conference link).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    fn name(&self) -> &str {
        "meet.list_active"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        _args: Value,
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
        // Window from 1h ago to 1h ahead — generous so a meeting that just
        // started or is about to start is still classified as "active". We
        // filter client-side to events that strictly span "now".
        let now = Utc::now();
        let time_min = now - Duration::hours(1);
        let time_max = now + Duration::hours(1);
        let url = format!(
            "{}/calendars/primary/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime",
            client.calendar_base().trim_end_matches('/'),
            urlencoding::encode(&time_min.to_rfc3339()),
            urlencoding::encode(&time_max.to_rfc3339()),
        );
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let mut active: Vec<Value> = Vec::new();
        if let Some(items) = resp.get("items").and_then(|v| v.as_array()) {
            for ev in items {
                let Some(link) = extract_meet_link(ev) else {
                    continue;
                };
                let start = ev
                    .get("start")
                    .and_then(|s| s.get("dateTime"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let end = ev
                    .get("end")
                    .and_then(|e| e.get("dateTime"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !spans_now(start, end, now) {
                    continue;
                }
                active.push(json!({
                    "event_id": ev.get("id").cloned().unwrap_or(Value::Null),
                    "summary":  ev.get("summary").cloned().unwrap_or(Value::Null),
                    "meet_link": link,
                    "start":    start,
                    "end":      end,
                }));
            }
        }
        Ok(
            ToolResult::success(serde_json::to_string(&active).unwrap_or_default())
                .with_data(json!({ "meetings": active })),
        )
    }
}

fn spans_now(start: &str, end: &str, now: chrono::DateTime<Utc>) -> bool {
    let Ok(s) = chrono::DateTime::parse_from_rfc3339(start) else {
        return false;
    };
    let Ok(e) = chrono::DateTime::parse_from_rfc3339(end) else {
        return false;
    };
    let s = s.with_timezone(&Utc);
    let e = e.with_timezone(&Utc);
    s <= now && now <= e
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(MeetCreateTool),
        std::sync::Arc::new(MeetListActiveTool),
    ]
}

pub const SCOPE: &str = SCOPE_RW;
