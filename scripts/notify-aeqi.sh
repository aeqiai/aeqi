#!/usr/bin/env bash
# Notification hook: stores Claude Code notifications in AEQI memory.

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

printf '{"cmd":"knowledge_store","project":"%s","key":"signal:notification:%s","content":"Claude Code session notification in project %s","category":"context","ttl_secs":3600}' \
    "$PROJECT" "$TIMESTAMP" "$PROJECT" \
    | socat -t2 - UNIX-CONNECT:"$SOCK" >/dev/null 2>&1 || true

log_hook "notify-aeqi" "stored" "project=$PROJECT"
