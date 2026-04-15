#!/usr/bin/env bash
# Production deploy — build runtime + UI + platform, restart services.
#
# Architecture:
#   aeqi-platform.service — SaaS control plane (port 8443, serves UI + API)
#   aeqi-host-*.service   — per-tenant host runtimes (transient systemd-run units,
#                           auto-respawned by the platform on demand)
#
# The platform manages host lifecycle. On deploy we:
#   1. Build the runtime binary + UI dist
#   2. Stage them into the platform directory
#   3. Stop host services (they use the staged binary)
#   4. Restart the platform (which re-spawns hosts on demand)
#
# Usage:
#   ./scripts/deploy.sh              # full deploy
#   ./scripts/deploy.sh --runtime    # runtime only (skip platform rebuild)
#   ./scripts/deploy.sh --platform   # platform only (skip runtime build)
#   ./scripts/deploy.sh --no-restart # build only, don't restart services

set -euo pipefail

AEQI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORM_ROOT="/home/claudedev/aeqi-platform"
cd "$AEQI_ROOT"

# Guard: only run on production.
if [ ! -f /etc/systemd/system/aeqi-platform.service ] && [ ! -f "$HOME/.aeqi-production" ]; then
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

    # Stage binary for platform (tenant hosts use this copy).
    if [ -d "$PLATFORM_ROOT/runtime/bin" ]; then
        sudo cp "$AEQI_ROOT/target/release/aeqi" "$PLATFORM_ROOT/runtime/bin/aeqi"
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

    # Clean stale PID/socket files so hosts can restart cleanly.
    for pidfile in /var/lib/aeqi/hosts/*/rm.pid; do
        [ -f "$pidfile" ] || continue
        pid=$(cat "$pidfile" 2>/dev/null)
        if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pidfile" "${pidfile%.pid}.sock"
            echo "  -> cleaned stale PID file: $pidfile"
        fi
    done

    # Restart the platform (it will re-spawn hosts on demand).
    sudo systemctl restart aeqi-platform.service
    echo "  -> aeqi-platform restarted"

    # Wait for health.
    sleep 3

    # Verify platform.
    PLATFORM_STATUS=$(systemctl is-active aeqi-platform 2>/dev/null || echo "failed")
    PLATFORM_HEALTH=$(curl -sf https://app.aeqi.ai/api/health 2>/dev/null || echo '{"ok":false}')

    echo ""
    echo "Status:"
    echo "  platform: $PLATFORM_STATUS  $PLATFORM_HEALTH"

    # Wait for host to come back (platform respawns on first request).
    sleep 2
    HOST_STATUS=$(systemctl is-active aeqi-host-luca-eich 2>/dev/null || echo "not yet")
    echo "  host:     $HOST_STATUS"

    if [[ "$PLATFORM_STATUS" == "active" ]]; then
        echo ""
        echo "Deploy successful."
    else
        echo ""
        echo "FAILED: platform did not start!"
        exit 1
    fi
fi
