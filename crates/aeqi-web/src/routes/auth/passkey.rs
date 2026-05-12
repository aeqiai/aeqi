//! Passkey (WebAuthn) sign-up / log-in routes.

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use uuid::Uuid;
use webauthn_rs::prelude::*;

use crate::auth;
use crate::server::AppState;

use super::ensure_account_wallet;

#[derive(Deserialize)]
pub struct RegisterBeginBody {
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct RegisterFinishBody {
    pub session_id: String,
    pub credential: RegisterPublicKeyCredential,
    #[serde(default)]
    pub invite_code: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginFinishBody {
    pub session_id: String,
    pub credential: PublicKeyCredential,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/auth/passkey/register-begin",
            post(register_begin_handler),
        )
        .route(
            "/api/auth/passkey/register-finish",
            post(register_finish_handler),
        )
        .route("/api/auth/passkey/login-begin", post(login_begin_handler))
        .route("/api/auth/passkey/login-finish", post(login_finish_handler))
}

pub async fn register_begin_handler(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<RegisterBeginBody>,
) -> Response {
    let user_id = Uuid::new_v4().to_string();
    let display_name = body
        .name
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("User {}", &user_id[..6]));

    let res = state.passkeys.webauthn.start_passkey_registration(
        Uuid::parse_str(&user_id).unwrap(),
        &display_name,
        &display_name,
        None,
    );

    match res {
        Ok((challenge, registration)) => {
            let session_id = Uuid::new_v4().to_string();
            state
                .passkeys
                .registrations
                .lock()
                .expect("registrations mutex poisoned")
                .insert(
                    session_id.clone(),
                    crate::passkey::PendingRegistration {
                        user_id,
                        state: registration,
                    },
                );
            axum::Json(serde_json::json!({
                "ok": true,
                "session_id": session_id,
                "publicKey": challenge.public_key,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "passkey register-begin failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response()
        }
    }
}

pub async fn register_finish_handler(
    State(state): State<AppState>,
    _headers: HeaderMap,
    axum::Json(body): axum::Json<RegisterFinishBody>,
) -> Response {
    let pending = state
        .passkeys
        .registrations
        .lock()
        .expect("registrations mutex poisoned")
        .remove(&body.session_id);

    let Some(pending) = pending else {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": "registration session unknown or expired",
            })),
        )
            .into_response();
    };

    let invite_code = body.invite_code.as_deref().unwrap_or("").trim();
    if state.auth_config.waitlist && !invite_valid(&state, invite_code) {
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

    let passkey = match state
        .passkeys
        .webauthn
        .finish_passkey_registration(&body.credential, &pending.state)
    {
        Ok(pk) => pk,
        Err(e) => {
            tracing::error!(error = %e, "passkey register-finish failed");
            return (
                StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    let cred_short =
        hex::encode(&passkey.cred_id().as_ref()[..16.min(passkey.cred_id().as_ref().len())]);
    let synthetic_email = format!("passkey+{cred_short}@aeqi.ai");
    let display_name = format!("User {}", &pending.user_id[..6]);

    let accounts = match state.accounts.as_ref() {
        Some(a) => a,
        None => return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response(),
    };
    let user = match accounts
        .clone()
        .create_user_async(
            synthetic_email.clone(),
            display_name.clone(),
            Uuid::new_v4().to_string(),
        )
        .await
    {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("passkey signup error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": "failed to create account"})),
            )
                .into_response();
        }
    };

    if let Err(e) = crate::passkey::insert_credential(
        &state.wallets.db.lock().expect("wallet db mutex poisoned"),
        &user.id,
        &passkey,
    ) {
        tracing::error!(user_id = %user.id, error = %e, "failed to persist passkey credential");
    }

    if let Err(e) = ensure_account_wallet(&state, &user.id).await {
        tracing::error!(user_id = %user.id, error = %e, "passkey signup account wallet provisioning failed");
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
            tracing::error!("passkey signup token error: {e}");
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
    }))
    .into_response()
}

pub async fn login_begin_handler(State(state): State<AppState>) -> Response {
    let res = state.passkeys.webauthn.start_passkey_authentication(&[]);
    match res {
        Ok((challenge, auth_state)) => {
            let session_id = Uuid::new_v4().to_string();
            state
                .passkeys
                .authentications
                .lock()
                .expect("authentications mutex poisoned")
                .insert(session_id.clone(), auth_state);
            axum::Json(serde_json::json!({
                "ok": true,
                "session_id": session_id,
                "publicKey": challenge.public_key,
            }))
            .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "passkey login-begin failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response()
        }
    }
}

pub async fn login_finish_handler(
    State(state): State<AppState>,
    _headers: HeaderMap,
    axum::Json(body): axum::Json<LoginFinishBody>,
) -> Response {
    let auth_state = state
        .passkeys
        .authentications
        .lock()
        .expect("authentications mutex poisoned")
        .remove(&body.session_id);

    let Some(auth_state) = auth_state else {
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": "authentication session unknown or expired",
            })),
        )
            .into_response();
    };

    let result = match state
        .passkeys
        .webauthn
        .finish_passkey_authentication(&body.credential, &auth_state)
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "passkey login-finish failed");
            return (
                StatusCode::UNAUTHORIZED,
                axum::Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    let cred_id = result.cred_id().as_ref().to_vec();
    let db = state.wallets.db.clone();
    let cred_for_lookup = cred_id.clone();
    let stored = match tokio::task::spawn_blocking(
        move || -> anyhow::Result<Option<crate::passkey::StoredCredential>> {
            let conn = db.lock().expect("wallet db mutex poisoned");
            crate::passkey::get_credential_by_id(&conn, &cred_for_lookup)
        },
    )
    .await
    {
        Ok(Ok(Some(s))) => s,
        _ => {
            return (
                StatusCode::NOT_FOUND,
                axum::Json(serde_json::json!({
                    "ok": false,
                    "error": "no account linked to this passkey",
                })),
            )
                .into_response();
        }
    };

    let mut updated_pk = stored.passkey.clone();
    updated_pk.update_credential(&result);
    {
        let db = state.wallets.db.clone();
        let _ = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            let conn = db.lock().expect("wallet db mutex poisoned");
            crate::passkey::update_passkey(&conn, &cred_id, &updated_pk)
        })
        .await;
    }

    let user = match state
        .accounts
        .as_ref()
        .and_then(|s| s.get_user_by_id(&stored.user_id).ok().flatten())
    {
        Some(u) => u,
        None => {
            tracing::error!(user_id = %stored.user_id, "passkey points at missing user");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({"ok": false, "error": "user record missing"})),
            )
                .into_response();
        }
    };

    if let Err(e) = ensure_account_wallet(&state, &user.id).await {
        tracing::error!(user_id = %user.id, error = %e, "passkey login account wallet provisioning failed");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(
                serde_json::json!({"ok": false, "error": "failed to provision account wallet"}),
            ),
        )
            .into_response();
    }

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
            tracing::error!("passkey login token error: {e}");
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
    }))
    .into_response()
}

fn invite_valid(state: &AppState, code: &str) -> bool {
    state
        .accounts
        .as_ref()
        .and_then(|accounts| accounts.is_invite_code_valid(code).ok())
        .unwrap_or(false)
}
