use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

pub type ApiResult<T = Response> = Result<T, ApiError>;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    BadGateway(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            Self::Unauthorized(m) => (StatusCode::UNAUTHORIZED, m),
            Self::Forbidden(m) => (StatusCode::FORBIDDEN, m),
            Self::NotFound(m) => (StatusCode::NOT_FOUND, m),
            Self::Conflict(m) => (StatusCode::CONFLICT, m),
            Self::BadGateway(m) => (StatusCode::BAD_GATEWAY, m),
            Self::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (
            status,
            Json(serde_json::json!({"ok": false, "error": message})),
        )
            .into_response()
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(m) => write!(f, "bad request: {m}"),
            Self::Unauthorized(m) => write!(f, "unauthorized: {m}"),
            Self::Forbidden(m) => write!(f, "forbidden: {m}"),
            Self::NotFound(m) => write!(f, "not found: {m}"),
            Self::Conflict(m) => write!(f, "conflict: {m}"),
            Self::BadGateway(m) => write!(f, "bad gateway: {m}"),
            Self::Internal(m) => write!(f, "internal error: {m}"),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    #[test]
    fn api_error_bad_request_returns_400() {
        let resp = ApiError::BadRequest("invalid input".into()).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn api_error_unauthorized_returns_401() {
        let resp = ApiError::Unauthorized("no token".into()).into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn api_error_forbidden_returns_403() {
        let resp = ApiError::Forbidden("access denied".into()).into_response();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn api_error_not_found_returns_404() {
        let resp = ApiError::NotFound("missing".into()).into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn api_error_conflict_returns_409() {
        let resp = ApiError::Conflict("duplicate".into()).into_response();
        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn api_error_bad_gateway_returns_502() {
        let resp = ApiError::BadGateway("upstream down".into()).into_response();
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn api_error_internal_returns_500() {
        let resp = ApiError::Internal("something broke".into()).into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn api_error_response_body_is_json_with_ok_false() {
        let resp = ApiError::BadRequest("test error".into()).into_response();
        let body = axum::body::to_bytes(resp.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(json["ok"], false);
        assert_eq!(json["error"], "test error");
    }

    #[test]
    fn api_error_display() {
        assert_eq!(
            ApiError::BadRequest("x".into()).to_string(),
            "bad request: x"
        );
        assert_eq!(
            ApiError::Unauthorized("x".into()).to_string(),
            "unauthorized: x"
        );
        assert_eq!(ApiError::Forbidden("x".into()).to_string(), "forbidden: x");
        assert_eq!(ApiError::NotFound("x".into()).to_string(), "not found: x");
        assert_eq!(ApiError::Conflict("x".into()).to_string(), "conflict: x");
        assert_eq!(
            ApiError::BadGateway("x".into()).to_string(),
            "bad gateway: x"
        );
        assert_eq!(
            ApiError::Internal("x".into()).to_string(),
            "internal error: x"
        );
    }

    #[test]
    fn api_error_from_anyhow() {
        let anyhow_err = anyhow::anyhow!("something failed");
        let api_err = ApiError::from(anyhow_err);
        match api_err {
            ApiError::Internal(msg) => assert_eq!(msg, "something failed"),
            other => panic!("expected Internal, got {:?}", other),
        }
    }
}
