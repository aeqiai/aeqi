#!/usr/bin/env bash
# PostToolUse hook for mcp__aeqi__aeqi_notes: nudge delegation after plan posting.
# When a plan is posted to notes, suggest delegating before implementing.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"

ACTION=""
KEY=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    ACTION=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.action // empty' 2>/dev/null) || true
    KEY=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.key // empty' 2>/dev/null) || true
fi

# Only trigger on plan postings
[ "$ACTION" = "post" ] || exit 0
[[ "$KEY" == *":plan"* ]] || exit 0

# Extract task ID from key (task:sg-010:plan → sg-010)
TASK_ID=$(echo "$KEY" | sed 's/task:\([^:]*\):plan/\1/')
PROJECT=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.project // empty' 2>/dev/null) || true

log_hook "nudge-delegation" "plan-posted" "task=$TASK_ID"
echo "Plan posted. Before implementing, consider: aeqi_delegate(agent='reviewer', project='$PROJECT', task_id='$TASK_ID', prompt='Review this plan for correctness and completeness.')"
