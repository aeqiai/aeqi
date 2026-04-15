#!/usr/bin/env bash
# SessionStart hook: triggers session:start event and injects assembled context.
# Uses events(action='trigger') to get the same ideas context the AEQI runtime
# would inject during its own session lifecycle.

AEQI_BIN="${AEQI_BIN:-aeqi}"
command -v "$AEQI_BIN" >/dev/null 2>&1 || exit 0
[ -z "${AEQI_AGENT:-}" ] && exit 0

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook","version":"1.0"}}}'
TRIGGER="{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"events\",\"arguments\":{\"action\":\"trigger\",\"agent\":\"$AEQI_AGENT\",\"pattern\":\"session:start\"}}}"

RESP=$(printf '%s\n%s\n' "$INIT" "$TRIGGER" | "$AEQI_BIN" mcp 2>/dev/null | tail -1) || exit 0

CONTEXT=$(printf '%s' "$RESP" | jq -r '.result.content[0].text // empty' 2>/dev/null | jq -r '.system_prompt // empty' 2>/dev/null) || exit 0

[ -z "$CONTEXT" ] && exit 0

echo "# Session Primer (agent: ${AEQI_AGENT})"
echo "$CONTEXT"
