//! File blob storage — the on-disk half of the Drive.
//!
//! Metadata (owner agent, name, mime, size) lives in the SQLite `files` table
//! maintained by `AgentRegistry`. The bytes live here, in `{data_dir}/files/`,
//! one file per row keyed by the file's UUID. We never trust the client-supplied
//! name for the filesystem — the UUID alone determines the blob path, so a
//! malicious upload can't escape the directory or overwrite siblings.

use anyhow::{Result, anyhow};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Maximum allowed size for a single uploaded file (25 MiB).
/// The web layer must enforce this before reading the full body into memory.
pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;

/// Write `contents` to `{files_dir}/{id}`, creating `files_dir` if needed.
/// Returns the absolute path that was written.
pub fn write_blob(files_dir: &Path, id: &str, contents: &[u8]) -> Result<PathBuf> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(anyhow!("invalid file id"));
    }
    if (contents.len() as u64) > MAX_FILE_BYTES {
        return Err(anyhow!("file exceeds {} byte limit", MAX_FILE_BYTES));
    }
    fs::create_dir_all(files_dir)?;
    let path = files_dir.join(id);
    let mut f = fs::File::create(&path)?;
    f.write_all(contents)?;
    f.sync_all()?;
    Ok(path)
}

/// Read the full blob at `{files_dir}/{id}` into memory.
pub fn read_blob(files_dir: &Path, id: &str) -> Result<Vec<u8>> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(anyhow!("invalid file id"));
    }
    let path = files_dir.join(id);
    Ok(fs::read(path)?)
}

/// Delete the blob at `{files_dir}/{id}`. Succeeds silently if the file is
/// already gone — DB metadata removal is the authoritative delete.
pub fn delete_blob(files_dir: &Path, id: &str) -> Result<()> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(anyhow!("invalid file id"));
    }
    let path = files_dir.join(id);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
