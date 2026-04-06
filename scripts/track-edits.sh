#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: log distinct files edited this session.
# Used by session-finalize.sh to detect significant work for primer update nudge.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"

FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    FILE_PATH=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null) || true
fi

if [ -n "$FILE_PATH" ]; then
    echo "$FILE_PATH" >> "$AEQI_SESSION_DIR/edits.log"
fi
