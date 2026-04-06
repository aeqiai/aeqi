#!/usr/bin/env bash
# PreToolUse hook for Edit/Write: check if the target file is claimed by another agent.
# Queries notes for active claims via Unix socket IPC.
# Advisory only — warns but allows if claimed by a different agent.
# Graceful degradation: allows if daemon is unreachable.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

SOCK="${AEQI_DATA_DIR:-$HOME/.aeqi}/rm.sock"

# --- Extract file path (jq) ---
FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    FILE_PATH=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null) || true
fi

if [ -z "$FILE_PATH" ]; then
    log_hook "check-claims" "allow" "no-file-path"
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
fi

# --- Skip non-home files ---
case "$FILE_PATH" in
    /home/claudedev/*) ;;
    *)
        log_hook "check-claims" "allow" "non-home: $FILE_PATH"
        echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
        exit 0
        ;;
esac

# --- Detect project using shared utility (fixes nested repo detection) ---
PROJECT=$(detect_project "$FILE_PATH")

if [ -z "$PROJECT" ]; then
    log_hook "check-claims" "allow" "no-project: $FILE_PATH"
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
fi

# --- Derive resource path relative to project repo ---
# Re-read repo path for the matched project to compute relative resource
REPO_PATH=$(awk -v proj="$PROJECT" -v home="$HOME" '
    /^\[\[projects\]\]/ { in_proj=1; name=""; repo=""; next }
    /^\[/ && !/^\[\[projects\./ {
        if (in_proj && name == proj && repo) { gsub(/^~/, home, repo); print repo; exit }
        in_proj=0
    }
    in_proj && /^name[[:space:]]*=/ {
        val=$0; sub(/^[^=]*=[[:space:]]*"?/,"",val); sub(/".*/, "", val)
        if (!name) name=val
    }
    in_proj && /^repo[[:space:]]*=/ {
        val=$0; sub(/^[^=]*=[[:space:]]*"?/,"",val); sub(/".*/, "", val)
        repo=val
    }
    END {
        if (in_proj && name == proj && repo) { gsub(/^~/, home, repo); print repo }
    }
' "$AEQI_CONFIG")

RESOURCE="${FILE_PATH#$REPO_PATH/}"

if [ -z "$RESOURCE" ] || [ "$RESOURCE" = "$FILE_PATH" ]; then
    log_hook "check-claims" "allow" "no-resource: $FILE_PATH"
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
fi

# --- Check daemon socket ---
if [ ! -S "$SOCK" ]; then
    log_hook "check-claims" "allow" "daemon-down: $FILE_PATH"
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
fi

# --- Query notes for claim ---
RESPONSE=$(printf '{"cmd":"check_claim","resource":"%s","project":"%s"}' "$RESOURCE" "$PROJECT" | socat -t2 - UNIX-CONNECT:"$SOCK" 2>/dev/null) || true

if [ -z "$RESPONSE" ]; then
    log_hook "check-claims" "allow" "no-response: $FILE_PATH"
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    exit 0
fi

CLAIMED=$(printf '%s' "$RESPONSE" | jq -r '.claimed // "false"' 2>/dev/null)
AGENT=$(printf '%s' "$RESPONSE" | jq -r '.agent // empty' 2>/dev/null)
CONTENT=$(printf '%s' "$RESPONSE" | jq -r '.content // empty' 2>/dev/null)

if [ "$CLAIMED" = "True" ] || [ "$CLAIMED" = "true" ]; then
    log_hook "check-claims" "warn" "claimed by $AGENT: $RESOURCE"
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Warning: %s is claimed by %s: %s"}}' "$RESOURCE" "$AGENT" "$CONTENT"
    exit 0
fi

log_hook "check-claims" "allow" "$FILE_PATH"
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
