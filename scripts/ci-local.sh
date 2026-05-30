#!/usr/bin/env bash
# Mirror of .github/workflows/ci.yml + quality-gates.yml — runs the same
# gates locally before push. Catches the failure modes that have been
# emailing you for weeks (fmt drift on main, an unrelated worktree's
# missing fmt fix blocking the next push, an unused dep in a freshly
# added crate, etc.).
#
# Modes:
#   scripts/ci-local.sh --plan     # print the local/CI tier contract
#   scripts/ci-local.sh prepush    # fast pre-push subset (default)
#   scripts/ci-local.sh quick      # alias for prepush
#   scripts/ci-local.sh full       # also runs cargo test + UI verify + fresh-install smoke
#   FULL=1 scripts/ci-local.sh     # backward-compatible alias for full
#   SKIP_UI=1 scripts/ci-local.sh  # skip the apps/ui typecheck + prettier step
#   SKIP_STARTUP_SMOKE=1 scripts/ci-local.sh # skip existing-DB runtime startup smoke
#
# Wired into scripts/git-hooks/pre-push. Enable per checkout with:
#   scripts/install-git-hooks.sh
#
# Bypass for emergencies: `git push --no-verify`.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

mode="${1:-prepush}"
if [[ "${FULL:-0}" == "1" && "$mode" == "prepush" ]]; then
  mode="full"
fi

case "$mode" in
  --plan | plan)
    cat <<'JSON'
{
  "entrypoint": "scripts/ci-local.sh",
  "installed_hook": "scripts/git-hooks/pre-push",
  "tiers": [
    {
      "name": "prepush",
      "blocking": true,
      "commands": [
        "scripts/public-surface-scan.sh",
        "cargo fmt --all --check",
        "cargo clippy --workspace --all-targets --all-features -- -D warnings",
        "cargo +nightly udeps --workspace --all-targets",
        "cargo build --workspace",
        "scripts/runtime-startup-smoke.sh",
        "apps/ui: tsc --noEmit",
        "apps/ui: prettier --check src/**/*.{ts,tsx,css}"
      ]
    },
    {
      "name": "full",
      "blocking": false,
      "extends": "prepush",
      "commands": [
        "cargo test --workspace",
        "npm --prefix apps/ui run verify",
        "scripts/smoke-fresh-install.sh",
        "scripts/smoke-quickstart-readme.sh"
      ]
    },
    {
      "name": "ci-only",
      "blocking": true,
      "commands": [
        "npm run surface:catalog:check",
        "cargo audit",
        "cargo deny check",
        "npm audit",
        "cargo doc --workspace --no-deps",
        "coverage and documentation artifact upload",
        "performance reporting"
      ]
    }
  ],
  "escape_hatches": ["SKIP_UI=1", "SKIP_UDEPS=1", "SKIP_STARTUP_SMOKE=1", "git push --no-verify"]
}
JSON
    exit 0
    ;;
  prepush | quick | full)
    ;;
  *)
    echo "usage: scripts/ci-local.sh [--plan|prepush|quick|full]" >&2
    exit 2
    ;;
esac

run() {
  echo
  echo "[ci-local] $*"
  "$@"
}

# 1. Public surface guard — this is cheap and blocks in CI.
run scripts/public-surface-scan.sh

# 2. Fast Rust gates — what GitHub's quality-gates job blocks on.
run cargo fmt --all --check
run cargo clippy --workspace --all-targets --all-features -- -D warnings

# 3. cargo +nightly udeps — the gate that catches unused Cargo.toml deps.
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

# 4. Build verification.
run cargo build --workspace

# 5. Runtime startup smoke — catches build-pass/startup-panic regressions.
if [[ "${SKIP_STARTUP_SMOKE:-0}" != "1" ]]; then
  run env AEQI_SMOKE_RUNTIME_BIN="$PWD/target/debug/aeqi" bash scripts/runtime-startup-smoke.sh
fi

# 6. UI subset — fast checks (typecheck + prettier).
if [[ "${SKIP_UI:-0}" != "1" ]] && [[ -d apps/ui ]]; then
  if [[ ! -d apps/ui/node_modules ]]; then
    echo "[ci-local] WARN — apps/ui/node_modules missing; run npm --prefix apps/ui ci first."
  else
    (cd apps/ui && npx tsc --noEmit)
    (cd apps/ui && npx prettier --check "src/**/*.{ts,tsx,css}")
  fi
fi

# 7. FULL mode — run tests + UI verify + smoke checks. Slow; not on by default.
if [[ "$mode" == "full" ]]; then
  run cargo test --workspace
  if [[ -d apps/ui/node_modules ]]; then
    (cd apps/ui && npm run verify)
  fi
  if [[ -x scripts/smoke-fresh-install.sh ]]; then
    run env AEQI_BIN="$PWD/target/debug/aeqi" bash scripts/smoke-fresh-install.sh
  fi
  if [[ -x scripts/smoke-quickstart-readme.sh ]]; then
    run bash scripts/smoke-quickstart-readme.sh
  fi
fi

echo
echo "[ci-local] OK — $mode tier matches the documented local/CI contract"
