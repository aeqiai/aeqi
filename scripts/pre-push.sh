#!/usr/bin/env bash
# Pre-push gate — mirrors the core blocking CI checks.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "=== pre-push: public surface scan ==="
scripts/public-surface-scan.sh

echo "=== pre-push: cargo fmt --check ==="
cargo fmt --check

echo "=== pre-push: cargo clippy ==="
cargo clippy -- -D warnings

echo "=== pre-push: cargo test ==="
cargo test

echo "=== pre-push: all checks passed ==="
