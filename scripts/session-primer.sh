#!/usr/bin/env bash
# SessionStart hook: injects agent identity into Claude Code context.
# Just calls agents(action='get') and prints the agent's assembled ideas.
# No opinions. No gates. No nudges. Just identity.

AEQI_BIN="${AEQI_BIN:-aeqi}"
command -v "$AEQI_BIN" >/dev/null 2>&1 || exit 0
[ -z "${AEQI_AGENT:-}" ] && exit 0

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook","version":"1.0"}}}'
GET_AGENT="{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"agents\",\"arguments\":{\"action\":\"get\",\"agent\":\"$AEQI_AGENT\"}}}"

RESP=$(printf '%s\n%s\n' "$INIT" "$GET_AGENT" | "$AEQI_BIN" mcp 2>/dev/null | tail -1) || exit 0

CONTEXT=$(printf '%s' "$RESP" | jq -r '.result.content[0].text // empty' 2>/dev/null | jq -r '.context // empty' 2>/dev/null) || exit 0
NAME=$(printf '%s' "$RESP" | jq -r '.result.content[0].text // empty' 2>/dev/null | jq -r '.name // empty' 2>/dev/null) || exit 0

[ -z "$CONTEXT" ] && exit 0

echo "# Agent: ${NAME:-$AEQI_AGENT}"
echo "$CONTEXT"
