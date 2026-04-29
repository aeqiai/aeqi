//! Input validation for API endpoints
//!
//! Provides validation for all API inputs to prevent injection attacks,
//! ensure data integrity, and enforce business rules.

use axum::{
    Json,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use tracing::warn;
use validator::{Validate, ValidateEmail, ValidateUrl, ValidationErrors};

/// Validation error response
#[derive(Debug, serde::Serialize)]
pub struct ValidationErrorResponse {
    pub ok: bool,
    pub error: String,
    pub details: Option<Vec<ValidationErrorDetail>>,
}

#[derive(Debug, serde::Serialize)]
pub struct ValidationErrorDetail {
    pub field: String,
    pub message: String,
    pub code: String,
}

impl ValidationErrorResponse {
    pub fn new(error: String) -> Self {
        Self {
            ok: false,
            error,
            details: None,
        }
    }

    pub fn with_details(error: String, details: Vec<ValidationErrorDetail>) -> Self {
        Self {
            ok: false,
            error,
            details: Some(details),
        }
    }
}

impl IntoResponse for ValidationErrorResponse {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(self)).into_response()
    }
}

/// Convert validation errors to response
pub fn validation_errors_to_response(errors: &ValidationErrors) -> ValidationErrorResponse {
    let mut details = Vec::new();

    for (field, field_errors) in errors.field_errors() {
        for error in field_errors {
            details.push(ValidationErrorDetail {
                field: field.to_string(),
                message: error.message.clone().unwrap_or_default().to_string(),
                code: error.code.to_string(),
            });
        }
    }

    ValidationErrorResponse::with_details("Validation failed".to_string(), details)
}

/// Validate JSON request body
pub async fn validate_json_body<T>(body: Json<T>) -> Result<Json<T>, ValidationErrorResponse>
where
    T: Validate,
{
    if let Err(errors) = body.validate() {
        Err(validation_errors_to_response(&errors))
    } else {
        Ok(body)
    }
}

/// Middleware to validate request size
pub async fn request_size_limit_middleware(req: Request, next: Next) -> Response {
    // Get content-length header
    if let Some(content_length) = req.headers().get("content-length")
        && let Ok(length_str) = content_length.to_str()
        && let Ok(length) = length_str.parse::<usize>()
    {
        // Limit request body to 10MB
        const MAX_BODY_SIZE: usize = 10 * 1024 * 1024; // 10MB

        if length > MAX_BODY_SIZE {
            warn!(
                content_length = length,
                max_allowed = MAX_BODY_SIZE,
                "Request body too large"
            );

            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({
                    "ok": false,
                    "error": format!("Request body too large. Maximum size is {} bytes", MAX_BODY_SIZE)
                })),
            )
                .into_response();
        }
    }

    next.run(req).await
}

/// Validate that a string is not empty
pub fn validate_not_empty(value: &str) -> Result<(), validator::ValidationError> {
    if value.trim().is_empty() {
        return Err(validator::ValidationError::new("not_empty"));
    }
    Ok(())
}

/// Validate that a string is a valid identifier (alphanumeric, hyphen, underscore)
pub fn validate_identifier(value: &str) -> Result<(), validator::ValidationError> {
    if value.is_empty() {
        return Err(validator::ValidationError::new("not_empty"));
    }

    if !value
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(validator::ValidationError::new("invalid_identifier"));
    }

    Ok(())
}

/// Validate that a string is a valid UUID
pub fn validate_uuid(value: &str) -> Result<(), validator::ValidationError> {
    if uuid::Uuid::parse_str(value).is_err() {
        return Err(validator::ValidationError::new("invalid_uuid"));
    }
    Ok(())
}

/// Validate that a string is a valid email address
pub fn validate_email(value: &str) -> Result<(), validator::ValidationError> {
    if !value.validate_email() {
        return Err(validator::ValidationError::new("invalid_email"));
    }
    Ok(())
}

/// Validate that a string is a valid URL
pub fn validate_url(value: &str) -> Result<(), validator::ValidationError> {
    if !value.validate_url() {
        return Err(validator::ValidationError::new("invalid_url"));
    }
    Ok(())
}

/// Validate that a number is within a range
pub fn validate_range<T>(value: T, min: T, max: T) -> Result<(), validator::ValidationError>
where
    T: PartialOrd + std::fmt::Display,
{
    if value < min || value > max {
        return Err(validator::ValidationError::new("out_of_range"));
    }
    Ok(())
}

/// Validate that a string doesn't contain dangerous patterns
pub fn validate_safe_string(value: &str) -> Result<(), validator::ValidationError> {
    // Check for null bytes
    if value.contains('\0') {
        return Err(validator::ValidationError::new("contains_null_byte"));
    }

    // Check for control characters (except whitespace)
    if value.chars().any(|c| c.is_control() && !c.is_whitespace()) {
        return Err(validator::ValidationError::new("contains_control_chars"));
    }

    // Check for path traversal patterns
    if value.contains("..") {
        return Err(validator::ValidationError::new("contains_path_traversal"));
    }

    // Check for SQL injection patterns (basic)
    let sql_keywords = [
        "SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER",
    ];
    let upper_value = value.to_uppercase();
    for keyword in sql_keywords {
        if upper_value.contains(keyword) && upper_value.contains("FROM") {
            return Err(validator::ValidationError::new("contains_sql_patterns"));
        }
    }

    Ok(())
}

/// Validate that a string is a valid file path (no traversal, no null bytes)
pub fn validate_file_path(value: &str) -> Result<(), validator::ValidationError> {
    validate_safe_string(value)?;

    // Check for absolute paths (on Unix)
    #[cfg(unix)]
    {
        if value.starts_with('/') {
            return Err(validator::ValidationError::new("absolute_path_not_allowed"));
        }
    }

    // Check for Windows drive letters
    #[cfg(windows)]
    {
        if value.len() >= 2
            && value.chars().next().unwrap().is_ascii_alphabetic()
            && value.chars().nth(1) == Some(':')
        {
            return Err(validator::ValidationError::new("windows_drive_not_allowed"));
        }
    }

    Ok(())
}

/// Common validation structs for API endpoints

#[derive(Debug, Deserialize, Validate)]
pub struct CreateQuestRequest {
    #[validate(length(min = 1, max = 200))]
    pub subject: String,

    #[validate(length(max = 5000))]
    pub description: Option<String>,

    #[validate(custom(function = "validate_identifier"))]
    pub agent: Option<String>,

    #[validate(custom(function = "validate_identifier"))]
    pub project: Option<String>,

    #[validate(custom(function = "validate_safe_string"))]
    pub context: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateQuestRequest {
    #[validate(length(min = 1, max = 200))]
    pub subject: Option<String>,

    #[validate(length(max = 5000))]
    pub description: Option<String>,

    #[validate(custom(function = "validate_identifier"))]
    pub agent: Option<String>,

    #[validate(custom(function = "validate_identifier"))]
    pub project: Option<String>,

    #[validate(custom(function = "validate_safe_string"))]
    pub context: Option<String>,

    pub status: Option<String>,
    pub priority: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateAgentRequest {
    #[validate(length(min = 1, max = 100))]
    #[validate(custom(function = "validate_identifier"))]
    pub name: String,

    #[validate(length(max = 5000))]
    pub system_prompt: Option<String>,

    pub model: Option<String>,

    #[validate(custom(function = "validate_identifier"))]
    pub parent_agent_id: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct CreateIdeaRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: String,

    #[validate(length(max = 10000))]
    pub content: String,

    #[validate(length(max = 20))]
    pub tags: Option<Vec<String>>,

    #[validate(custom(function = "validate_identifier"))]
    pub agent_id: Option<String>,

    pub scope: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct FileOperationRequest {
    #[validate(custom(function = "validate_file_path"))]
    pub path: String,

    #[validate(length(max = 10485760))] // 10MB max
    pub content: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct AuthRequest {
    #[validate(custom(function = "validate_email"))]
    pub email: String,

    #[validate(length(min = 8, max = 100))]
    pub password: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct TokenRequest {
    #[validate(length(min = 10))]
    pub token: String,
}

/// Middleware to validate content-type header
pub async fn validate_content_type_middleware(req: Request, next: Next) -> Response {
    // Only validate for POST, PUT, PATCH requests with body
    if matches!(req.method().as_str(), "POST" | "PUT" | "PATCH") {
        if let Some(content_type) = req.headers().get("content-type") {
            if let Ok(content_type_str) = content_type.to_str() {
                // Allow application/json and application/x-www-form-urlencoded
                if !content_type_str.starts_with("application/json")
                    && !content_type_str.starts_with("application/x-www-form-urlencoded")
                {
                    warn!(
                        content_type = content_type_str,
                        "Invalid content-type header"
                    );

                    return (
                        StatusCode::UNSUPPORTED_MEDIA_TYPE,
                        Json(serde_json::json!({
                            "ok": false,
                            "error": "Invalid content-type. Expected application/json or application/x-www-form-urlencoded"
                        })),
                    ).into_response();
                }
            }
        } else if req.headers().contains_key("content-length") {
            // Has content but no content-type
            warn!("Missing content-type header for request with body");

            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "error": "Missing content-type header"
                })),
            )
                .into_response();
        }
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing::post,
    };
    use serde_json::json;
    use tower::ServiceExt;

    #[derive(Debug, Deserialize, Validate)]
    struct TestRequest {
        #[validate(length(min = 1, max = 10))]
        name: String,

        #[validate(range(min = 0, max = 100))]
        age: u32,

        #[validate(email)]
        email: String,
    }

    async fn test_handler(Json(body): Json<TestRequest>) -> Response {
        match validate_json_body(Json(body)).await {
            Ok(_) => (StatusCode::OK, Json(json!({"ok": true}))).into_response(),
            Err(err) => err.into_response(),
        }
    }

    #[tokio::test]
    async fn test_validation_middleware_integration() {
        let app = Router::new().route("/test", post(test_handler));

        // Test valid request
        let valid_body = json!({
            "name": "Test",
            "age": 25,
            "email": "test@example.com"
        });

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/test")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&valid_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Test invalid request
        let invalid_body = json!({
            "name": "", // Empty - should fail
            "age": 150, // Out of range - should fail
            "email": "not-an-email" // Invalid email - should fail
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/test")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&invalid_body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_validate_not_empty() {
        assert!(validate_not_empty("test").is_ok());
        assert!(validate_not_empty("").is_err());
        assert!(validate_not_empty("   ").is_err());
    }

    #[test]
    fn test_validate_identifier() {
        assert!(validate_identifier("test-123").is_ok());
        assert!(validate_identifier("test_123").is_ok());
        assert!(validate_identifier("test123").is_ok());
        assert!(validate_identifier("").is_err());
        assert!(validate_identifier("test@123").is_err()); // @ not allowed
        assert!(validate_identifier("test.123").is_err()); // . not allowed
    }

    #[test]
    fn test_validate_safe_string() {
        assert!(validate_safe_string("test").is_ok());
        assert!(validate_safe_string("test\0test").is_err()); // null byte
        assert!(validate_safe_string("test..test").is_err()); // path traversal
        assert!(validate_safe_string("test\ntest").is_ok()); // newline is allowed whitespace
        assert!(validate_safe_string("test\u{0007}test").is_err()); // non-whitespace control char
        assert!(validate_safe_string("test SELECT FROM test").is_err()); // SQL pattern
    }

    #[test]
    fn test_validate_file_path() {
        assert!(validate_file_path("test.txt").is_ok());
        assert!(validate_file_path("folder/test.txt").is_ok());
        assert!(validate_file_path("../test.txt").is_err()); // path traversal

        #[cfg(unix)]
        {
            assert!(validate_file_path("/etc/passwd").is_err()); // absolute path
        }

        #[cfg(windows)]
        {
            assert!(validate_file_path("C:\\test.txt").is_err()); // windows drive
        }
    }

    #[test]
    fn test_create_quest_request_validation() {
        let valid = CreateQuestRequest {
            subject: "Test quest".to_string(),
            description: Some("Test description".to_string()),
            agent: Some("test-agent".to_string()),
            project: Some("test-project".to_string()),
            context: Some("test context".to_string()),
        };

        assert!(valid.validate().is_ok());

        let invalid = CreateQuestRequest {
            subject: "".to_string(),               // Empty - should fail
            description: Some("a".repeat(6000)),   // Too long - should fail
            agent: Some("test@agent".to_string()), // Invalid identifier - should fail
            project: Some("test-project".to_string()),
            context: Some("test\0context".to_string()), // Null byte - should fail
        };

        assert!(invalid.validate().is_err());
    }
}
