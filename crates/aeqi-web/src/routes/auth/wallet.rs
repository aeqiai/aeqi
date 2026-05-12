//! Wallet sign-in / sign-up routes (SIWE).

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use rusqlite::params;
use serde::Deserialize;

use crate::auth;
use crate::server::AppState;

use super::ensure_account_wallet;

#[derive(Deserialize)]
pub struct WalletAuthBody {
    pub message: String,
    pub signature: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub invite_code: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/wallet/nonce", post(nonce_handler))
        .route("/api/auth/wallet/login", post(login_handler))
        .route("/api/auth/wallet/signup", post(signup_handler))
}

pub async fn nonce_handler(State(state): State<AppState>) -> Response {
    let nonce = state.wallets.nonces.issue();
    axum::Json(serde_json::json!({
        "ok": true,
        "nonce": nonce,
        "expires_in_seconds": 600,
        "domain": derive_domain(
            state
                .auth_config
                .base_url
                .as_deref()
                .unwrap_or("http://localhost:8400"),
        ),
    }))
    .into_response()
}

pub async fn login_handler(
    State(state): State<AppState>,
    _headers: HeaderMap,
    axum::Json(body): axum::Json<WalletAuthBody>,
) -> Response {
    let address = match verify_and_consume(&state, &body).await {
        Ok(addr) => addr,
        Err(resp) => return resp,
    };

    let address_lower = address.as_hex();
    let user_id = match resolve_user_by_address(&state, &address_lower).await {
        Some(uid) => uid,
        None => {
            return (
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({
                    "ok": false,
                    "error": "no account linked to this wallet — sign up first",
                })),
            )
                .into_response();
        }
    };

    let user = match state
        .accounts
        .as_ref()
        .and_then(|s| s.get_user_by_id(&user_id).ok().flatten())
    {
        Some(u) => u,
        None => {
            tracing::error!(user_id = %user_id, "wallet credential pointed at missing user");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": "user record missing"})),
            )
                .into_response();
        }
    };

    if let Err(e) = ensure_account_wallet(&state, &user.id).await {
        tracing::error!(user_id = %user.id, error = %e, "wallet login account wallet provisioning failed");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(
                serde_json::json!({"ok": false, "error": "failed to provision account wallet"}),
            ),
        )
            .into_response();
    }

    let user = match state
        .accounts
        .as_ref()
        .and_then(|s| s.get_user_by_id(&user_id).ok().flatten())
    {
        Some(u) => u,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": "user record missing"})),
            )
                .into_response();
        }
    };

    let token = auth::create_token(
        match auth::signing_secret(&state) {
            Ok(secret) => secret,
            Err(err) => return super::server_configuration_error(err),
        },
        24,
        Some(&user.id),
        Some(&user.email),
    )
    .map(|t| t)
    .unwrap_or_default();

    axum::Json(serde_json::json!({
        "ok": true,
        "token": token,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
        },
    }))
    .into_response()
}

pub async fn signup_handler(
    State(state): State<AppState>,
    _headers: HeaderMap,
    axum::Json(body): axum::Json<WalletAuthBody>,
) -> Response {
    let address = match verify_and_consume(&state, &body).await {
        Ok(addr) => addr,
        Err(resp) => return resp,
    };

    let address_lower = address.as_hex();

    if resolve_user_by_address(&state, &address_lower)
        .await
        .is_some()
    {
        return (
            StatusCode::CONFLICT,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": "this wallet is already linked to an account — log in instead",
            })),
        )
            .into_response();
    }

    let invite_code = body.invite_code.as_deref().unwrap_or("").trim();
    if state.auth_config.waitlist
        && (invite_code.is_empty() || !is_invite_valid(&state, invite_code))
    {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": "invite code required",
                "waitlist": true,
            })),
        )
            .into_response();
    }

    let synthetic_email = format!(
        "wallet+{}@aeqi.ai",
        &address_lower[2..10.min(address_lower.len())]
    );
    let name = body
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("User {}", &address_lower[2..6.min(address_lower.len())]));

    let password = uuid::Uuid::new_v4().to_string();
    let accounts = match state.accounts.as_ref() {
        Some(a) => a,
        None => {
            return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
        }
    };
    let user = match accounts
        .clone()
        .create_user_async(synthetic_email.clone(), name.clone(), password)
        .await
    {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("wallet signup error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": "failed to create account"})),
            )
                .into_response();
        }
    };

    if let Err(e) = link_external_primary_wallet(&state, &user.id, &address_lower).await {
        tracing::error!(user_id = %user.id, error = %e, "failed to link external wallet");
    }
    if let Err(e) = ensure_account_wallet(&state, &user.id).await {
        tracing::error!(user_id = %user.id, error = %e, "wallet signup account wallet provisioning failed");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(
                serde_json::json!({"ok": false, "error": "failed to provision account wallet"}),
            ),
        )
            .into_response();
    }

    if state.auth_config.waitlist && !invite_code.is_empty() {
        let _ = accounts.redeem_invite_code(invite_code, &user.id);
    }
    let _ = accounts.generate_invite_codes(&user.id, state.auth_config.invite_codes_per_user);

    let user = match accounts.get_user_by_id(&user.id) {
        Ok(Some(user)) => user,
        _ => user,
    };

    let token = match auth::create_token(
        match auth::signing_secret(&state) {
            Ok(secret) => secret,
            Err(err) => return super::server_configuration_error(err),
        },
        24,
        Some(&user.id),
        Some(&user.email),
    ) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("wallet signup token error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": "failed to create session"})),
            )
                .into_response();
        }
    };

    axum::Json(serde_json::json!({
        "ok": true,
        "token": token,
        "user": { "id": user.id, "email": user.email, "name": user.name },
        "primary_wallet": address_lower,
    }))
    .into_response()
}

async fn verify_and_consume(
    state: &AppState,
    body: &WalletAuthBody,
) -> Result<aeqi_wallets::Address, Response> {
    let Some(nonce) = extract_nonce(&body.message) else {
        return Err((
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": "SIWE message missing Nonce field",
            })),
        )
            .into_response());
    };

    if let Err(e) = state.wallets.nonces.consume(&nonce) {
        return Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response());
    }

    match aeqi_wallets::verify_siwe(&body.message, &body.signature, &nonce).await {
        Ok(addr) => Ok(addr),
        Err(e) => Err((
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": format!("SIWE verification failed: {e}"),
            })),
        )
            .into_response()),
    }
}

async fn resolve_user_by_address(state: &AppState, address_lower: &str) -> Option<String> {
    let db = state.wallets.db.clone();
    let addr = address_lower.to_string();
    let result = tokio::task::spawn_blocking(move || -> Result<Option<String>, anyhow::Error> {
        let conn = db.lock().expect("wallet db mutex poisoned");
        let user_id: Option<String> = conn
            .query_row(
                "SELECT user_id FROM user_wallets WHERE LOWER(address) = LOWER(?) LIMIT 1",
                params![addr],
                |row| row.get(0),
            )
            .ok();
        Ok(user_id)
    })
    .await;
    match result {
        Ok(Ok(uid)) => uid,
        _ => None,
    }
}

async fn link_external_primary_wallet(
    state: &AppState,
    user_id: &str,
    address_lower: &str,
) -> anyhow::Result<()> {
    let db = state.wallets.db.clone();
    let user_id = user_id.to_string();
    let address = address_lower.to_string();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let conn = db.lock().expect("wallet db mutex poisoned");
        conn.execute(
            r#"INSERT INTO user_wallets
               (id, user_id, address, pubkey, custody_state, is_primary,
                provisioned_by, server_share_ciphertext, added_at)
               VALUES (?, ?, ?, ?, 'self_custody', 1, 'user', NULL, ?)"#,
            params![
                uuid::Uuid::new_v4().to_string(),
                user_id,
                address,
                Vec::<u8>::new(),
                chrono::Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    })
    .await??;
    Ok(())
}

fn extract_nonce(message: &str) -> Option<String> {
    for line in message.lines() {
        if let Some(rest) = line.strip_prefix("Nonce: ") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

fn is_invite_valid(state: &AppState, code: &str) -> bool {
    state
        .accounts
        .as_ref()
        .and_then(|accounts| accounts.is_invite_code_valid(code).ok())
        .unwrap_or(false)
}

fn derive_domain(base_url: &str) -> String {
    base_url
        .strip_prefix("https://")
        .or_else(|| base_url.strip_prefix("http://"))
        .unwrap_or(base_url)
        .trim_end_matches('/')
        .to_string()
}
