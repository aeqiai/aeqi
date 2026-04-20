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

    # Stop the local runtime service (aeqi-runtime.service serves :8400 for
    # the legacy placement → it holds the $AEQI_ROOT/target/release/aeqi
    # binary open. Without this stop, the running process keeps using the
    # old (now-deleted) inode and never picks up new routes. See
    # aeqi#drive-404 incident, 2026-04-17.)
    if systemctl list-unit-files aeqi-runtime.service &>/dev/null; then
        echo "  -> stopping aeqi-runtime for binary swap"
        sudo systemctl stop aeqi-runtime.service 2>/dev/null || true
    fi

    # Stage binary for platform (tenant hosts use this copy).
    # Must stop hosts first — the binary is locked while in use.
    if [ -d "$PLATFORM_ROOT/runtime/bin" ]; then
        # Stop and reset all host services (transient units must be reset so
        # the platform can respawn them with systemd-run).
        for unit in $(systemctl list-units 'aeqi-host-*' --no-legend --plain 2>/dev/null | awk '{print $1}'); do
            echo "  -> stopping $unit for binary staging"
            sudo systemctl stop "$unit" 2>/dev/null || true
            sudo systemctl reset-failed "$unit" 2>/dev/null || true
        done
        # Also kill any lingering aeqi processes using the staged binary.
        sudo fuser -k "$PLATFORM_ROOT/runtime/bin/aeqi" 2>/dev/null || true
        # Backstop: kill any other aeqi process whose executable has been
        # deleted on disk (marker of an in-place binary swap where systemd
        # didn't cover that process). Prevents silent route drift.
        for pid in $(pgrep -f 'target/release/aeqi start' 2>/dev/null); do
            if sudo readlink "/proc/$pid/exe" 2>/dev/null | grep -q '(deleted)'; then
                echo "  -> killing stale aeqi pid=$pid (binary deleted)"
                sudo kill -TERM "$pid" 2>/dev/null || true
            fi
        done
        sleep 2
        # Clean stale PID/socket files.
        for pidfile in /var/lib/aeqi/hosts/*/rm.pid; do
            [ -f "$pidfile" ] && rm -f "$pidfile" "${pidfile%.pid}.sock"
        done
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

    # Hosts were already stopped during binary staging (if runtime was built).
    # If only platform was built, stop hosts now.
    if ! $BUILD_RUNTIME; then
        for unit in $(systemctl list-units 'aeqi-host-*' --no-legend --plain 2>/dev/null | awk '{print $1}'); do
            echo "  -> stopping $unit"
            sudo systemctl stop "$unit" 2>/dev/null || true
        done
    fi

    # Restart local runtime (serves port 8400 for the legacy placement).
    # Must come back up before platform so the platform can reach it.
    if systemctl list-unit-files aeqi-runtime.service &>/dev/null; then
        sudo systemctl restart aeqi-runtime.service
        echo "  -> aeqi-runtime restarted"
    fi

    # Restart the platform. When invoked via webhook, the platform is our parent
    # process — restarting it kills us. Use a delayed restart so we can exit first.
    if [[ "${AEQI_WEBHOOK_DEPLOY:-}" == "1" ]]; then
        # Webhook mode: schedule restart after this script exits.
        echo "  -> scheduling platform restart (webhook mode)..."
        nohup bash -c 'sleep 2 && sudo systemctl restart aeqi-platform.service' &>/dev/null &
    else
        # Direct mode: restart immediately and verify.
        sudo systemctl restart aeqi-platform.service
        echo "  -> aeqi-platform restarted"

        sleep 3
        PLATFORM_STATUS=$(systemctl is-active aeqi-platform 2>/dev/null || echo "failed")
        PLATFORM_HEALTH=$(curl -sf https://app.aeqi.ai/api/health 2>/dev/null || echo '{"ok":false}')

        echo ""
        echo "Status:"
        echo "  platform: $PLATFORM_STATUS  $PLATFORM_HEALTH"

        sleep 2
        HOST_STATUS=$(systemctl is-active aeqi-host-luca-eich 2>/dev/null || true)
        echo "  host:     $HOST_STATUS"

        if [[ "$PLATFORM_STATUS" == "active" ]]; then
            echo ""
            echo "Deploy successful."

            # Post-deploy smoke checks — advisory, does not block deploy.
            if [ -x "$AEQI_ROOT/scripts/smoke-prod.sh" ]; then
                echo ""
                "$AEQI_ROOT/scripts/smoke-prod.sh" || \
                    echo "  (smoke checks reported issues — investigate at app.aeqi.ai)"
            fi
        else
            echo ""
            echo "FAILED: platform did not start!"
            exit 1
        fi
    fi
fi
