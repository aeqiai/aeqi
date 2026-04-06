#!/usr/bin/env bash
# PostToolUse hook for mcp__aeqi__aeqi_close_task: verify new code is integrated.
# Checks graph for symbols in edited files that have zero incoming edges.
# Advisory — warns but doesn't block task closure.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

EDITS_LOG="$AEQI_SESSION_DIR/edits.log"

# Only run if edits were tracked this session
[ -f "$EDITS_LOG" ] && [ -s "$EDITS_LOG" ] || exit 0

PROJECT=$(detect_project)
[ -z "$PROJECT" ] && exit 0

GRAPH_DB="${AEQI_DATA_DIR:-$HOME/.aeqi}/codegraph/${PROJECT}.db"
[ -f "$GRAPH_DB" ] || exit 0

# Get repo path for relative path computation
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

# Check edited files for symbols with zero callers
WARNINGS=""
EDITED_FILES=$(sort -u "$EDITS_LOG")
for abs_path in $EDITED_FILES; do
    REL="${abs_path#$REPO_PATH/}"
    [ "$REL" = "$abs_path" ] && continue

    # Find exported symbols in this file with zero incoming CALLS edges
    ORPHANS=$(sqlite3 "$GRAPH_DB" "
        SELECT n.name || ' (' || n.label || ')'
        FROM code_nodes n
        WHERE n.file_path = '$REL'
        AND n.is_exported = 1
        AND n.label NOT IN ('file','module','community','process','property')
        AND NOT EXISTS (
            SELECT 1 FROM code_edges e
            WHERE e.target_id = n.id
            AND e.edge_type IN ('calls','implements','imports','uses')
        )
        LIMIT 5
    " 2>/dev/null) || true

    if [ -n "$ORPHANS" ]; then
        ORPHAN_LIST=$(echo "$ORPHANS" | tr '\n' ', ' | sed 's/, $//')
        WARNINGS="${WARNINGS}${REL}: ${ORPHAN_LIST}. "
    fi
done

if [ -n "$WARNINGS" ]; then
    log_hook "verify-integration" "warn" "$WARNINGS"
    echo "Integration check: exported symbols with zero callers — ${WARNINGS}Verify these are connected or intentionally standalone."
fi
