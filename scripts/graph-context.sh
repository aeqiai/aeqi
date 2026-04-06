#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: inject graph context summary for the edited file.
# Non-blocking — just adds informational output. Silently does nothing if graph unavailable.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

FILE_PATH=""
if [ -n "${CLAUDE_TOOL_INPUT:-}" ]; then
    FILE_PATH=$(printf '%s' "$CLAUDE_TOOL_INPUT" | jq -r '.file_path // empty' 2>/dev/null) || true
fi

[ -z "$FILE_PATH" ] && exit 0

# Only show graph context once per file per session (avoid redundant SQLite queries)
CONTEXT_CACHE="$AEQI_SESSION_DIR/graph-context.seen"
if grep -qxF "$FILE_PATH" "$CONTEXT_CACHE" 2>/dev/null; then
    exit 0
fi

# Only for project files
PROJECT=$(detect_project "$FILE_PATH")
[ -z "$PROJECT" ] && exit 0

# Check if graph DB exists
GRAPH_DB="${AEQI_DATA_DIR:-$HOME/.aeqi}/codegraph/${PROJECT}.db"
[ -f "$GRAPH_DB" ] || exit 0

# Get repo path for the matched project (reuse detect-project awk pattern with check on section transition)
CONFIG="${AEQI_CONFIG:-/home/claudedev/aeqi/config/aeqi.toml}"
REPO_PATH=$(awk -v proj="$PROJECT" -v home="$HOME" '
    function emit() { if (name==proj && repo) { gsub(/^~/,home,repo); print repo } }
    /^\[\[projects\]\]/ { if(in_proj) emit(); in_proj=1; name=""; repo=""; next }
    /^\[/ && !/^\[\[projects\./ { if(in_proj) emit(); in_proj=0 }
    in_proj && /^name[[:space:]]*=/ { val=$0; sub(/^[^=]*=[[:space:]]*"?/,"",val); sub(/".*/, "",val); if(!name) name=val }
    in_proj && /^repo[[:space:]]*=/ { val=$0; sub(/^[^=]*=[[:space:]]*"?/,"",val); sub(/".*/, "",val); repo=val }
    END { if(in_proj) emit() }
' "$CONFIG" 2>/dev/null | head -1)

[ -z "$REPO_PATH" ] && exit 0

REL_PATH="${FILE_PATH#$REPO_PATH/}"
[ "$REL_PATH" = "$FILE_PATH" ] && exit 0

# Query file summary
SUMMARY=$(sqlite3 "$GRAPH_DB" "
    SELECT label || ':' || c FROM (
        SELECT label, COUNT(*) as c FROM code_nodes
        WHERE file_path = '$REL_PATH'
        AND label NOT IN ('file','community','process')
        GROUP BY label ORDER BY c DESC
    )
" 2>/dev/null | tr '\n' ', ' | sed 's/, $//') || true

[ -z "$SUMMARY" ] && exit 0

# Count external callers
CALLERS=$(sqlite3 "$GRAPH_DB" "
    SELECT COUNT(*) FROM code_edges e
    JOIN code_nodes t ON t.id = e.target_id
    WHERE t.file_path = '$REL_PATH' AND e.edge_type = 'calls'
    AND e.source_id NOT IN (SELECT id FROM code_nodes WHERE file_path = '$REL_PATH')
" 2>/dev/null) || true

CONTEXT="Graph: $SUMMARY"
[ -n "$CALLERS" ] && [ "$CALLERS" != "0" ] && CONTEXT="$CONTEXT | $CALLERS external callers"

# Mark file as seen so we don't repeat for subsequent edits to the same file
echo "$FILE_PATH" >> "$CONTEXT_CACHE"

log_hook "graph-context" "inject" "$REL_PATH"
echo "$CONTEXT"
