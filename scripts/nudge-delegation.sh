#!/usr/bin/env bash
# PostToolUse hook for mcp__aeqi__ideas (action=store): nudge delegation after plan storage.
# When a plan is stored to memory, suggest delegating before implementing.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"

KEY=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    KEY=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.key // empty' 2>/dev/null) || true
fi

# Only trigger on plan memories
[[ "$KEY" == *":plan"* ]] || exit 0

# Extract quest ID from key (quest:sg-010:plan → sg-010)
QUEST_ID=$(echo "$KEY" | sed 's/quest:\([^:]*\):plan/\1/')
PROJECT=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.project // empty' 2>/dev/null) || true

log_hook "nudge-delegation" "plan-stored" "quest=$QUEST_ID"
echo "Plan stored. Before implementing, consider: agents(action='delegate', agent='reviewer', project='$PROJECT', quest_id='$QUEST_ID', prompt='Review this plan for correctness and completeness.')"
