//! Secure path handling utilities
//!
//! Provides functions for secure path resolution and validation
//! to prevent path traversal attacks.

use anyhow::{Result, bail};
use std::path::{Path, PathBuf};

/// Securely resolves a path relative to a base directory,
/// preventing path traversal attacks.
///
/// This function:
/// 1. Resolves the path relative to the base directory
/// 2. Canonicalizes both paths to resolve symlinks
/// 3. Verifies the resolved path is within the base directory
/// 4. Returns an error if path traversal is attempted
///
/// # Arguments
/// * `base_dir` - The base directory to resolve paths from
/// * `requested_path` - The requested path (can be relative or absolute)
///
/// # Returns
/// * `Ok(PathBuf)` - The securely resolved canonical path
/// * `Err` - If path traversal is attempted or paths cannot be resolved
pub fn secure_resolve_path(base_dir: &Path, requested_path: &str) -> Result<PathBuf> {
    // Convert requested path to PathBuf
    let requested = Path::new(requested_path);

    // If path is absolute, we need to check if it's within base_dir
    // If relative, join it with base_dir
    let resolved = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        base_dir.join(requested)
    };

    // Attempt to canonicalize both paths
    // Note: canonicalize() follows symlinks, which is what we want for security checking
    let canonical_base = base_dir.canonicalize().map_err(|e| {
        anyhow::anyhow!(
            "failed to canonicalize base directory {}: {}",
            base_dir.display(),
            e
        )
    })?;

    let canonical_resolved = resolved.canonicalize().map_err(|e| {
        anyhow::anyhow!("failed to canonicalize path {}: {}", resolved.display(), e)
    })?;

    // Check if resolved path is within base directory
    if !canonical_resolved.starts_with(&canonical_base) {
        bail!(
            "path traversal attempt detected: {} is outside base directory {}",
            requested_path,
            base_dir.display()
        );
    }

    Ok(canonical_resolved)
}

/// Securely resolves a path for write operations where the file may not exist.
///
/// This function:
/// 1. Resolves the path relative to the base directory
/// 2. Canonicalizes the parent directory to resolve symlinks
/// 3. Verifies the parent directory is within the base directory
/// 4. Returns an error if path traversal is attempted
///
/// # Arguments
/// * `base_dir` - The base directory to resolve paths from
/// * `requested_path` - The requested path (can be relative or absolute)
///
/// # Returns
/// * `Ok(PathBuf)` - The securely resolved path
/// * `Err` - If path traversal is attempted or paths cannot be resolved
pub fn secure_resolve_path_for_write(base_dir: &Path, requested_path: &str) -> Result<PathBuf> {
    // Convert requested path to PathBuf
    let requested = Path::new(requested_path);

    // If path is absolute, we need to check if it's within base_dir
    // If relative, join it with base_dir
    let resolved = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        base_dir.join(requested)
    };

    // For write operations, the file and some parent directories may not exist yet.
    // Walk up to the nearest existing parent before canonicalizing.
    let parent = resolved.parent().unwrap_or_else(|| Path::new("."));
    let existing_parent = std::iter::successors(Some(parent), |path| path.parent())
        .find(|path| path.exists())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "failed to find an existing parent directory for {}",
                parent.display()
            )
        })?;

    let canonical_base = base_dir.canonicalize().map_err(|e| {
        anyhow::anyhow!(
            "failed to canonicalize base directory {}: {}",
            base_dir.display(),
            e
        )
    })?;

    let canonical_parent = existing_parent.canonicalize().map_err(|e| {
        anyhow::anyhow!(
            "failed to canonicalize parent directory {}: {}",
            existing_parent.display(),
            e
        )
    })?;

    // Check if parent directory is within base directory
    if !canonical_parent.starts_with(&canonical_base) {
        bail!(
            "path traversal attempt detected: parent of {} is outside base directory {}",
            requested_path,
            base_dir.display()
        );
    }

    Ok(resolved)
}

/// Validates that a path doesn't contain dangerous patterns.
///
/// This function checks for:
/// 1. Null bytes
/// 2. Path traversal sequences (`..`)
/// 3. Control characters
/// 4. Windows drive letters in Unix paths
///
/// # Arguments
/// * `path` - The path string to validate
///
/// # Returns
/// * `Ok(())` - If the path is safe
/// * `Err` - If the path contains dangerous patterns
pub fn validate_path_string(path: &str) -> Result<()> {
    // Check for null bytes
    if path.contains('\0') {
        bail!("path contains null byte");
    }

    // Check for path traversal
    if path.contains("..") {
        bail!("path contains traversal sequence '..'");
    }

    // Check for control characters
    if path.chars().any(|c| c.is_control()) {
        bail!("path contains control characters");
    }

    // On Unix, check for Windows drive letters (C:, D:, etc.)
    #[cfg(unix)]
    {
        if path.len() >= 2
            && path.chars().next().unwrap().is_ascii_alphabetic()
            && path.chars().nth(1) == Some(':')
        {
            bail!("path contains Windows drive letter");
        }
    }

    Ok(())
}

/// Combined secure path resolution with validation.
///
/// This is a convenience function that combines:
/// 1. Path string validation
/// 2. Secure path resolution
///
/// # Arguments
/// * `base_dir` - The base directory to resolve paths from
/// * `requested_path` - The requested path (can be relative or absolute)
///
/// # Returns
/// * `Ok(PathBuf)` - The securely resolved canonical path
/// * `Err` - If path is invalid or traversal is attempted
pub fn secure_path(base_dir: &Path, requested_path: &str) -> Result<PathBuf> {
    validate_path_string(requested_path)?;
    secure_resolve_path(base_dir, requested_path)
}

/// Combined secure path resolution for write operations with validation.
///
/// This is a convenience function that combines:
/// 1. Path string validation
/// 2. Secure path resolution for write operations
///
/// # Arguments
/// * `base_dir` - The base directory to resolve paths from
/// * `requested_path` - The requested path (can be relative or absolute)
///
/// # Returns
/// * `Ok(PathBuf)` - The securely resolved path
/// * `Err` - If path is invalid or traversal is attempted
pub fn secure_path_for_write(base_dir: &Path, requested_path: &str) -> Result<PathBuf> {
    validate_path_string(requested_path)?;
    secure_resolve_path_for_write(base_dir, requested_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_secure_resolve_path_valid() {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Create a test file
        let test_file = base.join("test.txt");
        fs::write(&test_file, "test").unwrap();

        // Test valid relative path
        let result = secure_resolve_path(base, "test.txt").unwrap();
        assert_eq!(result, test_file.canonicalize().unwrap());

        // Test valid absolute path
        let abs_path = test_file.canonicalize().unwrap();
        let result = secure_resolve_path(base, abs_path.to_str().unwrap()).unwrap();
        assert_eq!(result, abs_path);
    }

    #[test]
    fn test_secure_resolve_path_traversal() {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Create a test file
        let test_file = base.join("test.txt");
        fs::write(&test_file, "test").unwrap();

        // Test path traversal attempt
        let result = secure_resolve_path(base, "../../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("path traversal"));

        // Test with absolute path outside base
        let result = secure_resolve_path(base, "/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("path traversal"));
    }

    #[test]
    fn test_secure_resolve_path_for_write() {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Test creating new file in valid location
        let result = secure_resolve_path_for_write(base, "new/file.txt").unwrap();
        assert!(result.ends_with("new/file.txt"));

        // Test path traversal attempt
        let result = secure_resolve_path_for_write(base, "../../../etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("path traversal"));
    }

    #[test]
    fn test_validate_path_string() {
        // Test valid paths
        assert!(validate_path_string("file.txt").is_ok());
        assert!(validate_path_string("folder/file.txt").is_ok());
        assert!(validate_path_string("/absolute/path").is_ok());

        // Test invalid paths
        assert!(validate_path_string("file\0.txt").is_err());
        assert!(validate_path_string("..").is_err());
        assert!(validate_path_string("folder/../file.txt").is_err());
        assert!(validate_path_string("folder/\nfile.txt").is_err());

        #[cfg(unix)]
        {
            assert!(validate_path_string("C:/windows/path").is_err());
        }
    }

    #[test]
    fn test_secure_path_combined() {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Create a test file
        let test_file = base.join("test.txt");
        fs::write(&test_file, "test").unwrap();

        // Test valid path
        let result = secure_path(base, "test.txt").unwrap();
        assert_eq!(result, test_file.canonicalize().unwrap());

        // Test path with traversal - should fail validation before resolution
        let result = secure_path(base, "../test.txt");
        assert!(result.is_err());

        // Test path with null byte - should fail validation
        let result = secure_path(base, "file\0.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_symlink_protection() {
        let temp_dir = TempDir::new().unwrap();
        let base = temp_dir.path();

        // Create a directory structure
        let dir1 = base.join("dir1");
        let dir2 = base.join("dir2");
        fs::create_dir(&dir1).unwrap();
        fs::create_dir(&dir2).unwrap();

        // Create a file in dir1
        let file1 = dir1.join("secret.txt");
        fs::write(&file1, "secret").unwrap();

        // Create a symlink from dir2 to dir1
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let symlink_path = dir2.join("link");
            symlink(&dir1, &symlink_path).unwrap();

            // Try to access file through symlink
            let result = secure_resolve_path(base, "dir2/link/secret.txt");
            // This should succeed because canonicalize follows symlinks
            // and the final path is still within base
            assert!(result.is_ok());

            // Create a symlink pointing outside
            let outside_symlink = dir2.join("outside");
            symlink("/etc", &outside_symlink).unwrap();

            // Try to access through outside symlink
            let result = secure_resolve_path(base, "dir2/outside/passwd");
            // This should fail because canonical path is outside base
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("path traversal"));
        }
    }
}
