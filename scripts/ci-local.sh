#!/usr/bin/env bash
# Mirror of .github/workflows/ci.yml + quality-gates.yml — runs the same
# gates locally before push. Catches the failure modes that have been
# emailing you for weeks (fmt drift on main, an unrelated worktree's
# missing fmt fix blocking the next push, an unused dep in a freshly
# added crate, etc.).
#
# Modes:
#   scripts/ci-local.sh           # fast subset (default — < 3 min cached)
#   FULL=1 scripts/ci-local.sh    # also runs cargo test + UI verify + fresh-install smoke
#   SKIP_UI=1 scripts/ci-local.sh # skip the apps/ui typecheck + prettier step
#   SKIP_STARTUP_SMOKE=1 scripts/ci-local.sh # skip existing-DB runtime startup smoke
#
# Wired into .githooks/pre-push. Enable per checkout with:
#   git config core.hooksPath .githooks
#
# Bypass for emergencies: `git push --no-verify`.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

run() {
  echo
  echo "[ci-local] $*"
  "$@"
}

# 1. Fast Rust gates — what GitHub's quality-gates job blocks on.
run cargo fmt --all --check
run cargo clippy --workspace --all-targets --all-features -- -D warnings

# 2. cargo +nightly udeps — the gate that catches unused Cargo.toml deps.
# Fragile across nightly toolchain churn; SKIP_UDEPS=1 lets you bypass
# locally if nightly is broken, but CI still enforces it.
if [[ "${SKIP_UDEPS:-0}" != "1" ]]; then
  if rustup toolchain list 2>/dev/null | grep -q nightly; then
    run cargo +nightly udeps --workspace --all-targets
  else
    echo "[ci-local] WARN — nightly toolchain not installed; skipping udeps."
    echo "[ci-local]   Install once with: rustup toolchain install nightly"
  fi
fi

# 3. Build verification.
run cargo build --workspace

# 4. Runtime startup smoke — catches build-pass/startup-panic regressions.
if [[ "${SKIP_STARTUP_SMOKE:-0}" != "1" ]]; then
  run env AEQI_SMOKE_RUNTIME_BIN="$PWD/target/debug/aeqi" bash scripts/runtime-startup-smoke.sh
fi

# 5. UI subset — fast checks (typecheck + prettier).
if [[ "${SKIP_UI:-0}" != "1" ]] && [[ -d apps/ui ]]; then
  if [[ ! -d apps/ui/node_modules ]]; then
    echo "[ci-local] WARN — apps/ui/node_modules missing; run npm --prefix apps/ui ci first."
  else
    (cd apps/ui && npx tsc --noEmit)
    (cd apps/ui && npx prettier --check "src/**/*.{ts,tsx,css}")
  fi
fi

# 6. FULL mode — run tests + UI verify + fresh-install smoke. Slow; not on by default.
if [[ "${FULL:-0}" == "1" ]]; then
  run cargo test --workspace
  if [[ -d apps/ui/node_modules ]]; then
    (cd apps/ui && npm run verify)
  fi
  if [[ -x scripts/smoke-fresh-install.sh ]]; then
    run env AEQI_BIN="$PWD/target/debug/aeqi" bash scripts/smoke-fresh-install.sh
  fi
fi

echo
echo "[ci-local] OK — matches .github/workflows/ci.yml fast path"
