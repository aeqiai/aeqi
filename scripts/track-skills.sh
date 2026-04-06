#!/usr/bin/env bash
# PostToolUse hook for mcp__aeqi__aeqi_prompts: track loaded skills.
# Appends skill names to session file so compact primer can remind about them.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"

# Extract action and name from tool input
ACTION=""
SKILL_NAME=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    ACTION=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.action // "list"' 2>/dev/null) || true
    SKILL_NAME=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.name // empty' 2>/dev/null) || true
fi

# Only track "get" actions (actually loading a skill's content)
if [ "$ACTION" = "get" ] && [ -n "$SKILL_NAME" ]; then
    SKILLS_FILE="$AEQI_SESSION_DIR/skills.loaded"
    # Append if not already tracked
    if ! grep -qxF "$SKILL_NAME" "$SKILLS_FILE" 2>/dev/null; then
        echo "$SKILL_NAME" >> "$SKILLS_FILE"
        log_hook "track-skills" "tracked" "$SKILL_NAME"
    fi
fi
