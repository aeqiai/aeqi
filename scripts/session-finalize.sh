#!/usr/bin/env bash
# Stop hook: runs when Claude Code session ends.
# Posts notes signals for the next session to pick up:
# - remember-nudge: if work was done without aeqi_remember
# - primer-update-nudge: if many files were edited (primer may be stale)
# Cleans up session state.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

RECALL_GATE="$AEQI_SESSION_DIR/recall.gate"
REMEMBER_FLAG="$AEQI_SESSION_DIR/remember.used"
EDITS_LOG="$AEQI_SESSION_DIR/edits.log"
SOCK="${AEQI_DATA_DIR:-$HOME/.aeqi}/rm.sock"
PROJECT=$(detect_project)
[ -z "$PROJECT" ] && PROJECT="aeqi"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)

# Nudge 1: work done but no learnings stored
if [ -f "$RECALL_GATE" ] && [ ! -f "$REMEMBER_FLAG" ] && [ -S "$SOCK" ]; then
    printf '{"cmd":"post_notes","project":"%s","key":"signal:remember-nudge:%s","content":"Previous session did work but stored no learnings. Consider: were there non-obvious decisions or patterns worth preserving?","tags":["nudge","remember"],"durability":"transient"}' \
        "$PROJECT" "$TIMESTAMP" \
        | socat -t2 - UNIX-CONNECT:"$SOCK" >/dev/null 2>&1 || true
    log_hook "session-finalize" "nudge" "no-remember in project=$PROJECT"
fi

# Nudge 2: many files edited — primer may need updating
if [ -f "$EDITS_LOG" ] && [ -S "$SOCK" ]; then
    DISTINCT_FILES=$(sort -u "$EDITS_LOG" | wc -l)
    if [ "$DISTINCT_FILES" -gt 5 ]; then
        printf '{"cmd":"post_notes","project":"%s","key":"signal:primer-update-nudge:%s","content":"Previous session edited %s distinct files in %s. The project primer (AEQI.md) may need updating.","tags":["nudge","primer"],"durability":"transient"}' \
            "$PROJECT" "$TIMESTAMP" "$DISTINCT_FILES" "$PROJECT" \
            | socat -t2 - UNIX-CONNECT:"$SOCK" >/dev/null 2>&1 || true
        log_hook "session-finalize" "nudge" "primer-update files=$DISTINCT_FILES project=$PROJECT"
    fi
fi

# Auto re-index graph if edits were made (self-evolving graph)
if [ -f "$EDITS_LOG" ] && [ -s "$EDITS_LOG" ]; then
    AEQI_BIN="/home/claudedev/aeqi/target/release/aeqi"
    [ -x "$AEQI_BIN" ] || AEQI_BIN="/home/claudedev/aeqi/target/debug/aeqi"
    if [ -x "$AEQI_BIN" ]; then
        AEQI_DIR="$(dirname "$SCRIPT_DIR")"
        INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook","version":"0.2"}}}'
        IDX_CALL="{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"aeqi_graph\",\"arguments\":{\"action\":\"incremental\",\"project\":\"$PROJECT\"}}}"
        cd "$AEQI_DIR" && printf '%s\n%s\n' "$INIT" "$IDX_CALL" | "$AEQI_BIN" mcp >/dev/null 2>&1 || true
        log_hook "session-finalize" "graph-reindex" "project=$PROJECT"
    fi
fi

# Clean up session state
rm -f "$RECALL_GATE" "$REMEMBER_FLAG" "$EDITS_LOG" "$AEQI_SESSION_DIR/skills.loaded" 2>/dev/null || true

log_hook "session-finalize" "cleanup" "session ended"
