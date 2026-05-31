//! `pack:etsy` — native Etsy shop tools backed by T1.9's `oauth2`
//! lifecycle.
//!
//! Tools are company-scoped: a company connects one Etsy seller account, then any
//! permitted agent can inspect shop/listing/order data or prepare draft
//! listings for human review.

use std::collections::BTreeMap;

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use thiserror::Error;

pub const PROVIDER: &str = "etsy";
pub const CREDENTIAL_NAME: &str = "oauth_token";
pub const DEFAULT_API_BASE: &str = "https://api.etsy.com/v3/application";

const SHOPS_R: &str = "shops_r";
const LISTINGS_R: &str = "listings_r";
const LISTINGS_W: &str = "listings_w";
const TRANSACTIONS_R: &str = "transactions_r";

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(EtsyShopsListTool),
        std::sync::Arc::new(EtsyShopGetTool),
        std::sync::Arc::new(EtsyListingsListTool),
        std::sync::Arc::new(EtsyOrdersListTool),
        std::sync::Arc::new(EtsyDraftListingCreateTool),
    ]
}

fn need(scopes: Vec<&'static str>) -> CredentialNeed {
    CredentialNeed::new(PROVIDER, CREDENTIAL_NAME, ScopeHint::Company).with_scopes(scopes)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error(
        "missing_credential: provider=etsy name=oauth_token (connect Etsy on the company's \
         Integrations page first)",
    )
    .with_data(json!({"reason_code": "missing_credential"}))
}

fn require_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, Box<ToolResult>> {
    match args.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => Ok(s),
        _ => Err(Box::new(ToolResult::error(format!(
            "missing or empty '{key}'"
        )))),
    }
}

fn optional_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| {
        v.as_u64()
            .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
    })
}

fn optional_string(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn into_tool_error(err: EtsyApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    if let EtsyApiError::AuthExpired { credential_id } = &err {
        data["credential_id"] = json!(credential_id);
    }
    ToolResult::error(err.to_string()).with_data(data)
}

#[derive(Debug, Error)]
pub enum EtsyApiError {
    #[error("auth_expired (credential_id={credential_id})")]
    AuthExpired { credential_id: String },
    #[error("etsy api error status={status} body={body}")]
    Http { status: u16, body: String },
    #[error("transport error: {0}")]
    Transport(String),
    #[error("credential metadata missing Etsy x-api-key")]
    MissingApiKey,
}

impl EtsyApiError {
    fn reason_code(&self) -> &'static str {
        match self {
            Self::AuthExpired { .. } => "auth_expired",
            Self::Http { .. } => "http_error",
            Self::Transport(_) => "transport_error",
            Self::MissingApiKey => "missing_api_key",
        }
    }
}

struct EtsyApiClient<'a> {
    http: Client,
    cred: &'a UsableCredential,
    base: String,
}

impl<'a> EtsyApiClient<'a> {
    fn new(cred: &'a UsableCredential) -> Self {
        let base = cred
            .metadata
            .get("aeqi_test_base")
            .or_else(|| cred.metadata.get("api_base"))
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_API_BASE)
            .trim_end_matches('/')
            .to_string();
        Self {
            http: Client::new(),
            cred,
            base,
        }
    }

    fn user_id(&self) -> Option<String> {
        self.cred
            .bearer
            .as_deref()
            .and_then(|token| token.split_once('.').map(|(id, _)| id.to_string()))
            .filter(|id| id.chars().all(|c| c.is_ascii_digit()))
    }

    fn api_key(&self) -> Result<String, EtsyApiError> {
        self.cred
            .metadata
            .get("api_key")
            .and_then(|v| v.as_str())
            .or_else(|| {
                self.cred
                    .metadata
                    .get("client_id")
                    .and_then(|id| id.as_str())
            })
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or(EtsyApiError::MissingApiKey)
    }

    fn auth_value(&self) -> String {
        if let Some((_, v)) = self.cred.headers.iter().find(|(k, _)| k == "Authorization") {
            return v.clone();
        }
        format!("Bearer {}", self.cred.bearer.as_deref().unwrap_or_default())
    }

    async fn request_json(
        &self,
        method: Method,
        path: impl AsRef<str>,
        query: &[(&str, String)],
    ) -> Result<Value, EtsyApiError> {
        let mut url = format!("{}{}", self.base, path.as_ref());
        if !query.is_empty() {
            let query_string = query
                .iter()
                .map(|(key, value)| {
                    format!(
                        "{}={}",
                        urlencoding::encode(key),
                        urlencoding::encode(value)
                    )
                })
                .collect::<Vec<_>>()
                .join("&");
            url.push('?');
            url.push_str(&query_string);
        }
        let resp = self
            .http
            .request(method, &url)
            .header("Authorization", self.auth_value())
            .header("x-api-key", self.api_key()?)
            .send()
            .await
            .map_err(|e| EtsyApiError::Transport(e.to_string()))?;
        self.handle_json(resp).await
    }

    async fn post_form(
        &self,
        path: impl AsRef<str>,
        form: &BTreeMap<String, String>,
    ) -> Result<Value, EtsyApiError> {
        let url = format!("{}{}", self.base, path.as_ref());
        let resp = self
            .http
            .post(&url)
            .header("Authorization", self.auth_value())
            .header("x-api-key", self.api_key()?)
            .form(form)
            .send()
            .await
            .map_err(|e| EtsyApiError::Transport(e.to_string()))?;
        self.handle_json(resp).await
    }

    async fn handle_json(&self, resp: reqwest::Response) -> Result<Value, EtsyApiError> {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status == StatusCode::UNAUTHORIZED {
            return Err(EtsyApiError::AuthExpired {
                credential_id: self.cred.id.clone(),
            });
        }
        if !status.is_success() {
            return Err(EtsyApiError::Http {
                status: status.as_u16(),
                body: text,
            });
        }
        serde_json::from_str(&text).map_err(|e| EtsyApiError::Transport(e.to_string()))
    }
}

// ------------------------------------------------------------------------
// etsy_shops_list
// ------------------------------------------------------------------------

pub struct EtsyShopsListTool;

#[async_trait]
impl Tool for EtsyShopsListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "etsy_shops_list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "etsy_shops_list".into(),
            description:
                "List shops owned by the connected Etsy user. Optional `user_id` overrides the user id parsed from the OAuth token."
                    .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "user_id": { "type": "string" }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "etsy_shops_list"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SHOPS_R])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let Some(cred) = first_cred(credentials) else {
            return Ok(missing_credential());
        };
        let client = EtsyApiClient::new(&cred);
        let Some(user_id) = optional_string(&args, "user_id").or_else(|| client.user_id()) else {
            return Ok(ToolResult::error(
                "missing user_id and OAuth token did not expose one",
            ));
        };
        let data = match client
            .request_json(Method::GET, format!("/users/{user_id}/shops"), &[])
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success("etsy shops loaded").with_data(data))
    }
}

// ------------------------------------------------------------------------
// etsy_shop_get
// ------------------------------------------------------------------------

pub struct EtsyShopGetTool;

#[async_trait]
impl Tool for EtsyShopGetTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "etsy_shop_get requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "etsy_shop_get".into(),
            description: "Read public details for one Etsy shop by `shop_id`.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "shop_id": { "type": "integer" } },
                "required": ["shop_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "etsy_shop_get"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![SHOPS_R])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let Some(cred) = first_cred(credentials) else {
            return Ok(missing_credential());
        };
        let shop_id = match optional_u64(&args, "shop_id") {
            Some(id) => id,
            None => return Ok(ToolResult::error("missing or invalid 'shop_id'")),
        };
        let client = EtsyApiClient::new(&cred);
        let data = match client
            .request_json(Method::GET, format!("/shops/{shop_id}"), &[])
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success("etsy shop loaded").with_data(data))
    }
}

// ------------------------------------------------------------------------
// etsy_listings_list
// ------------------------------------------------------------------------

pub struct EtsyListingsListTool;

#[async_trait]
impl Tool for EtsyListingsListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "etsy_listings_list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "etsy_listings_list".into(),
            description: "List Etsy listings for a shop. Optional `state`, `limit`, and `offset`."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "shop_id": { "type": "integer" },
                    "state": { "type": "string", "description": "active | draft | expired | inactive | sold_out" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                    "offset": { "type": "integer", "minimum": 0 }
                },
                "required": ["shop_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "etsy_listings_list"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![LISTINGS_R])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let Some(cred) = first_cred(credentials) else {
            return Ok(missing_credential());
        };
        let shop_id = match optional_u64(&args, "shop_id") {
            Some(id) => id,
            None => return Ok(ToolResult::error("missing or invalid 'shop_id'")),
        };
        let mut query = Vec::new();
        if let Some(state) = optional_string(&args, "state") {
            query.push(("state", state));
        }
        if let Some(limit) = optional_u64(&args, "limit") {
            query.push(("limit", limit.clamp(1, 100).to_string()));
        }
        if let Some(offset) = optional_u64(&args, "offset") {
            query.push(("offset", offset.to_string()));
        }
        let client = EtsyApiClient::new(&cred);
        let data = match client
            .request_json(Method::GET, format!("/shops/{shop_id}/listings"), &query)
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success("etsy listings loaded").with_data(data))
    }
}

// ------------------------------------------------------------------------
// etsy_orders_list
// ------------------------------------------------------------------------

pub struct EtsyOrdersListTool;

#[async_trait]
impl Tool for EtsyOrdersListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "etsy_orders_list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "etsy_orders_list".into(),
            description: "List Etsy shop receipts/orders. Optional `limit`, `offset`, `was_paid`, and `was_shipped`."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "shop_id": { "type": "integer" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                    "offset": { "type": "integer", "minimum": 0 },
                    "was_paid": { "type": "boolean" },
                    "was_shipped": { "type": "boolean" }
                },
                "required": ["shop_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "etsy_orders_list"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![TRANSACTIONS_R])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let Some(cred) = first_cred(credentials) else {
            return Ok(missing_credential());
        };
        let shop_id = match optional_u64(&args, "shop_id") {
            Some(id) => id,
            None => return Ok(ToolResult::error("missing or invalid 'shop_id'")),
        };
        let mut query = Vec::new();
        if let Some(limit) = optional_u64(&args, "limit") {
            query.push(("limit", limit.clamp(1, 100).to_string()));
        }
        if let Some(offset) = optional_u64(&args, "offset") {
            query.push(("offset", offset.to_string()));
        }
        for key in ["was_paid", "was_shipped"] {
            if let Some(v) = args.get(key).and_then(|v| v.as_bool()) {
                query.push((key, v.to_string()));
            }
        }
        let client = EtsyApiClient::new(&cred);
        let data = match client
            .request_json(Method::GET, format!("/shops/{shop_id}/receipts"), &query)
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success("etsy orders loaded").with_data(data))
    }
}

// ------------------------------------------------------------------------
// etsy_draft_listing_create
// ------------------------------------------------------------------------

pub struct EtsyDraftListingCreateTool;

#[async_trait]
impl Tool for EtsyDraftListingCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "etsy_draft_listing_create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "etsy_draft_listing_create".into(),
            description:
                "Create a draft Etsy physical listing for human review. Required: shop_id, title, description, price, quantity, who_made, when_made, taxonomy_id, shipping_profile_id. Optional `extra` object is passed through as additional form fields."
                    .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "shop_id": { "type": "integer" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "price": { "type": "string" },
                    "quantity": { "type": "integer", "minimum": 1 },
                    "who_made": { "type": "string", "description": "i_did | someone_else | collective" },
                    "when_made": { "type": "string", "description": "made_to_order or Etsy year bucket" },
                    "taxonomy_id": { "type": "integer" },
                    "shipping_profile_id": { "type": "integer" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "materials": { "type": "array", "items": { "type": "string" } },
                    "extra": { "type": "object", "additionalProperties": true }
                },
                "required": [
                    "shop_id",
                    "title",
                    "description",
                    "price",
                    "quantity",
                    "who_made",
                    "when_made",
                    "taxonomy_id",
                    "shipping_profile_id"
                ]
            }),
        }
    }

    fn name(&self) -> &str {
        "etsy_draft_listing_create"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need(vec![LISTINGS_W])]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let Some(cred) = first_cred(credentials) else {
            return Ok(missing_credential());
        };
        let shop_id = match optional_u64(&args, "shop_id") {
            Some(id) => id,
            None => return Ok(ToolResult::error("missing or invalid 'shop_id'")),
        };

        let mut form = BTreeMap::new();
        for key in ["title", "description", "price", "who_made", "when_made"] {
            let value = match require_str(&args, key) {
                Ok(value) => value,
                Err(err) => return Ok(*err),
            };
            form.insert(key.to_string(), value.to_string());
        }
        for key in ["quantity", "taxonomy_id", "shipping_profile_id"] {
            let value = match optional_u64(&args, key) {
                Some(value) => value,
                None => return Ok(ToolResult::error(format!("missing or invalid '{key}'"))),
            };
            form.insert(key.to_string(), value.to_string());
        }
        for key in ["tags", "materials"] {
            if let Some(values) = args.get(key).and_then(|v| v.as_array()) {
                let joined = values
                    .iter()
                    .filter_map(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(",");
                if !joined.is_empty() {
                    form.insert(key.to_string(), joined);
                }
            }
        }
        if let Some(extra) = args.get("extra").and_then(|v| v.as_object()) {
            for (key, value) in extra {
                let Some(value) = value
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| value.as_i64().map(|n| n.to_string()))
                    .or_else(|| value.as_u64().map(|n| n.to_string()))
                    .or_else(|| value.as_f64().map(|n| n.to_string()))
                    .or_else(|| value.as_bool().map(|b| b.to_string()))
                else {
                    continue;
                };
                form.insert(key.clone(), value);
            }
        }

        let client = EtsyApiClient::new(&cred);
        let data = match client
            .post_form(format!("/shops/{shop_id}/listings"), &form)
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        Ok(ToolResult::success("etsy draft listing created").with_data(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::credentials::ScopeHint;

    #[test]
    fn all_tools_have_stable_provider_and_underscore_names() {
        let names = all_tools()
            .into_iter()
            .map(|tool| tool.name().to_string())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "etsy_shops_list",
                "etsy_shop_get",
                "etsy_listings_list",
                "etsy_orders_list",
                "etsy_draft_listing_create",
            ]
        );
        assert!(names.iter().all(|name| {
            name.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
        }));
    }

    #[test]
    fn tools_declare_company_scoped_oauth_credentials() {
        for tool in all_tools() {
            let needs = tool.required_credentials();
            assert_eq!(needs.len(), 1, "{} credential count", tool.name());
            let need = &needs[0];
            assert_eq!(need.provider, PROVIDER);
            assert_eq!(need.name, CREDENTIAL_NAME);
            assert_eq!(need.scope_hint, ScopeHint::Company);
            assert!(!need.optional);
            assert!(
                !need.oauth_scopes.is_empty(),
                "{} must declare narrow Etsy scopes",
                tool.name()
            );
        }
    }

    #[test]
    fn only_draft_listing_create_is_destructive() {
        for tool in all_tools() {
            let destructive = tool.is_destructive(&json!({}));
            assert_eq!(
                destructive,
                tool.name() == "etsy_draft_listing_create",
                "{} destructive boundary drifted",
                tool.name()
            );
        }
    }
}
