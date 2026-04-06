#!/usr/bin/env bash
# Notification hook: posts Claude Code notifications to AEQI notes.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

SOCK="${AEQI_DATA_DIR:-$HOME/.aeqi}/rm.sock"
if [ ! -S "$SOCK" ]; then
    log_hook "notify-aeqi" "skip" "daemon-down"
    exit 0
fi

PROJECT=$(detect_project)
[ -z "$PROJECT" ] && PROJECT="aeqi"

TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)

printf '{"cmd":"post_notes","project":"%s","key":"signal:notification:%s","content":"Claude Code session notification in project %s","tags":["notification","claude-code"],"durability":"transient"}' \
    "$PROJECT" "$TIMESTAMP" "$PROJECT" \
    | socat -t2 - UNIX-CONNECT:"$SOCK" >/dev/null 2>&1 || true

log_hook "notify-aeqi" "posted" "project=$PROJECT"
