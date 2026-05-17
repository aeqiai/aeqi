#!/usr/bin/env bash
# Webhook entry point for the aeqi repo.
#
# The platform-level webhook wrapper should call this script instead of
# inlining deploy decisions. It pulls main, classifies the changed paths, then
# routes pure UI changes to the UI-only deploy and runtime-impacting changes to
# the full deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AEQI_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REMOTE="${AEQI_REMOTE:-origin}"
BRANCH="${AEQI_BRANCH:-main}"
UI_DEPLOY="${AEQI_UI_DEPLOY:-$REPO_ROOT/scripts/ui-deploy.sh}"
FULL_DEPLOY="${AEQI_FULL_DEPLOY:-$HOME/aeqi/scripts/deploy.sh}"

classify_paths() {
  local changed="$1"
  local non_ui ui_touched

  ui_touched=$(printf '%s\n' "$changed" | grep -E "^(apps/ui/|packages/web-shared/|packages/tokens/)" | head -1 || true)
  non_ui=$(
    printf '%s\n' "$changed" |
      grep -vE "^(apps/ui/|packages/web-shared/|packages/tokens/|docs/|\.observations/|scripts/)" |
      grep -vE "^([^/]+\.md|package(-lock)?\.json)$" |
      grep -v "^$" |
      head -1 || true
  )

  if [ -n "$ui_touched" ] && [ -z "$non_ui" ]; then
    echo "ui"
  elif [ -z "$non_ui" ]; then
    echo "none"
  else
    echo "full"
  fi
}

case "${1:-run}" in
  classify)
    classify_paths "$(cat)"
    exit 0
    ;;
  run) ;;
  *)
    echo "usage: $0 [run|classify]" >&2
    exit 2
    ;;
esac

cd "$REPO_ROOT"
before=$(git rev-parse HEAD)
git pull --ff-only "$REMOTE" "$BRANCH" 2>&1 | tail -3
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "[webhook-deploy] no changes pulled; skipping deploy"
  exit 0
fi

changed=$(git diff --name-only "$before" "$after")
mode=$(classify_paths "$changed")

if [ "${AEQI_DEPLOY_DRY_RUN:-0}" = "1" ]; then
  echo "[webhook-deploy] dry-run mode=$mode"
  exit 0
fi

case "$mode" in
  ui)
    echo "[webhook-deploy] UI-only change; running scripts/ui-deploy.sh"
    "$UI_DEPLOY"
    ;;
  full)
    echo "[webhook-deploy] runtime-impacting change; running scripts/deploy.sh"
    if [ "${SKIP_STARTUP_SMOKE:-0}" != "1" ]; then
      echo "[webhook-deploy] building release runtime for startup smoke"
      cargo build --release -p aeqi 2>&1 | tail -3
      env AEQI_SMOKE_RUNTIME_BIN="$REPO_ROOT/target/release/aeqi" \
        "$REPO_ROOT/scripts/runtime-startup-smoke.sh"
    fi
    AEQI_WEBHOOK_DEPLOY=1 "$FULL_DEPLOY"
    ;;
  none)
    echo "[webhook-deploy] no deploy-impacting changes; skipping deploy"
    ;;
  *)
    echo "[webhook-deploy] unknown mode: $mode" >&2
    exit 1
    ;;
esac
