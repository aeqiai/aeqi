#!/usr/bin/env bash
# Pre-push gate — mirrors the core blocking CI checks.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

# Git invokes hooks with GIT_DIR/GIT_COMMON_DIR/etc. pointing at the outer
# repository. Tests that create temporary repositories and shell out to git must
# not inherit those values, or their nested `git init` / `git commit` calls can
# mutate this checkout instead of the temp repo.
while IFS= read -r var; do
  unset "$var"
done < <(git rev-parse --local-env-vars)

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
