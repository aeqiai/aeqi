#!/usr/bin/env bash
# Production deploy — build runtime + UI + platform, restart all services.
#
# Architecture:
#   aeqi-runtime.service  — agent orchestration daemon (port 8400)
#   aeqi-platform.service — SaaS control plane (port 8443, serves UI)
#   aeqi-host-*.service   — per-tenant host runtimes (transient systemd-run units)
#
# Usage:
#   ./scripts/deploy.sh              # full deploy
#   ./scripts/deploy.sh --runtime    # runtime only (skip platform)
#   ./scripts/deploy.sh --platform   # platform only (skip runtime build)
#   ./scripts/deploy.sh --no-restart # build only, don't restart services

set -euo pipefail

AEQI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM_ROOT="/home/claudedev/aeqi-platform"
cd "$AEQI_ROOT"

# Guard: only run on production.
if [ ! -f /etc/systemd/system/aeqi-runtime.service ] && [ ! -f "$HOME/.aeqi-production" ]; then
    echo "[deploy] Not a production server, skipping."
    exit 0
fi

MODE="${1:-full}"
SKIP_RESTART=false
BUILD_RUNTIME=true
BUILD_PLATFORM=true

case "$MODE" in
    --runtime)   BUILD_PLATFORM=false ;;
    --platform)  BUILD_RUNTIME=false ;;
    --no-restart) SKIP_RESTART=true ;;
    full|"")     ;; # build everything
esac

STEP=0
total_steps() {
    local n=0
    $BUILD_RUNTIME && n=$((n + 2))   # UI + runtime binary
    $BUILD_PLATFORM && n=$((n + 1))  # platform binary
    $SKIP_RESTART || n=$((n + 1))    # restart + verify
    echo $n
}
TOTAL=$(total_steps)

step() { STEP=$((STEP + 1)); echo "[$STEP/$TOTAL] $1"; }

# --- Build runtime ---
if $BUILD_RUNTIME; then
    step "Building dashboard UI..."
    (cd apps/ui && npm ci --silent && npm run build --silent 2>&1 | tail -3)

    step "Building aeqi runtime binary..."
    cargo build --release -p aeqi 2>&1 | tail -3

    # Stage binary for platform (tenant sandboxes/hosts use this copy).
    if [ -d "$PLATFORM_ROOT/runtime/bin" ]; then
        cp "$AEQI_ROOT/target/release/aeqi" "$PLATFORM_ROOT/runtime/bin/aeqi"
        echo "  -> staged binary to $PLATFORM_ROOT/runtime/bin/aeqi"
    fi

    # Stage UI dist for platform (served as SPA).
    if [ -d "$PLATFORM_ROOT/ui-dist" ]; then
        rsync -a --delete "$AEQI_ROOT/apps/ui/dist/" "$PLATFORM_ROOT/ui-dist/"
        echo "  -> staged UI dist to $PLATFORM_ROOT/ui-dist/"
    fi
fi

# --- Build platform ---
if $BUILD_PLATFORM; then
    step "Building aeqi-platform binary..."
    (cd "$PLATFORM_ROOT" && cargo build --release 2>&1 | tail -3)
fi

# --- Restart services ---
if ! $SKIP_RESTART; then
    step "Restarting services..."

    # Stop host runtimes first (they use the staged binary).
    for unit in $(systemctl list-units 'aeqi-host-*' --no-legend --plain 2>/dev/null | awk '{print $1}'); do
        echo "  -> stopping $unit"
        sudo systemctl stop "$unit" 2>/dev/null || true
    done

    # Restart core services.
    sudo systemctl restart aeqi-runtime.service
    echo "  -> aeqi-runtime restarted"

    if $BUILD_PLATFORM; then
        sudo systemctl restart aeqi-platform.service
        echo "  -> aeqi-platform restarted"
    fi

    # Wait for health.
    sleep 2

    # Verify.
    RUNTIME_STATUS=$(systemctl is-active aeqi-runtime 2>/dev/null || echo "failed")
    PLATFORM_STATUS=$(systemctl is-active aeqi-platform 2>/dev/null || echo "failed")

    RUNTIME_HEALTH=$(curl -sf http://127.0.0.1:8400/api/health 2>/dev/null || echo '{"ok":false}')
    PLATFORM_HEALTH=$(curl -sf https://app.aeqi.ai/api/health 2>/dev/null || echo '{"ok":false}')

    echo ""
    echo "Status:"
    echo "  runtime:  $RUNTIME_STATUS  $RUNTIME_HEALTH"
    echo "  platform: $PLATFORM_STATUS  $PLATFORM_HEALTH"

    # Host runtimes will auto-restart on next request via the platform's
    # proxy auto-respawn logic. No manual restart needed.

    if [[ "$RUNTIME_STATUS" == "active" && "$PLATFORM_STATUS" == "active" ]]; then
        echo ""
        echo "Deploy successful."
    else
        echo ""
        echo "WARNING: One or more services failed!"
        exit 1
    fi
fi
