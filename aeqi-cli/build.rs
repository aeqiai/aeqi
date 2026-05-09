//! Inject AEQI_VERSION at compile time. Prefers `git describe --tags` so
//! `aeqi --version` matches the release tag (e.g. v0.65.0). Falls back to
//! CARGO_PKG_VERSION when git isn't available — release-tarball builds and
//! source-without-git checkouts still compile cleanly.
//!
//! The release CI checks out at the tag SHA, so `git describe --tags` returns
//! the exact tag (`v0.65.0`). Local dirty builds get `v0.65.0-3-g<sha>` which
//! is also useful — tells you which post-release commit you're on.

use std::process::Command;

fn main() {
    let version = Command::new("git")
        .args(["describe", "--tags", "--match=v*", "--always", "--dirty"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            // No git, no tags — fall back to the workspace version. Strips the
            // leading "v" prefix difference: workspace = "0.15.0", git tag =
            // "v0.65.0". Self-hosters who built from a release tarball see
            // the cargo version; CI builds see the tag.
            format!("v{}", env!("CARGO_PKG_VERSION"))
        });

    println!("cargo:rustc-env=AEQI_VERSION={version}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/tags");
}
