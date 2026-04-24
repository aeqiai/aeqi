//! Embedding-side helpers for the SQLite idea store.
//!
//! Vector persistence itself lives in [`crate::vector::VectorStore`]. This
//! module holds the thin helpers that bind vectors back to ideas: SHA256
//! content fingerprinting for cache lookups, and the cache-lookup query
//! against `idea_embeddings`.

use super::SqliteIdeas;
use anyhow::Result;
use rusqlite::Connection;
#[cfg(feature = "ann-sqlite-vec")]
use std::sync::atomic::{AtomicBool, Ordering};

/// Global flag set to true when sqlite-vec has been successfully auto-loaded
/// into the SQLite library. `sqlite::search::try_ann_search` consults this
/// (plus the per-connection probe) to decide whether the ANN path is
/// available.
#[cfg(feature = "ann-sqlite-vec")]
static VEC_EXTENSION_READY: AtomicBool = AtomicBool::new(false);

/// Returns true if the sqlite-vec extension has been registered for this
/// process and the `idea_vec` virtual table is therefore usable (subject to
/// the per-connection probe in the search path).
///
/// Called by `sqlite::search::try_ann_search` to short-circuit when the
/// extension didn't register at process boot — keeps the brute-force path
/// taking over without paying for a failed prepare on every query.
#[cfg(feature = "ann-sqlite-vec")]
pub(crate) fn vec_extension_ready() -> bool {
    VEC_EXTENSION_READY.load(Ordering::Relaxed)
}

/// Register the sqlite-vec extension once per process via
/// `sqlite3_auto_extension`. Every subsequent `Connection::open` then loads
/// the `vec0` module automatically, so we can issue `CREATE VIRTUAL TABLE
/// ... USING vec0(...)` without a per-connection load call.
///
/// MUST be called BEFORE the first `Connection::open` in the process — the
/// auto-extension only applies to subsequently-opened connections.
///
/// Feature-gated: a `--no-default-features` build compiles the no-op variant
/// and stays entirely on the brute-force cosine path.
#[cfg(feature = "ann-sqlite-vec")]
pub(crate) fn ensure_vec_extension_loaded_global() {
    use std::sync::Once;
    static INIT: Once = Once::new();

    INIT.call_once(|| {
        // The sqlite-vec C entry point is declared as `fn()` in the Rust
        // binding but SQLite auto-extensions are invoked with the standard
        // `(sqlite3*, char**, sqlite3_api_routines*) -> int` signature; C's
        // loose ABI makes this compatible as long as vec_init ignores the
        // args it doesn't declare. We transmute to the expected fn pointer
        // shape so rusqlite's FFI accepts it.
        //
        // This is the same trick asg017/sqlite-vec uses in its own rusqlite
        // integration test.
        //
        // Safety: sqlite3_auto_extension is the documented sqlite hook for
        // registering a core-linked extension. Calling it with a known-good
        // function pointer is sound. It returns SQLITE_OK on success.
        type AutoExtFn = unsafe extern "C" fn(
            db: *mut rusqlite::ffi::sqlite3,
            pz_err_msg: *mut *mut std::os::raw::c_char,
            api: *const rusqlite::ffi::sqlite3_api_routines,
        ) -> std::os::raw::c_int;
        let entry: AutoExtFn = unsafe {
            std::mem::transmute::<*const (), AutoExtFn>(sqlite_vec::sqlite3_vec_init as *const ())
        };
        let rc = unsafe { rusqlite::ffi::sqlite3_auto_extension(Some(entry)) };
        if rc != rusqlite::ffi::SQLITE_OK {
            tracing::warn!(rc, "sqlite3_auto_extension(sqlite_vec) failed");
            return;
        }
        VEC_EXTENSION_READY.store(true, Ordering::Relaxed);
    });
}

#[cfg(not(feature = "ann-sqlite-vec"))]
pub(crate) fn ensure_vec_extension_loaded_global() {}

/// Per-connection probe — confirms `vec_version()` works on this specific
/// connection. If it doesn't (e.g. the auto-extension fired too late because
/// the connection was opened before registration), log WARN and continue:
/// the brute-force fallback in `search.rs` and `vector.rs` still serves.
#[cfg(feature = "ann-sqlite-vec")]
pub(crate) fn ensure_vec_extension_loaded(conn: &Connection) -> Result<()> {
    if !VEC_EXTENSION_READY.load(Ordering::Relaxed) {
        return Ok(());
    }
    let probe: std::result::Result<String, _> =
        conn.query_row("SELECT vec_version()", [], |row| row.get(0));
    if let Err(e) = probe {
        tracing::warn!(
            error = %e,
            "sqlite-vec extension registered but probe failed on this connection; ANN unavailable"
        );
    }
    Ok(())
}

#[cfg(not(feature = "ann-sqlite-vec"))]
pub(crate) fn ensure_vec_extension_loaded(_conn: &Connection) -> Result<()> {
    Ok(())
}

impl SqliteIdeas {
    /// Compute SHA256 hash of content for embedding cache lookup.
    pub(super) fn content_hash(content: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Look up a cached embedding by content hash.
    /// Returns the embedding bytes if a match exists, None otherwise.
    pub(super) fn lookup_embedding_by_hash(conn: &Connection, hash: &str) -> Option<Vec<u8>> {
        conn.query_row(
            "SELECT embedding FROM idea_embeddings WHERE content_hash = ?1 LIMIT 1",
            rusqlite::params![hash],
            |row| row.get(0),
        )
        .ok()
    }
}
