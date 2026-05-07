//! LLM-powered Blueprint generation.
//!
//! Phase 2 wires the architect to a real LLM via the `aeqi-inference` router.
//! Same input/output shape as the Phase-1 stub — just a real generator inside.
//!
//! ## Wire shape
//!
//! 1. Caller hands us a [`Brief`] + an [`LlmCaller`] (typically an
//!    `aeqi_inference::InferenceRouter` wired with a `DeepInfraProvider`).
//! 2. We build a system prompt that defines the Blueprint schema + asks the
//!    model to fill it in for the given brief.
//! 3. Call the router's `chat_completion`. Read assistant content.
//! 4. Strip code-fences, parse as JSON, validate it has the minimum
//!    Blueprint shape, wrap in [`GeneratedBlueprint`].
//! 5. On any failure (network, parse, schema) we return an error — the
//!    IPC layer above falls back to the stub generator so the user always
//!    sees *something*.
//!
//! ## Why a trait, not a concrete `InferenceRouter`?
//!
//! Two reasons. (a) Unit tests mock the LLM with a canned JSON response —
//! no env-var setup, no network, no provider construction. (b) The
//! architect crate stays decoupled from `aeqi-inference`'s billing /
//! middleware surface; the IPC layer constructs the concrete router with
//! whatever provider config it has and hands an `&dyn LlmCaller` in.

use std::time::Duration;

use aeqi_inference::types::{ChatCompletionRequest, ChatMessage};
use async_trait::async_trait;
use serde_json::{Value, json};
use tracing::{debug, warn};

use crate::generator::{
    ArchitectError, HARD_CHAR_CAP, build_minimal_foundation_blueprint, choose_template_default,
};
use crate::types::{Brief, GeneratedBlueprint, GeneratorProvenance};

/// Default model ID used when the caller doesn't specify one. DeepInfra
/// hosts this; it's cheap enough for the draft path and big enough to
/// follow the schema. Caller can override per request via
/// [`LlmGenerationOptions::model`].
pub const DEFAULT_MODEL: &str = "meta-llama/Meta-Llama-3.3-70B-Instruct";

/// How long we'll wait for the LLM before giving up. Beyond this the IPC
/// layer falls back to the stub generator.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Refine takes a system-prompt + brief + serialized prior blueprint
/// (~1 KB+) + instruction, so the model has more tokens to read and emit
/// than the draft path. OpenRouter routes to different upstreams under
/// load; tail latency on the slow shards crosses 30 s mid-body-stream
/// and reqwest's `resp.json()` fails with `error decoding response body`.
/// Give refine a longer ceiling so the body has time to land cleanly.
pub const REFINE_TIMEOUT: Duration = Duration::from_secs(90);

/// Generation knobs. Defaults are sensible for the draft path.
#[derive(Debug, Clone)]
pub struct LlmGenerationOptions {
    /// Model ID passed through to `chat_completion`. Defaults to
    /// [`DEFAULT_MODEL`].
    pub model: String,
    /// Sampling temperature. Defaults to 0.4 — low enough that the model
    /// follows the schema, high enough to vary names/taglines per brief.
    pub temperature: f32,
    /// Token budget for the response. Defaults to 2 048 — a full
    /// Blueprint with 3 ideas, 5 roles, 3 agents fits in ~1 200.
    pub max_tokens: u32,
}

impl Default for LlmGenerationOptions {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            temperature: 0.4,
            max_tokens: 2_048,
        }
    }
}

/// Minimal abstraction over "thing that can complete a chat". Implemented
/// for `aeqi_inference::InferenceRouter` (production) and a mock in tests.
///
/// The trait takes a fully-built [`ChatCompletionRequest`] and returns
/// the assistant's text content as a `String`. Provenance/cost accounting
/// happens inside the implementation — the architect crate doesn't care.
#[async_trait]
pub trait LlmCaller: Send + Sync {
    /// Run a chat completion. On success, return just the assistant
    /// message text — the architect doesn't need IDs or finish reasons.
    async fn complete(&self, req: ChatCompletionRequest) -> Result<String, String>;
}

#[async_trait]
impl LlmCaller for aeqi_inference::InferenceRouter {
    async fn complete(&self, req: ChatCompletionRequest) -> Result<String, String> {
        let resp = self.chat_completion(req).await.map_err(|e| e.to_string())?;
        resp.choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| "LLM response had no choices".to_string())
    }
}

/// OpenRouter-backed [`LlmCaller`]. Used in production when
/// `OPENROUTER_API_KEY` is set — that's the actual key shipped on the
/// platform host. We hit OpenRouter's OpenAI-compatible endpoint
/// directly with reqwest so the architect doesn't drag the orchestrator
/// dependency cycle through `aeqi-inference`'s billing middleware.
///
/// `aeqi-inference` exposes the DeepInfra provider; if `DEEPINFRA_API_KEY`
/// is set instead, [`build_default_llm`] returns an `InferenceRouter`
/// wired to that. OpenRouter is the canonical fallback.
pub struct OpenRouterLlm {
    api_key: String,
    client: reqwest::Client,
    base_url: String,
}

impl OpenRouterLlm {
    /// Construct from an explicit API key.
    ///
    /// The reqwest client timeout is set to [`REFINE_TIMEOUT`] (the wider
    /// of the two architect deadlines) so body streaming has headroom on
    /// the slowest OpenRouter upstream shards. The actual per-call
    /// deadline is enforced by the caller via `tokio::time::timeout`.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            client: reqwest::Client::builder()
                .timeout(REFINE_TIMEOUT)
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            base_url: "https://openrouter.ai/api/v1".to_string(),
        }
    }

    /// Override the base URL — used by tests against a mock HTTP server.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }
}

#[async_trait]
impl LlmCaller for OpenRouterLlm {
    async fn complete(&self, req: ChatCompletionRequest) -> Result<String, String> {
        // OpenRouter accepts the same OpenAI shape; we forward as-is plus
        // a `response_format` hint so models that support JSON mode use it.
        let mut body = json!({
            "model": req.model,
            "messages": req.messages.iter().map(|m| json!({
                "role": m.role,
                "content": m.content,
            })).collect::<Vec<_>>(),
            "stream": false,
            "response_format": { "type": "json_object" },
        });
        if let Some(t) = req.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(mt) = req.max_tokens {
            body["max_tokens"] = json!(mt);
        }

        let url = format!("{}/chat/completions", self.base_url);
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .header("Content-Type", "application/json")
            // OpenRouter recommends these but they're optional.
            .header("HTTP-Referer", "https://aeqi.ai")
            .header("X-Title", "aeqi architect")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("openrouter send: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("openrouter {status}: {text}"));
        }

        // Read body as text first, then parse. `resp.json()` fails opaquely
        // with `error decoding response body` when the body stream is
        // truncated (slow upstream + reqwest timeout) or the upstream
        // returned malformed JSON. Reading text-first gives a diagnostic
        // body in the error message and surfaces the real failure mode.
        let body = resp
            .text()
            .await
            .map_err(|e| format!("openrouter body read: {e}"))?;

        let raw: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
            let preview: String = body.chars().take(500).collect();
            format!(
                "openrouter response parse: {e} (body_len={}, preview={preview:?})",
                body.len()
            )
        })?;

        raw.pointer("/choices/0/message/content")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                format!(
                    "openrouter response missing /choices/0/message/content: {}",
                    raw
                )
            })
    }
}

/// Build a default [`LlmCaller`] from the runtime's environment.
///
/// Resolution order:
/// 1. `DEEPINFRA_API_KEY` → wire an `aeqi_inference::InferenceRouter` with
///    `DeepInfraProvider`. Default model becomes a DeepInfra one.
/// 2. `OPENROUTER_API_KEY` → return an [`OpenRouterLlm`]. Default model
///    becomes `meta-llama/llama-3.3-70b-instruct` on OpenRouter.
/// 3. Neither set → returns `None`. The IPC layer falls back to the stub
///    generator so the user still sees a draft.
pub fn build_default_llm() -> Option<(Box<dyn LlmCaller>, LlmGenerationOptions)> {
    if let Ok(key) = std::env::var("DEEPINFRA_API_KEY")
        && !key.is_empty()
    {
        let mut router = aeqi_inference::InferenceRouter::new();
        let provider = aeqi_inference::DeepInfraProvider::with_key(key);
        let arc_provider = std::sync::Arc::new(provider);
        for prefix in ["meta-llama", "mistralai", "Qwen", "deepinfra"] {
            router.register(prefix, arc_provider.clone());
        }
        let opts = LlmGenerationOptions {
            model: DEFAULT_MODEL.to_string(),
            ..Default::default()
        };
        return Some((Box::new(router), opts));
    }

    if let Ok(key) = std::env::var("OPENROUTER_API_KEY")
        && !key.is_empty()
    {
        let opts = LlmGenerationOptions {
            // OpenRouter's slug for the same model.
            model: "meta-llama/llama-3.3-70b-instruct".to_string(),
            ..Default::default()
        };
        // OPENROUTER_BASE_URL lets sandbox tenants point at the platform's
        // `/api/llm/v1` inference proxy (where the real upstream auth lives)
        // instead of the public OpenRouter endpoint. Host runtimes leave the
        // env var unset and hit OpenRouter directly with the parked key.
        let llm = match std::env::var("OPENROUTER_BASE_URL") {
            Ok(base_url) if !base_url.is_empty() => OpenRouterLlm::new(key).with_base_url(base_url),
            _ => OpenRouterLlm::new(key),
        };
        return Some((Box::new(llm), opts));
    }

    None
}

/// Generate a Blueprint from a brief using the supplied LLM caller.
///
/// On any failure (network, timeout, parse, schema) returns an
/// [`ArchitectError::LlmFailure`] — callers should fall back to the stub
/// generator so the user always sees a draft.
pub async fn generate_via_llm(
    brief: &Brief,
    llm: &dyn LlmCaller,
    opts: &LlmGenerationOptions,
) -> Result<GeneratedBlueprint, ArchitectError> {
    let trimmed = brief.text.trim();
    if trimmed.is_empty() {
        return Err(ArchitectError::EmptyBrief);
    }
    if trimmed.len() > HARD_CHAR_CAP {
        return Err(ArchitectError::BriefTooLong(trimmed.len()));
    }

    let messages = build_messages(trimmed);
    let req = ChatCompletionRequest {
        model: opts.model.clone(),
        messages,
        stream: false,
        max_tokens: Some(opts.max_tokens),
        temperature: Some(opts.temperature),
    };

    debug!(
        model = %opts.model,
        brief_len = trimmed.len(),
        "architect.llm: dispatching chat_completion"
    );

    let raw = match tokio::time::timeout(DEFAULT_TIMEOUT, llm.complete(req)).await {
        Ok(Ok(text)) => text,
        Ok(Err(err)) => {
            warn!(error = %err, "architect.llm: upstream call failed");
            return Err(ArchitectError::LlmFailure(err));
        }
        Err(_) => {
            warn!("architect.llm: timed out");
            return Err(ArchitectError::LlmFailure(format!(
                "LLM call exceeded {DEFAULT_TIMEOUT:?}"
            )));
        }
    };

    debug!(raw_len = raw.len(), "architect.llm: got response, parsing");

    parse_llm_response(&raw, trimmed)
}

/// Refine an existing draft via a multi-turn LLM conversation.
///
/// Wave 35 Phase 3. Builds a chat history that re-uses the same system
/// prompt as [`generate_via_llm`], stages the original brief as the first
/// user turn, the prior blueprint (rendered as JSON) as the assistant
/// reply, and then the founder's refinement instruction as the second
/// user turn. The model returns a fresh `{rationale, blueprint}` envelope
/// that we parse the same way as the initial draft.
///
/// `prior_briefs` is the list of previous user turns in chronological
/// order — the first entry is the original brief, every subsequent entry
/// is a prior refinement instruction. `prior_drafts` is the parallel list
/// of assistant responses (one per prior brief). The two slices MUST be
/// the same length; the IPC handler validates this before calling.
///
/// On any failure (network, timeout, parse, schema) returns an
/// [`ArchitectError::LlmFailure`] — Phase 3 does NOT fall back to the stub
/// for refinement (the stub can't operationalise an instruction). The IPC
/// layer surfaces the error to the UI so the founder can retry.
pub async fn refine_via_llm(
    prior_briefs: &[String],
    prior_drafts: &[GeneratedBlueprint],
    instruction: &str,
    llm: &dyn LlmCaller,
    opts: &LlmGenerationOptions,
) -> Result<GeneratedBlueprint, ArchitectError> {
    if prior_briefs.is_empty() || prior_drafts.is_empty() {
        return Err(ArchitectError::EmptyBrief);
    }
    if prior_briefs.len() != prior_drafts.len() {
        return Err(ArchitectError::LlmFailure(format!(
            "refine: brief/draft history length mismatch ({} vs {})",
            prior_briefs.len(),
            prior_drafts.len()
        )));
    }
    let trimmed_instr = instruction.trim();
    if trimmed_instr.is_empty() {
        return Err(ArchitectError::EmptyBrief);
    }
    if trimmed_instr.len() > HARD_CHAR_CAP {
        return Err(ArchitectError::BriefTooLong(trimmed_instr.len()));
    }

    let messages = build_refine_messages(prior_briefs, prior_drafts, trimmed_instr);
    let req = ChatCompletionRequest {
        model: opts.model.clone(),
        messages,
        stream: false,
        max_tokens: Some(opts.max_tokens),
        temperature: Some(opts.temperature),
    };

    debug!(
        model = %opts.model,
        prior_turns = prior_briefs.len(),
        instr_len = trimmed_instr.len(),
        "architect.llm: dispatching refine chat_completion"
    );

    let raw = match tokio::time::timeout(REFINE_TIMEOUT, llm.complete(req)).await {
        Ok(Ok(text)) => text,
        Ok(Err(err)) => {
            warn!(error = %err, "architect.llm: refine upstream call failed");
            return Err(ArchitectError::LlmFailure(err));
        }
        Err(_) => {
            warn!("architect.llm: refine timed out");
            return Err(ArchitectError::LlmFailure(format!(
                "LLM call exceeded {REFINE_TIMEOUT:?}"
            )));
        }
    };

    debug!(
        raw_len = raw.len(),
        "architect.llm: refine got response, parsing"
    );

    // Reuse the original brief for back-fill defaults — the orchestrator
    // expects a stable "founder intent" string when the model omits a
    // required scalar; the original brief is the most authoritative
    // source for that.
    parse_llm_response(&raw, &prior_briefs[0])
}

/// Parse the LLM's text response into a [`GeneratedBlueprint`].
///
/// Tolerant: strips ```/```json fences, picks the first JSON object found,
/// and back-fills any required Blueprint fields the model omitted using
/// the brief and the stub-default values. Returns
/// [`ArchitectError::LlmFailure`] only when the response has no parseable
/// JSON at all.
pub fn parse_llm_response(raw: &str, brief: &str) -> Result<GeneratedBlueprint, ArchitectError> {
    let json_text = extract_json_object(raw).ok_or_else(|| {
        ArchitectError::LlmFailure(format!(
            "LLM response had no parseable JSON object (got {} chars)",
            raw.len()
        ))
    })?;

    let parsed: Value = serde_json::from_str(&json_text)
        .map_err(|e| ArchitectError::LlmFailure(format!("JSON parse failed: {e}")))?;

    let (rationale, blueprint_obj) = split_rationale_and_blueprint(parsed);

    // Back-fill required Blueprint fields the model may have omitted.
    let mut blueprint = normalize_blueprint(blueprint_obj, brief);

    // Schema-gate enum-typed fields. The LLM happily emits English-sensible
    // values (e.g. `role_type: "contractor"`) that aren't in the canonical
    // enum and fail orchestrator deserialization with `unknown variant`.
    // Snap to the nearest valid value with a warn — fixing the prompt would
    // help, but defense-in-depth here means a typo never crashes spawn.
    schema_gate_blueprint(&mut blueprint);

    Ok(GeneratedBlueprint {
        kind: "single".to_string(),
        rationale,
        blueprint,
        generator: GeneratorProvenance::llm_v1(),
    })
}

// ---------------------------------------------------------------------------
// Schema gate
// ---------------------------------------------------------------------------

/// Canonical `RoleType` variants the orchestrator accepts.
/// See `crates/aeqi-orchestrator/src/role_registry.rs`.
const VALID_ROLE_TYPES: &[&str] = &["director", "operational", "advisor"];

/// Canonical on-chain template slugs. Anything else fails the
/// `keccak256(template) → templateId` lookup at provision time.
const VALID_TEMPLATES: &[&str] = &["foundation", "entity", "venture", "fund"];

/// Snap an arbitrary LLM-emitted role_type string to the nearest canonical
/// variant. Returns the canonical value and whether the input needed snapping.
fn snap_role_type(raw: &str) -> (&'static str, bool) {
    let lower = raw.trim().to_ascii_lowercase();
    if VALID_ROLE_TYPES.iter().any(|v| *v == lower) {
        // Already canonical — return the &'static slot.
        let canonical = match lower.as_str() {
            "director" => "director",
            "operational" => "operational",
            "advisor" => "advisor",
            _ => unreachable!(),
        };
        return (canonical, false);
    }
    // Map common synonyms.
    let snapped = match lower.as_str() {
        // Operational tier — paid contributors, contractors, employees.
        "contractor" | "freelancer" | "consultant" | "employee" | "contract" | "staff"
        | "operator" | "worker" | "ic" => "operational",
        // Advisor tier — board members (non-director), advisors, mentors.
        "board" | "advisors" | "advisory" | "mentor" | "investor" | "observer" => "advisor",
        // Director tier — founders, executives, C-suite.
        "founder" | "cofounder" | "co-founder" | "ceo" | "cto" | "cfo" | "coo" | "chair"
        | "chairman" | "president" | "executive" | "exec" | "owner" => "director",
        // Anything else: operational is the safe default.
        _ => "operational",
    };
    (snapped, true)
}

/// Snap an arbitrary LLM-emitted template string to the nearest canonical
/// on-chain template slug. Returns the canonical value and whether the
/// input needed snapping.
fn snap_template(raw: &str) -> (&'static str, bool) {
    let lower = raw.trim().to_ascii_lowercase();
    if let Some(v) = VALID_TEMPLATES.iter().find(|v| ***v == lower) {
        return (v, false);
    }
    let snapped = match lower.as_str() {
        "nonprofit" | "foundation" | "charity" | "ngo" | "mission" => "foundation",
        "startup" | "vc" | "venture" | "company-vc" | "tokenized" => "venture",
        "investment" | "lp" | "syndicate" | "fund-vehicle" => "fund",
        // Default for unknown is `entity` — the smallest viable template.
        _ => "entity",
    };
    (snapped, true)
}

/// Walk a parsed Blueprint JSON value and snap every enum-typed field to
/// its canonical variant. Logs a `warn!` for each snap so journalctl shows
/// the LLM drift; behavior is otherwise transparent to callers.
fn schema_gate_blueprint(bp: &mut Value) {
    let Some(obj) = bp.as_object_mut() else {
        return;
    };

    // Top-level template slug.
    if let Some(Value::String(t)) = obj.get("template")
        && !t.is_empty()
    {
        let raw = t.clone();
        let (snapped, did_snap) = snap_template(&raw);
        if did_snap {
            warn!(
                from = %raw,
                to = %snapped,
                "architect.llm: snapped template {raw} → {snapped}"
            );
            obj.insert("template".to_string(), Value::String(snapped.to_string()));
        }
    }

    // seed_roles[].role_type — the field that motivated the gate.
    if let Some(Value::Array(roles)) = obj.get_mut("seed_roles") {
        for role in roles.iter_mut() {
            let Some(role_obj) = role.as_object_mut() else {
                continue;
            };
            let Some(rt) = role_obj.get("role_type") else {
                continue;
            };
            // Tolerate `null` and non-string values — drop them so serde's
            // `Option<RoleType>::deserialize` falls back to the default.
            let raw = match rt {
                Value::String(s) => s.clone(),
                Value::Null => {
                    role_obj.remove("role_type");
                    continue;
                }
                _ => {
                    warn!(
                        value = %rt,
                        "architect.llm: dropping non-string role_type"
                    );
                    role_obj.remove("role_type");
                    continue;
                }
            };
            if raw.trim().is_empty() {
                role_obj.remove("role_type");
                continue;
            }
            let (snapped, did_snap) = snap_role_type(&raw);
            if did_snap {
                warn!(
                    from = %raw,
                    to = %snapped,
                    "architect.llm: snapped role_type {raw} → {snapped}"
                );
                role_obj.insert("role_type".to_string(), Value::String(snapped.to_string()));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

fn build_messages(brief: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: SYSTEM_PROMPT.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: brief.to_string(),
        },
    ]
}

/// Stage a multi-turn conversation: system prompt, then alternating
/// user/assistant pairs replaying every prior turn, then the founder's
/// new refinement instruction as the trailing user message.
///
/// Each prior assistant turn is rendered as the same `{rationale,
/// blueprint}` JSON envelope the model is asked to emit — so the model
/// sees its own canonical output shape and can edit it in place rather
/// than guessing at the schema again.
fn build_refine_messages(
    prior_briefs: &[String],
    prior_drafts: &[GeneratedBlueprint],
    instruction: &str,
) -> Vec<ChatMessage> {
    let mut out = Vec::with_capacity(2 + prior_briefs.len() * 2 + 1);
    out.push(ChatMessage {
        role: "system".to_string(),
        content: SYSTEM_PROMPT.to_string(),
    });
    for (brief, draft) in prior_briefs.iter().zip(prior_drafts.iter()) {
        out.push(ChatMessage {
            role: "user".to_string(),
            content: brief.clone(),
        });
        let envelope = json!({
            "rationale": draft.rationale,
            "blueprint": draft.blueprint,
        });
        out.push(ChatMessage {
            role: "assistant".to_string(),
            content: envelope.to_string(),
        });
    }
    out.push(ChatMessage {
        role: "user".to_string(),
        content: format!(
            "Refine the previous Blueprint based on this feedback (keep the same JSON envelope shape; \
             change only what the feedback implies, and update the rationale to explain the diff):\n\n{instruction}"
        ),
    });
    out
}

const SYSTEM_PROMPT: &str = r##"You are a Company architect for the aeqi platform. Given a founder's brief, you generate a Blueprint that aeqi will provision into a working Company.

Pick `template` from these on-chain templates:
- `foundation` — mission-driven nonprofit, minimal cap-table machinery, no token model.
- `entity` — small operational team, light governance, no token model.
- `venture` — VC-backed startup, on-chain cap table, token model assumed.
- `fund` — investment vehicle, multi-LP cap table.

Output STRICTLY this JSON shape, no prose, no code fences:

{
  "rationale": "<one paragraph (max 400 chars) explaining why this template + roles + agents + ideas fit the brief>",
  "blueprint": {
    "slug": "<kebab-case slug, max 32 chars>",
    "name": "<display name, max 32 chars>",
    "tagline": "<one-line pitch, max 80 chars>",
    "description": "<2-3 sentences, max 240 chars>",
    "category": "company",
    "template": "<foundation|entity|venture|fund>",
    "root": {
      "name": "founder",
      "model": "deepseek/deepseek-v4-pro",
      "color": "#0a0a0b",
      "system_prompt": "<persona for the founder's primary agent: 3-5 sentences, references the brief>",
      "proactive_greeting": "<one-line greeting the agent posts in the founder's inbox>"
    },
    "seed_agents": [
      { "owner": "root", "name": "<lowercase_name>", "system_prompt": "<3-4 sentences>", "proactive_greeting": "<one-line>" }
    ],
    "seed_events": [],
    "seed_ideas": [
      { "owner": "root", "name": "Mission", "content": "<one paragraph>", "tags": ["identity", "mission"] },
      { "owner": "root", "name": "Vision", "content": "<one paragraph>", "tags": ["identity", "vision"] },
      { "owner": "root", "name": "Values", "content": "<3-5 bullet values, one per line>", "tags": ["identity", "values"] }
    ],
    "seed_quests": [
      { "owner": "root", "subject": "<concrete first quest from the brief>", "description": "<2-3 sentences with a clear acceptance criterion>", "labels": ["kickoff"] }
    ],
    "seed_roles": [
      { "key": "founder", "title": "Founder", "default_occupant_agent": "root", "role_type": "director" }
    ],
    "seed_role_edges": []
  }
}

Rules:
- Pick 1-3 seed_agents that operationally support the brief (e.g. a writing assistant for a content business, a hiring assistant for a startup planning to scale).
- Pick 3-5 seed_roles total. Always include `founder` as a director-typed role with `default_occupant_agent="root"`.
- For each non-founder role, set `role_type` to `operational` and `default_occupant_agent` to one of the seed_agent names (or omit to leave vacant).
- Always include exactly 3 seed_ideas: Mission, Vision, Values.
- Always include exactly 1 seed_quest: a kickoff that operationalises the brief.
- Output the JSON object directly. No markdown, no commentary, no code fences."##;

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/// Pull the first balanced `{...}` object out of the LLM response.
/// Tolerant of code fences and surrounding prose.
fn extract_json_object(raw: &str) -> Option<String> {
    let s = raw.trim();
    let s = s
        .strip_prefix("```json")
        .or_else(|| s.strip_prefix("```"))
        .unwrap_or(s);
    let s = s.strip_suffix("```").unwrap_or(s).trim();

    let bytes = s.as_bytes();
    let start = bytes.iter().position(|&b| b == b'{')?;

    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_str {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(String::from_utf8_lossy(&bytes[start..=i]).into_owned());
                }
            }
            _ => {}
        }
    }
    None
}

/// The model is asked to emit `{rationale, blueprint}`. Tolerate the
/// case where it instead returns a Blueprint object directly — we'll
/// synthesize a rationale and use the whole thing.
fn split_rationale_and_blueprint(value: Value) -> (String, Value) {
    let obj = match value {
        Value::Object(map) => map,
        other => return (default_rationale(), other),
    };

    let has_blueprint = obj.contains_key("blueprint");
    let has_root = obj.contains_key("root") || obj.contains_key("template");

    if has_blueprint {
        let mut obj = obj;
        let blueprint = obj
            .remove("blueprint")
            .unwrap_or(Value::Object(Default::default()));
        let rationale = obj
            .remove("rationale")
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(default_rationale);
        (rationale, blueprint)
    } else if has_root {
        // Model emitted a Blueprint directly without the wrapper.
        (default_rationale(), Value::Object(obj))
    } else {
        (default_rationale(), Value::Object(obj))
    }
}

fn default_rationale() -> String {
    "Architect-drafted via LLM; rationale field omitted by the model.".to_string()
}

/// Ensure the parsed blueprint has every required Blueprint field. Fill
/// in defaults from the brief for anything the model dropped, so the
/// orchestrator's `serde_json::from_value::<Blueprint>` step doesn't 400
/// the deploy on a missing field. Truncates the few hard-capped string
/// fields so we don't blow past sane UI sizes.
fn normalize_blueprint(mut bp: Value, brief: &str) -> Value {
    if !bp.is_object() {
        return build_minimal_foundation_blueprint(brief);
    }

    // Ensure required scalars.
    {
        let map = bp.as_object_mut().unwrap();

        if map
            .get("slug")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty())
        {
            map.insert("slug".to_string(), json!("architect-llm"));
        }
        if map
            .get("name")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty())
        {
            map.insert("name".to_string(), json!("Founder's Company"));
        }
        if map
            .get("template")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty())
        {
            map.insert("template".to_string(), json!(choose_template_default()));
        }
        if map
            .get("category")
            .and_then(|v| v.as_str())
            .is_none_or(|s| s.is_empty())
        {
            map.insert("category".to_string(), json!("company"));
        }
        if !map.contains_key("tagline") {
            map.insert("tagline".to_string(), json!("Drafted from your brief."));
        }
        if !map.contains_key("description") {
            map.insert("description".to_string(), json!(""));
        }

        // Truncate hard-capped strings.
        truncate_string_field(map, "name", 32);
        truncate_string_field(map, "slug", 32);
        truncate_string_field(map, "tagline", 80);
        truncate_string_field(map, "description", 240);

        // Ensure root agent.
        if !map.contains_key("root") {
            map.insert(
                "root".to_string(),
                json!({
                    "name": "founder",
                    "model": "deepseek/deepseek-v4-pro",
                    "color": "#0a0a0b",
                    "system_prompt": format!("You are the founder's primary agent. The founder's brief: {brief}"),
                    "proactive_greeting": "Hi — your Architect drafted this Company from your brief."
                }),
            );
        }

        // Default arrays.
        for key in [
            "seed_agents",
            "seed_events",
            "seed_ideas",
            "seed_quests",
            "seed_roles",
            "seed_role_edges",
        ] {
            if !map.contains_key(key) {
                map.insert(key.to_string(), json!([]));
            }
        }
    }

    bp
}

fn truncate_string_field(map: &mut serde_json::Map<String, Value>, key: &str, max_chars: usize) {
    if let Some(Value::String(s)) = map.get(key)
        && s.chars().count() > max_chars
    {
        let truncated: String = s.chars().take(max_chars).collect();
        map.insert(key.to_string(), Value::String(truncated));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Mock LLM that returns a fixed response on every call. Records
    /// the request count for assertions.
    struct MockLlm {
        response: String,
        calls: Arc<AtomicUsize>,
    }

    impl MockLlm {
        fn new(response: impl Into<String>) -> Self {
            Self {
                response: response.into(),
                calls: Arc::new(AtomicUsize::new(0)),
            }
        }
    }

    #[async_trait]
    impl LlmCaller for MockLlm {
        async fn complete(&self, _req: ChatCompletionRequest) -> Result<String, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.response.clone())
        }
    }

    /// Mock that fails — used to assert the IPC layer's stub fallback.
    struct FailingLlm;

    #[async_trait]
    impl LlmCaller for FailingLlm {
        async fn complete(&self, _req: ChatCompletionRequest) -> Result<String, String> {
            Err("simulated upstream failure".to_string())
        }
    }

    fn brief(text: &str) -> Brief {
        Brief {
            text: text.to_string(),
            target_kind: None,
            notes: None,
        }
    }

    #[test]
    fn extract_json_object_strips_code_fences() {
        let s = "```json\n{\"a\":1}\n```";
        assert_eq!(extract_json_object(s).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn extract_json_object_pulls_from_prose() {
        let s = "Sure! Here's the blueprint:\n{\"slug\":\"x\",\"name\":\"Y\"}\nLet me know what you think.";
        assert_eq!(
            extract_json_object(s).unwrap(),
            "{\"slug\":\"x\",\"name\":\"Y\"}"
        );
    }

    #[test]
    fn extract_json_object_handles_nested_braces_and_strings() {
        let s = r#"{"a":{"b":"has } in string"},"c":[1,2]}"#;
        assert_eq!(extract_json_object(s).unwrap(), s);
    }

    #[test]
    fn parse_response_with_wrapper_envelope() {
        let raw = r#"{
  "rationale": "Test rationale.",
  "blueprint": {
    "slug": "test-co",
    "name": "Test Co",
    "template": "entity",
    "root": { "name": "founder", "system_prompt": "test" }
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        assert_eq!(out.kind, "single");
        assert_eq!(out.rationale, "Test rationale.");
        assert_eq!(out.blueprint["template"], "entity");
        assert_eq!(out.blueprint["slug"], "test-co");
        assert_eq!(out.generator.kind, "llm");
    }

    #[test]
    fn parse_response_back_fills_missing_arrays() {
        let raw = r#"{"blueprint":{"slug":"x","name":"X","template":"foundation","root":{"name":"founder"}}}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        assert!(out.blueprint["seed_ideas"].is_array());
        assert!(out.blueprint["seed_roles"].is_array());
        assert!(out.blueprint["seed_quests"].is_array());
        assert!(out.blueprint["seed_role_edges"].is_array());
    }

    #[test]
    fn parse_response_truncates_overlong_name() {
        let long_name = "A".repeat(100);
        let raw = format!(
            r#"{{"blueprint":{{"slug":"x","name":"{long_name}","template":"entity","root":{{"name":"founder"}}}}}}"#
        );
        let out = parse_llm_response(&raw, "irrelevant").unwrap();
        assert_eq!(out.blueprint["name"].as_str().unwrap().chars().count(), 32);
    }

    #[test]
    fn parse_response_accepts_bare_blueprint_without_wrapper() {
        // Model returns Blueprint directly without {rationale, blueprint} wrapper.
        let raw = r#"{"slug":"x","name":"X","template":"venture","root":{"name":"founder"}}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        assert_eq!(out.blueprint["template"], "venture");
        assert_eq!(out.rationale, default_rationale());
    }

    #[test]
    fn parse_response_rejects_non_json() {
        let raw = "I cannot help with that request.";
        let err = parse_llm_response(raw, "irrelevant").unwrap_err();
        assert!(matches!(err, ArchitectError::LlmFailure(_)));
    }

    #[tokio::test]
    async fn generate_via_llm_happy_path() {
        let response = r#"{
  "rationale": "Entity template fits a small consulting team.",
  "blueprint": {
    "slug": "ai-consulting",
    "name": "AI Consulting",
    "tagline": "Senior engineers, sharp deliverables.",
    "description": "A three-engineer consulting firm.",
    "category": "company",
    "template": "entity",
    "root": {
      "name": "founder",
      "system_prompt": "You lead a 3-person AI consulting firm.",
      "proactive_greeting": "Welcome — let's plan the first month."
    },
    "seed_agents": [
      { "owner": "root", "name": "writer", "system_prompt": "You draft proposals." }
    ],
    "seed_ideas": [
      { "owner": "root", "name": "Mission", "content": "Deliver expert AI work.", "tags": ["identity"] },
      { "owner": "root", "name": "Vision", "content": "Top-tier AI consulting.", "tags": ["identity"] },
      { "owner": "root", "name": "Values", "content": "Quality. Speed. Honesty.", "tags": ["identity"] }
    ],
    "seed_roles": [
      { "key": "founder", "title": "Founder", "default_occupant_agent": "root", "role_type": "director" },
      { "key": "engineer-1", "title": "Senior Engineer", "role_type": "operational" }
    ],
    "seed_quests": [
      { "owner": "root", "subject": "Land first client", "description": "Close one paying client this quarter.", "labels": ["kickoff"] }
    ],
    "seed_role_edges": [],
    "seed_events": []
  }
}"#;
        let llm = MockLlm::new(response);
        let opts = LlmGenerationOptions::default();
        let out = generate_via_llm(&brief("AI consulting firm with 3 engineers"), &llm, &opts)
            .await
            .expect("generate succeeds");
        assert_eq!(out.kind, "single");
        assert_eq!(out.blueprint["template"], "entity");
        assert_eq!(out.blueprint["name"], "AI Consulting");
        assert_eq!(llm.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn generate_via_llm_propagates_upstream_failure() {
        let opts = LlmGenerationOptions::default();
        let err = generate_via_llm(&brief("anything"), &FailingLlm, &opts)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchitectError::LlmFailure(_)));
    }

    #[tokio::test]
    async fn generate_via_llm_rejects_empty_brief() {
        let llm = MockLlm::new("{}");
        let opts = LlmGenerationOptions::default();
        let err = generate_via_llm(&brief("   \n\t "), &llm, &opts)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchitectError::EmptyBrief));
        assert_eq!(llm.calls.load(Ordering::SeqCst), 0);
    }

    fn fake_draft(name: &str, template: &str) -> GeneratedBlueprint {
        GeneratedBlueprint {
            kind: "single".to_string(),
            rationale: format!("Initial pick: {template}"),
            blueprint: json!({
                "slug": "test-co",
                "name": name,
                "template": template,
                "root": { "name": "founder" }
            }),
            generator: GeneratorProvenance::llm_v1(),
        }
    }

    #[tokio::test]
    async fn refine_via_llm_threads_history_and_returns_new_blueprint() {
        let response = r#"{
  "rationale": "Pivoted to legal AI focus; tightened agents to a contract reviewer.",
  "blueprint": {
    "slug": "legal-ai-consulting",
    "name": "Legal AI Co",
    "template": "entity",
    "root": { "name": "founder", "system_prompt": "Lead a legal-AI consulting firm." },
    "seed_agents": [{ "owner": "root", "name": "reviewer", "system_prompt": "Review contracts." }],
    "seed_ideas": [],
    "seed_quests": [],
    "seed_roles": [],
    "seed_role_edges": [],
    "seed_events": []
  }
}"#;
        let llm = MockLlm::new(response);
        let opts = LlmGenerationOptions::default();
        let prior_briefs = vec!["AI consulting firm with 3 engineers".to_string()];
        let prior_drafts = vec![fake_draft("AI Consulting", "entity")];

        let out = refine_via_llm(
            &prior_briefs,
            &prior_drafts,
            "focus on legal AI",
            &llm,
            &opts,
        )
        .await
        .expect("refine succeeds");
        assert_eq!(out.blueprint["name"], "Legal AI Co");
        assert_eq!(out.blueprint["template"], "entity");
        assert_eq!(out.generator.kind, "llm");
        assert_eq!(llm.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn refine_via_llm_rejects_empty_instruction() {
        let llm = MockLlm::new("{}");
        let opts = LlmGenerationOptions::default();
        let prior_briefs = vec!["whatever".to_string()];
        let prior_drafts = vec![fake_draft("X", "entity")];
        let err = refine_via_llm(&prior_briefs, &prior_drafts, "   ", &llm, &opts)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchitectError::EmptyBrief));
        assert_eq!(llm.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn refine_via_llm_rejects_history_length_mismatch() {
        let llm = MockLlm::new("{}");
        let opts = LlmGenerationOptions::default();
        let prior_briefs = vec!["a".to_string(), "b".to_string()];
        let prior_drafts = vec![fake_draft("X", "entity")];
        let err = refine_via_llm(&prior_briefs, &prior_drafts, "fix it", &llm, &opts)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchitectError::LlmFailure(_)));
    }

    #[test]
    fn schema_gate_snaps_contractor_to_operational() {
        // Walk-2 regression: refinement "make the writers contractors not
        // full-time" causes the LLM to emit `role_type: "contractor"`.
        // Pre-fix, this passed straight through and the runtime spawn
        // failed with `unknown variant 'contractor'`, leaving the company
        // at a hung splash. Post-fix, the gate snaps it to `operational`.
        let raw = r#"{
  "blueprint": {
    "slug": "writers-co",
    "name": "Writers Co",
    "template": "entity",
    "root": { "name": "founder" },
    "seed_roles": [
      { "key": "founder", "title": "Founder", "role_type": "director" },
      { "key": "writer-1", "title": "Writer", "role_type": "contractor" },
      { "key": "writer-2", "title": "Writer", "role_type": "Freelancer" }
    ]
  }
}"#;
        let out = parse_llm_response(raw, "writing studio").unwrap();
        let roles = out.blueprint["seed_roles"].as_array().unwrap();
        assert_eq!(roles[0]["role_type"], "director");
        assert_eq!(roles[1]["role_type"], "operational");
        // Case-insensitive match on the snap input.
        assert_eq!(roles[2]["role_type"], "operational");
    }

    #[test]
    fn schema_gate_maps_advisor_synonyms() {
        let raw = r#"{
  "blueprint": {
    "slug": "x", "name": "X", "template": "entity",
    "root": { "name": "founder" },
    "seed_roles": [
      { "key": "a", "title": "A", "role_type": "board" },
      { "key": "b", "title": "B", "role_type": "mentor" },
      { "key": "c", "title": "C", "role_type": "investor" }
    ]
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        let roles = out.blueprint["seed_roles"].as_array().unwrap();
        assert_eq!(roles[0]["role_type"], "advisor");
        assert_eq!(roles[1]["role_type"], "advisor");
        assert_eq!(roles[2]["role_type"], "advisor");
    }

    #[test]
    fn schema_gate_maps_director_synonyms() {
        let raw = r#"{
  "blueprint": {
    "slug": "x", "name": "X", "template": "entity",
    "root": { "name": "founder" },
    "seed_roles": [
      { "key": "a", "title": "A", "role_type": "ceo" },
      { "key": "b", "title": "B", "role_type": "co-founder" },
      { "key": "c", "title": "C", "role_type": "executive" }
    ]
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        let roles = out.blueprint["seed_roles"].as_array().unwrap();
        assert_eq!(roles[0]["role_type"], "director");
        assert_eq!(roles[1]["role_type"], "director");
        assert_eq!(roles[2]["role_type"], "director");
    }

    #[test]
    fn schema_gate_unknown_role_type_defaults_to_operational() {
        let raw = r#"{
  "blueprint": {
    "slug": "x", "name": "X", "template": "entity",
    "root": { "name": "founder" },
    "seed_roles": [
      { "key": "a", "title": "A", "role_type": "warlock" }
    ]
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        let roles = out.blueprint["seed_roles"].as_array().unwrap();
        assert_eq!(roles[0]["role_type"], "operational");
    }

    #[test]
    fn schema_gate_drops_null_or_non_string_role_type() {
        let raw = r#"{
  "blueprint": {
    "slug": "x", "name": "X", "template": "entity",
    "root": { "name": "founder" },
    "seed_roles": [
      { "key": "a", "title": "A", "role_type": null },
      { "key": "b", "title": "B", "role_type": 42 }
    ]
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        let roles = out.blueprint["seed_roles"].as_array().unwrap();
        assert!(roles[0].get("role_type").is_none());
        assert!(roles[1].get("role_type").is_none());
    }

    #[test]
    fn schema_gate_passes_canonical_role_types_unchanged() {
        let raw = r#"{
  "blueprint": {
    "slug": "x", "name": "X", "template": "entity",
    "root": { "name": "founder" },
    "seed_roles": [
      { "key": "a", "title": "A", "role_type": "director" },
      { "key": "b", "title": "B", "role_type": "operational" },
      { "key": "c", "title": "C", "role_type": "advisor" }
    ]
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        let roles = out.blueprint["seed_roles"].as_array().unwrap();
        assert_eq!(roles[0]["role_type"], "director");
        assert_eq!(roles[1]["role_type"], "operational");
        assert_eq!(roles[2]["role_type"], "advisor");
    }

    #[test]
    fn schema_gate_snaps_unknown_template() {
        let raw = r#"{
  "blueprint": {
    "slug": "x", "name": "X", "template": "nonprofit",
    "root": { "name": "founder" }
  }
}"#;
        let out = parse_llm_response(raw, "irrelevant").unwrap();
        assert_eq!(out.blueprint["template"], "foundation");
    }

    #[test]
    fn schema_gate_passes_canonical_template_unchanged() {
        for tpl in ["foundation", "entity", "venture", "fund"] {
            let raw = format!(
                r#"{{"blueprint":{{"slug":"x","name":"X","template":"{tpl}","root":{{"name":"founder"}}}}}}"#
            );
            let out = parse_llm_response(&raw, "irrelevant").unwrap();
            assert_eq!(out.blueprint["template"], tpl);
        }
    }

    #[tokio::test]
    async fn refine_via_llm_rejects_empty_history() {
        let llm = MockLlm::new("{}");
        let opts = LlmGenerationOptions::default();
        let err = refine_via_llm(&[], &[], "fix it", &llm, &opts)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchitectError::EmptyBrief));
        assert_eq!(llm.calls.load(Ordering::SeqCst), 0);
    }
}
