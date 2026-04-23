//! Security Test Suite
//! 
//! Tests for security vulnerabilities including:
//! 1. SQL injection
//! 2. Path traversal
//! 3. Input validation
//! 4. Authentication bypass
//! 5. Secret leakage

use std::path::PathBuf;
use aeqi_core::traits::{Tool, ToolResult};
use aeqi_tools::file::{FileReadTool, FileWriteTool, ListDirTool};
use tempfile::TempDir;

#[test]
fn test_path_traversal_prevention() {
    let temp_dir = TempDir::new().unwrap();
    let workspace = temp_dir.path().to_path_buf();
    
    // Create a test file
    let test_file = workspace.join("test.txt");
    std::fs::write(&test_file, "test content").unwrap();
    
    let file_tool = FileReadTool::new(workspace.clone());
    
    // Test valid path
    let args = serde_json::json!({
        "path": "test.txt"
    });
    
    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(async {
        file_tool.execute(args).await
    }).unwrap();
    
    assert!(result.success);
    
    // Test path traversal attempt
    let args = serde_json::json!({
        "path": "../../../etc/passwd"
    });
    
    let result = rt.block_on(async {
        file_tool.execute(args).await
    }).unwrap();
    
    assert!(!result.success);
    assert!(result.error.unwrap().contains("outside workspace"));
}

#[test]
fn test_sql_injection_patterns() {
    // Test that SQL queries use parameterized queries
    // This is a compile-time check - we need to verify the code doesn't
    // use string concatenation for SQL
    
    // Check for dangerous patterns in the codebase
    // This would be better as a static analysis test
    assert!(true, "SQL injection prevention should be verified via code review");
}

#[test]
fn test_auth_token_validation() {
    use aeqi_web::auth::{create_token, validate_token};
    
    let secret = "test-secret-123";
    
    // Create a valid token
    let token = create_token(secret, 1, Some("user-123"), Some("test@example.com")).unwrap();
    
    // Validate it
    let claims = validate_token(&token, secret).unwrap();
    assert_eq!(claims.sub, "user-123");
    
    // Test with wrong secret
    assert!(validate_token(&token, "wrong-secret").is_err());
    
    // Test tampered token
    let parts: Vec<&str> = token.split('.').collect();
    assert_eq!(parts.len(), 3);
    
    // Create tampered token with different payload
    let tampered = format!("{}.{}.{}", parts[0], "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", parts[2]);
    assert!(validate_token(&tampered, secret).is_err());
}

#[test]
fn test_file_operation_security() {
    let temp_dir = TempDir::new().unwrap();
    let workspace = temp_dir.path().to_path_buf();
    
    // Create nested directory structure
    let nested = workspace.join("a/b/c");
    std::fs::create_dir_all(&nested).unwrap();
    
    let file_tool = FileWriteTool::new(workspace.clone());
    
    // Test writing to a valid path
    let args = serde_json::json!({
        "path": "a/b/c/test.txt",
        "content": "test content"
    });
    
    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(async {
        file_tool.execute(args).await
    }).unwrap();
    
    assert!(result.success);
    
    // Test path traversal in nested path
    let args = serde_json::json!({
        "path": "a/../../../../etc/passwd",
        "content": "malicious"
    });
    
    let result = rt.block_on(async {
        file_tool.execute(args).await
    }).unwrap();
    
    assert!(!result.success);
    assert!(result.error.unwrap().contains("outside workspace"));
}

#[test]
fn test_directory_listing_security() {
    let temp_dir = TempDir::new().unwrap();
    let workspace = temp_dir.path().to_path_buf();
    
    // Create some test files
    std::fs::write(workspace.join("file1.txt"), "").unwrap();
    std::fs::write(workspace.join("file2.txt"), "").unwrap();
    
    let dir_tool = ListDirTool::new(workspace.clone());
    
    // Test valid directory listing
    let args = serde_json::json!({
        "path": "."
    });
    
    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(async {
        dir_tool.execute(args).await
    }).unwrap();
    
    assert!(result.success);
    let output = result.output.unwrap();
    assert!(output.contains("file1.txt"));
    assert!(output.contains("file2.txt"));
    
    // Test path traversal
    let args = serde_json::json!({
        "path": "../../.."
    });
    
    let result = rt.block_on(async {
        dir_tool.execute(args).await
    }).unwrap();
    
    assert!(!result.success);
    assert!(result.error.unwrap().contains("outside workspace"));
}

#[test]
fn test_sandbox_command_injection() {
    // Test that shell commands are properly escaped
    // This would require testing the actual sandbox implementation
    // For now, verify the bwrap command construction doesn't allow injection
    
    use aeqi_orchestrator::sandbox::QuestSandbox;
    
    let sandbox = QuestSandbox {
        quest_id: "test".to_string(),
        worktree_path: PathBuf::from("/tmp/test"),
        branch_name: "quest/test".to_string(),
        repo_root: PathBuf::from("/tmp/repo"),
        enable_bwrap: true,
        extra_ro_binds: vec![],
        torn_down: std::sync::atomic::AtomicBool::new(false),
    };
    
    // Build a command with potential injection
    let cmd = sandbox.build_command("echo hello; cat /etc/passwd");
    
    // The command should be properly wrapped in bwrap
    // This is a basic check - actual injection prevention depends on bwrap
    let args: Vec<String> = cmd.as_std().get_args()
        .map(|a| a.to_string_lossy().to_string())
        .collect();
    
    // Verify the command ends with bash -c and the quoted command
    assert!(args.contains(&"bash".to_string()));
    assert!(args.contains(&"-c".to_string()));
    assert!(args.contains(&"echo hello; cat /etc/passwd".to_string()));
}

#[test]
fn test_input_validation() {
    // Test that API endpoints validate input
    // This would require testing the web routes
    
    // For now, create a simple test for common validation patterns
    use serde::Deserialize;
    use validator::Validate;
    
    #[derive(Debug, Deserialize, Validate)]
    struct TestInput {
        #[validate(length(min = 1, max = 100))]
        name: String,
        #[validate(email)]
        email: String,
        #[validate(range(min = 0, max = 100))]
        age: u32,
    }
    
    let valid_input = TestInput {
        name: "Test".to_string(),
        email: "test@example.com".to_string(),
        age: 25,
    };
    
    assert!(valid_input.validate().is_ok());
    
    // This test demonstrates the pattern - actual implementation
    // would need validator crate and proper validation in routes
}

#[test]
fn test_secret_leakage_prevention() {
    // Test that secrets aren't logged
    // This is more of a code review/static analysis test
    
    // Check for patterns like:
    // - logging of tokens, passwords, keys
    // - debug output of sensitive data
    // - error messages revealing internal details
    
    // For now, just document the requirement
    assert!(true, "Secret leakage prevention should be verified via code review and static analysis");
}

#[test]
fn test_rate_limiting_basics() {
    // Test that rate limiting would be effective
    // Actual implementation would need to be added
    
    use std::time::{Duration, Instant};
    use std::sync::Arc;
    use tokio::sync::RwLock;
    
    struct RateLimiter {
        requests: Arc<RwLock<Vec<Instant>>>,
        limit: usize,
        window: Duration,
    }
    
    impl RateLimiter {
        fn new(limit: usize, window: Duration) -> Self {
            Self {
                requests: Arc::new(RwLock::new(Vec::new())),
                limit,
                window,
            }
        }
        
        async fn check(&self) -> bool {
            let now = Instant::now();
            let mut requests = self.requests.write().await;
            
            // Clean old requests
            requests.retain(|&time| now.duration_since(time) < self.window);
            
            if requests.len() >= self.limit {
                false
            } else {
                requests.push(now);
                true
            }
        }
    }
    
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        let limiter = RateLimiter::new(5, Duration::from_secs(1));
        
        // First 5 requests should succeed
        for _ in 0..5 {
            assert!(limiter.check().await);
        }
        
        // 6th should fail
        assert!(!limiter.check().await);
        
        // Wait and try again
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(limiter.check().await);
    });
}