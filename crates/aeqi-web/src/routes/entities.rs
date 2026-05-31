use axum::{
    Json, Router, extract::State, response::IntoResponse, response::Response, routing::get,
};

use super::helpers::ipc_proxy;
use crate::auth::Claims;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/companies", get(list_companies).post(create_company))
        .route(
            "/companies/{name}",
            axum::routing::put(update_company_handler),
        )
        .route(
            "/companies/{company_id}/channels",
            get(list_entity_channels).post(create_entity_channel),
        )
        .route(
            "/companies/{company_id}/cap-table",
            get(list_cap_table_entries),
        )
        .route(
            "/companies/{company_id}/views",
            get(list_views).put(upsert_views),
        )
        .route(
            "/companies/{company_id}/views/{view_id}",
            axum::routing::delete(delete_view),
        )
        .route("/entities", get(list_entities).post(create_entity))
        .route(
            "/entities/{name}",
            axum::routing::put(update_entity_handler),
        )
        // In-app, Slack-style channels — Phase-1 of the Channels surface.
        // Distinct from `/channels/*` which routes transport channels
        // (Telegram / WhatsApp / Slack-app webhook bindings).
        .route(
            "/entities/{company_id}/channels",
            get(list_entity_channels).post(create_entity_channel),
        )
        .route(
            "/entities/{company_id}/cap-table",
            get(list_cap_table_entries),
        )
        .route(
            "/entities/{company_id}/views",
            get(list_views).put(upsert_views),
        )
        .route(
            "/entities/{company_id}/views/{view_id}",
            axum::routing::delete(delete_view),
        )
}

async fn list_cap_table_entries(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(company_id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_cap_table_entries",
        serde_json::json!({"company_id": company_id}),
    )
    .await
}

async fn list_views(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(company_id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_views",
        serde_json::json!({"company_id": company_id}),
    )
    .await
}

async fn upsert_views(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(company_id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["company_id"] = serde_json::Value::String(company_id);
    ipc_proxy(state, scope.as_ref(), "upsert_views", params).await
}

async fn delete_view(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path((company_id, view_id)): axum::extract::Path<(String, String)>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "delete_view",
        serde_json::json!({"company_id": company_id, "view_id": view_id}),
    )
    .await
}

async fn list_entity_channels(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(company_id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_channels_for_entity",
        serde_json::json!({"company_id": company_id}),
    )
    .await
}

async fn create_entity_channel(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(company_id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["company_id"] = serde_json::Value::String(company_id);
    ipc_proxy(state, scope.as_ref(), "create_channel", params).await
}

async fn list_entities(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "entities", serde_json::Value::Null).await
}

async fn list_companies(State(state): State<AppState>, scope: Scope) -> Response {
    let params = if let Some(scope_ref) = scope.as_ref() {
        serde_json::json!({
            "allowed_roots": scope_ref.roots,
            "caller_user_id": scope_ref.user_id,
        })
    } else {
        serde_json::json!({})
    };
    let resp = state
        .ipc
        .cmd_with("entities", params)
        .await
        .unwrap_or_else(|e| serde_json::json!({"ok": false, "error": e.to_string()}));
    if resp.get("ok") == Some(&serde_json::Value::Bool(false)) {
        return Json(resp).into_response();
    }
    let companies = resp
        .get("roots")
        .or_else(|| resp.get("entities"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    let companies = match companies {
        serde_json::Value::Array(rows) => serde_json::Value::Array(
            rows.into_iter()
                .map(|mut company| {
                    if let serde_json::Value::Object(obj) = &mut company {
                        obj.insert(
                            "type".to_string(),
                            serde_json::Value::String("company".to_string()),
                        );
                    }
                    company
                })
                .collect(),
        ),
        other => other,
    };
    Json(serde_json::json!({
        "ok": true,
        "companies": companies,
    }))
    .into_response()
}

async fn create_company(
    State(state): State<AppState>,
    scope: Scope,
    req: axum::extract::Request,
) -> Response {
    create_company_inner(state, scope, req, "create_company").await
}

async fn create_entity(
    State(state): State<AppState>,
    scope: Scope,
    req: axum::extract::Request,
) -> Response {
    create_company_inner(state, scope, req, "create_entity").await
}

async fn create_company_inner(
    state: AppState,
    scope: Scope,
    req: axum::extract::Request,
    log_action: &'static str,
) -> Response {
    // Extract claims and body.
    let claims = req.extensions().get::<Claims>().cloned();
    let body: serde_json::Value = match axum::body::to_bytes(req.into_body(), 1_048_576).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    };

    let mut params = if body.is_null() {
        serde_json::json!({})
    } else {
        body
    };
    if let Some(scope_ref) = scope.as_ref() {
        params["allowed_roots"] = serde_json::json!(scope_ref.roots);
        if let Some(uid) = scope_ref.user_id.as_deref() {
            params["caller_user_id"] = serde_json::Value::String(uid.to_string());
        }
    }

    let resp = match if params.is_null() || params.as_object().is_some_and(|m| m.is_empty()) {
        state.ipc.cmd("create_entity").await
    } else {
        state.ipc.cmd_with("create_entity", params.clone()).await
    } {
        Ok(resp) => resp,
        Err(e) => {
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    if resp.get("ok") == Some(&serde_json::Value::Bool(true))
        && let (Some(accounts), Some(claims)) = (&state.accounts, &claims)
        && let Some(user_id) = claims.user_id.as_deref()
        && let Some(company_id) = resp.get("id").and_then(|v| v.as_str())
        && let Err(err) = accounts.add_director(user_id, company_id)
    {
        tracing::warn!(
            user_id,
            company_id,
            action = log_action,
            "failed to link company to user: {err}"
        );
    }

    Json(resp).into_response()
}

async fn update_company_handler(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    update_company_inner(state, scope, name, body).await
}

async fn update_entity_handler(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    update_company_inner(state, scope, name, body).await
}

async fn update_company_inner(
    state: AppState,
    scope: Scope,
    name: String,
    body: serde_json::Value,
) -> Response {
    let mut params = body;
    params["name"] = serde_json::Value::String(name);
    ipc_proxy(state, scope.as_ref(), "update_entity", params).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::config::{AuthConfig, AuthMode};
    use axum::{Router, body::Body, http::Request};
    use std::{path::PathBuf, sync::Arc};
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::UnixListener,
        sync::oneshot,
    };
    use tower::ServiceExt;

    fn test_hosting() -> Arc<dyn aeqi_hosting::HostingProvider> {
        let config = aeqi_hosting::HostingConfig {
            provider: "none".to_string(),
            local: None,
            managed: None,
        };
        Arc::from(aeqi_hosting::from_config(&config).unwrap())
    }

    fn test_state(socket_path: PathBuf, data_dir: PathBuf) -> AppState {
        AppState {
            ipc: Arc::new(crate::ipc::IpcClient::new(socket_path)),
            auth_secret: None,
            auth_mode: AuthMode::None,
            auth_config: AuthConfig::default(),
            ui_dist_dir: None,
            accounts: None,
            wallets: Arc::new(
                crate::wallets::WalletContext::bootstrap("aeqi-dev", &data_dir).unwrap(),
            ),
            passkeys: Arc::new(
                crate::passkey::PasskeyContext::bootstrap("http://localhost:8400").unwrap(),
            ),
            smtp: None,
            hosting: test_hosting(),
            twilio_auth_token: None,
            data_dir,
            default_blueprint_slug: "aeqi".to_string(),
            model_catalog_policy: crate::model_catalog::ModelCatalogPolicy::default(),
            mcp_projects: Vec::new(),
            bootstrap_registry: Arc::new(crate::routes::integrations::BootstrapRegistry::new()),
        }
    }

    async fn serve_one_ipc_request(
        socket_path: PathBuf,
        captured: oneshot::Sender<serde_json::Value>,
        response: serde_json::Value,
    ) {
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path).unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        let (reader, mut writer) = stream.into_split();
        let mut lines = BufReader::new(reader).lines();
        let line = lines.next_line().await.unwrap().unwrap();
        let request: serde_json::Value = serde_json::from_str(&line).unwrap();
        let _ = captured.send(request);
        let mut bytes = serde_json::to_vec(&response).unwrap();
        bytes.push(b'\n');
        writer.write_all(&bytes).await.unwrap();
    }

    async fn exercise_cap_table_route(path: &str) -> (axum::http::StatusCode, serde_json::Value) {
        let temp = tempfile::tempdir().unwrap();
        let socket_path = temp.path().join("rm.sock");
        let (tx, rx) = oneshot::channel();
        tokio::spawn(serve_one_ipc_request(
            socket_path.clone(),
            tx,
            serde_json::json!({
                "ok": true,
                "company_id": "company-route-test",
                "entries": []
            }),
        ));

        let app = Router::new()
            .nest("/api", crate::routes::api_routes())
            .with_state(test_state(socket_path, temp.path().to_path_buf()));
        let response = app
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let request = rx.await.unwrap();

        assert_eq!(request["cmd"], "list_cap_table_entries");
        assert_eq!(request["company_id"], "company-route-test");

        (status, json)
    }

    async fn exercise_views_route(
        method: axum::http::Method,
        path: &str,
        body: serde_json::Value,
    ) -> (axum::http::StatusCode, serde_json::Value, serde_json::Value) {
        let temp = tempfile::tempdir().unwrap();
        let socket_path = temp.path().join("rm.sock");
        let (tx, rx) = oneshot::channel();
        tokio::spawn(serve_one_ipc_request(
            socket_path.clone(),
            tx,
            serde_json::json!({
                "ok": true,
                "company_id": "company-route-test",
                "views": []
            }),
        ));

        let request_body = if body.is_null() {
            Body::empty()
        } else {
            Body::from(serde_json::to_vec(&body).unwrap())
        };
        let app = Router::new()
            .nest("/api", crate::routes::api_routes())
            .with_state(test_state(socket_path, temp.path().to_path_buf()));
        let response = app
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(request_body)
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 2048)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let request = rx.await.unwrap();
        (status, json, request)
    }

    #[tokio::test]
    async fn companies_cap_table_route_dispatches_to_ipc() {
        let (status, json) =
            exercise_cap_table_route("/api/companies/company-route-test/cap-table").await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(json["ok"], true);
        assert_eq!(json["company_id"], "company-route-test");
        assert_eq!(json["entries"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn entities_cap_table_route_dispatches_to_ipc() {
        let (status, json) =
            exercise_cap_table_route("/api/entities/company-route-test/cap-table").await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(json["ok"], true);
        assert_eq!(json["company_id"], "company-route-test");
        assert_eq!(json["entries"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn companies_views_list_route_dispatches_to_ipc() {
        let (status, json, request) = exercise_views_route(
            axum::http::Method::GET,
            "/api/companies/company-route-test/views",
            serde_json::Value::Null,
        )
        .await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(request["cmd"], "list_views");
        assert_eq!(request["company_id"], "company-route-test");
        assert_eq!(json["ok"], true);
        assert_eq!(json["views"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn entities_views_upsert_route_dispatches_to_ipc_with_body() {
        let (status, _json, request) = exercise_views_route(
            axum::http::Method::PUT,
            "/api/entities/company-route-test/views",
            serde_json::json!({
                "views": [{"key": "overview", "label": "Overview"}]
            }),
        )
        .await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(request["cmd"], "upsert_views");
        assert_eq!(request["company_id"], "company-route-test");
        assert_eq!(request["views"][0]["key"], "overview");
    }

    #[tokio::test]
    async fn companies_views_delete_route_dispatches_to_ipc() {
        let (status, _json, request) = exercise_views_route(
            axum::http::Method::DELETE,
            "/api/companies/company-route-test/views/view-123",
            serde_json::Value::Null,
        )
        .await;

        assert_eq!(status, axum::http::StatusCode::OK);
        assert_eq!(request["cmd"], "delete_view");
        assert_eq!(request["company_id"], "company-route-test");
        assert_eq!(request["view_id"], "view-123");
    }
}
