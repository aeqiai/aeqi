#!/usr/bin/env bash
# PreToolUse hook for Edit/Write: block edits on protected branches.
# Enforces the "worktrees only, never edit dev/master" rule.
# Exempts operational paths (scripts, config) that are edited in-place.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

PROTECTED_BRANCHES="main master dev develop"

# Paths exempt from branch protection (operational tooling, edited in-place)
EXEMPT_PATTERNS=(
    "*/aeqi/scripts/*"
    "*/aeqi/config/*"
    "*/aeqi/agents/*"
    "*/aeqi/projects/*/skills/*"
    "*/aeqi/projects/*/AEQI.md"
    "*/.claude/*"
    "*/CLAUDE.md"
)

# --- Extract file path (jq) ---
FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    FILE_PATH=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null) || true
fi

[ -z "$FILE_PATH" ] && exit 0

# --- Only check project files ---
if ! is_project_path "$FILE_PATH"; then
    exit 0
fi

# --- Check path exemptions ---
for pattern in "${EXEMPT_PATTERNS[@]}"; do
    # shellcheck disable=SC2254
    case "$FILE_PATH" in
        $pattern)
            log_hook "check-branch" "allow" "exempt-path: $FILE_PATH"
            exit 0
            ;;
    esac
done

# --- Find git repo root for this file ---
DIR=$(dirname "$FILE_PATH")
GIT_DIR=$(git -C "$DIR" rev-parse --git-dir 2>/dev/null) || exit 0

# Worktrees have .git files (not dirs) pointing to the main repo
# They're fine — that's the intended workflow
if [ -f "$DIR/.git" ] 2>/dev/null || [[ "$GIT_DIR" == *"/worktrees/"* ]]; then
    log_hook "check-branch" "allow" "worktree: $FILE_PATH"
    exit 0
fi

# --- Check current branch ---
BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null) || exit 0

for protected in $PROTECTED_BRANCHES; do
    if [ "$BRANCH" = "$protected" ]; then
        log_hook "check-branch" "deny" "protected branch $BRANCH: $FILE_PATH"
        echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Blocked: editing on protected branch '$BRANCH'. Create a branch or use a worktree: git worktree add ../worktrees/<name> -b <branch>\"}}"
        exit 0
    fi
done

log_hook "check-branch" "allow" "branch=$BRANCH: $FILE_PATH"
