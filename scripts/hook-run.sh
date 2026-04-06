#!/usr/bin/env bash
# Resilient hook runner — wraps any hook script with error/crash fallback.
# On script error, syntax error, or invalid output: falls back to allow + logs.
#
# Usage in settings.json:
#   "command": "/home/claudedev/aeqi/scripts/hook-run.sh check-recall.sh"
#   "command": "/home/claudedev/aeqi/scripts/hook-run.sh check-branch.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"; shift
TEL="/tmp/.aeqi_hook_telemetry"

# Resolve: absolute path stays absolute, relative name resolves to scripts dir
if [[ "$SCRIPT_NAME" == /* ]]; then
    SCRIPT="$SCRIPT_NAME"
else
    SCRIPT="$SCRIPT_DIR/$SCRIPT_NAME"
fi

if [ ! -x "$SCRIPT" ]; then
    printf '%s hook-run ERROR script-missing %s\n' "$(date -u +%Y-%m-%dT%H:%M:%S)" "$SCRIPT_NAME" >> "$TEL" 2>/dev/null
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Hook script missing — falling back to allow."}}'
    exit 0
fi

# Run the actual hook, capture stdout and exit code
STDERR_FILE=$(mktemp /tmp/.aeqi_hook_stderr.XXXXXX 2>/dev/null || echo "/tmp/.aeqi_hook_stderr_$$")
RESULT=$("$SCRIPT" "$@" 2>"$STDERR_FILE")
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    STDERR_MSG=$(head -1 "$STDERR_FILE" 2>/dev/null)
    printf '%s hook-run ERROR exit=%s script=%s stderr=%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%S)" "$EXIT_CODE" "$SCRIPT_NAME" "$STDERR_MSG" >> "$TEL" 2>/dev/null
    rm -f "$STDERR_FILE" 2>/dev/null
    echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\",\"permissionDecisionReason\":\"Hook error (exit $EXIT_CODE) — falling back to allow. Check telemetry.\"}}"
    exit 0
fi

rm -f "$STDERR_FILE" 2>/dev/null

# Validate JSON output (catches stray echo/debug output)
if [ -n "$RESULT" ] && ! printf '%s' "$RESULT" | jq . >/dev/null 2>&1; then
    printf '%s hook-run ERROR invalid-json script=%s output=%s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%S)" "$SCRIPT_NAME" "${RESULT:0:100}" >> "$TEL" 2>/dev/null
    echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Hook produced invalid JSON — falling back to allow. Check telemetry."}}'
    exit 0
fi

# Pass through valid output
printf '%s' "$RESULT"
