#!/usr/bin/env bash
# SessionStart hook: injects AEQI primers into Claude Code context.
#
# Event behavior:
#   startup  — daemon health + full primer + reverse channel
#   resume   — daemon health + full primer + reverse channel
#   compact  — short primer with project context if recently injected (<5 min), full otherwise

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-log.sh"
source "$SCRIPT_DIR/detect-project.sh"

export AEQI_CONFIG
AEQI_BIN="/home/claudedev/aeqi/target/release/aeqi"
[ -x "$AEQI_BIN" ] || AEQI_BIN="/home/claudedev/aeqi/target/debug/aeqi"
if [ ! -x "$AEQI_BIN" ]; then
    echo "# AEQI Primer: UNAVAILABLE (binary not found)" >&2
    exit 0
fi

AEQI_DIR="$(dirname "$SCRIPT_DIR")"
EVENT="${1:-startup}"
SOCK="${AEQI_DATA_DIR:-$HOME/.aeqi}/rm.sock"

# --- Detect project from $PWD ---
PROJECT=$(detect_project)

# --- Daemon health check ---
emit_health() {
    if [ ! -S "$SOCK" ]; then
        echo "# AEQI: daemon OFFLINE (socket missing)"
        return
    fi
    local resp
    resp=$(printf '{"cmd":"ping"}' | socat -t2 - UNIX-CONNECT:"$SOCK" 2>/dev/null) || true
    if [ -z "$resp" ]; then
        echo "# AEQI: daemon OFFLINE (no response)"
        return
    fi
    # Get memory count and active claims for context
    local status_resp
    status_resp=$(printf '{"cmd":"status"}' | socat -t2 - UNIX-CONNECT:"$SOCK" 2>/dev/null) || true
    if [ -n "$status_resp" ]; then
        local uptime workers
        uptime=$(printf '%s' "$status_resp" | jq -r '.uptime // empty' 2>/dev/null)
        workers=$(printf '%s' "$status_resp" | jq -r '.active_workers // 0' 2>/dev/null)
        echo "# AEQI: daemon UP | uptime: ${uptime:-?} | workers: ${workers:-0}"
    else
        echo "# AEQI: daemon UP"
    fi
}

# --- Reverse notes channel: surface signals from previous sessions ---
emit_reverse_channel() {
    [ -S "$SOCK" ] || return 0
    local proj="${1:-aeqi}"
    # Query for recent nudges and findings
    local bb_resp
    bb_resp=$(printf '{"cmd":"notes","project":"%s","limit":10}' "$proj" | socat -t2 - UNIX-CONNECT:"$SOCK" 2>/dev/null) || true
    [ -z "$bb_resp" ] && return 0

    # Extract entries with signal: or finding: prefixes from recent notes
    local signals
    signals=$(printf '%s' "$bb_resp" | jq -r '
        .entries // [] | map(select(
            (.key | startswith("signal:remember-nudge")) or
            (.key | startswith("finding:")) or
            (.key | startswith("decision:"))
        )) | .[:5] | .[] | "- [\(.key)] \(.content[:120])"
    ' 2>/dev/null) || true

    if [ -n "$signals" ]; then
        echo ""
        echo "## Notes Signals"
        echo "$signals"
    fi
}

# --- Graph staleness check + auto-index ---
emit_graph_status() {
    local proj="${1:-aeqi}"
    local graph_dir="${AEQI_DATA_DIR:-$HOME/.aeqi}/codegraph"
    local db_path="$graph_dir/${proj}.db"

    if [ ! -f "$db_path" ]; then
        echo "# Graph: not indexed. Run aeqi_graph(action='index', project='$proj') to build."
        return
    fi

    # Check if graph is stale (compare indexed commit vs HEAD)
    local repo_path
    repo_path=$(awk -v proj="$proj" -v home="$HOME" '
        /^\[\[projects\]\]/ { in_proj=1; name=""; repo=""; next }
        /^\[/ && !/^\[\[projects\./ { if (in_proj && name==proj) { gsub(/^~/,home,repo); print repo; exit }; in_proj=0 }
        in_proj && /^name[[:space:]]*=/ { val=$0; sub(/^[^=]*=[[:space:]]*"?/,"",val); sub(/".*/, "",val); if(!name) name=val }
        in_proj && /^repo[[:space:]]*=/ { val=$0; sub(/^[^=]*=[[:space:]]*"?/,"",val); sub(/".*/, "",val); repo=val }
        END { if (in_proj && name==proj) { gsub(/^~/,home,repo); print repo } }
    ' "$AEQI_CONFIG" 2>/dev/null)

    local node_count edge_count
    node_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM code_nodes" 2>/dev/null || echo "0")
    edge_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM code_edges" 2>/dev/null || echo "0")

    if [ -n "$repo_path" ] && [ -d "$repo_path/.git" ]; then
        local head_commit
        head_commit=$(git -C "$repo_path" rev-parse --short HEAD 2>/dev/null) || true
        local indexed_commit
        indexed_commit=$(sqlite3 "$db_path" "SELECT value FROM meta WHERE key='last_commit'" 2>/dev/null) || true

        if [ -n "$head_commit" ] && [ "$head_commit" != "$indexed_commit" ]; then
            # Auto-index if stale and binary available
            if [ -x "$AEQI_BIN" ]; then
                local INIT_CALL='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook","version":"0.2"}}}'
                local INDEX_CALL="{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"aeqi_graph\",\"arguments\":{\"action\":\"incremental\",\"project\":\"$proj\"}}}"
                local idx_resp
                idx_resp=$(cd "$AEQI_DIR" && printf '%s\n%s\n' "$INIT_CALL" "$INDEX_CALL" | "$AEQI_BIN" mcp 2>/dev/null | tail -1) || true
                if [ -n "$idx_resp" ]; then
                    local new_nodes new_edges
                    new_nodes=$(printf '%s' "$idx_resp" | jq -r '.result.content[0].text' 2>/dev/null | jq -r '.nodes // 0' 2>/dev/null) || true
                    new_edges=$(printf '%s' "$idx_resp" | jq -r '.result.content[0].text' 2>/dev/null | jq -r '.edges // 0' 2>/dev/null) || true
                    echo "# Graph: re-indexed ${proj} (${new_nodes:-?} nodes, ${new_edges:-?} edges)"
                    log_hook "session-primer" "graph-reindex" "project=$proj nodes=${new_nodes:-?}"
                    return
                fi
            fi
            echo "# Graph: STALE (indexed at ${indexed_commit:-?}, HEAD is ${head_commit}). Run aeqi_graph(action='index', project='$proj')."
        else
            echo "# Graph: ${node_count:-?} nodes, ${edge_count:-?} edges (current)"
        fi
    else
        echo "# Graph: ${node_count:-?} nodes, ${edge_count:-?} edges"
    fi
}

# --- Compact event: context was compressed, model lost context ---
# Clear the recall gate — model must recall again to get domain knowledge back.
# Always inject the FULL primer (no short version — compaction means context is gone).
if [ "$EVENT" = "compact" ]; then
    rm -f "$AEQI_SESSION_DIR/recall.gate" 2>/dev/null || true
    log_hook "session-primer" "compact" "recall gate cleared — model must re-recall"

    # Surface previously loaded skills so the model knows to reload them
    SKILLS_FILE="$AEQI_SESSION_DIR/skills.loaded"
    if [ -f "$SKILLS_FILE" ] && [ -s "$SKILLS_FILE" ]; then
        LOST_SKILLS=$(tr '\n' ', ' < "$SKILLS_FILE" | sed 's/, $//')
        echo "# Context compacted. Previously loaded skills: $LOST_SKILLS"
        echo "# Re-load with: aeqi_prompts(action='get', name='<skill>')"
        echo ""
    fi

    # Fall through to full primer injection below
fi

# --- Full primer injection (startup / resume / compact) ---

# Emit health + graph status
emit_health
emit_graph_status "${PROJECT:-aeqi}"

# Build MCP calls
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"hook","version":"0.2"}}}'
SHARED_CALL='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"aeqi_primer","arguments":{"project":"shared"}}}'

AGENTS_CALL='{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"aeqi_agents","arguments":{"action":"list"}}}'

if [ -n "$PROJECT" ] && [ "$PROJECT" != "shared" ]; then
    PROJECT_CALL="{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"aeqi_primer\",\"arguments\":{\"project\":\"$PROJECT\"}}}"
    SKILLS_CALL='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"aeqi_prompts","arguments":{"action":"list"}}}'
    RESPONSES=$(cd "$AEQI_DIR" && printf '%s\n%s\n%s\n%s\n%s\n' "$INIT" "$SHARED_CALL" "$PROJECT_CALL" "$SKILLS_CALL" "$AGENTS_CALL" | "$AEQI_BIN" mcp 2>/dev/null) || true
else
    PROJECTS_CALL='{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"aeqi_projects","arguments":{}}}'
    RESPONSES=$(cd "$AEQI_DIR" && printf '%s\n%s\n%s\n%s\n' "$INIT" "$SHARED_CALL" "$PROJECTS_CALL" "$AGENTS_CALL" | "$AEQI_BIN" mcp 2>/dev/null) || true
fi

# Parse responses and emit formatted primer (jq — zero python dependency)
_mcp_inner() {
    printf '%s' "$RESPONSES" | jq -s --argjson id "$1" \
        '[.[] | select(.id == $id)] | .[0].result.content[0].text // empty' -r 2>/dev/null
}

# Shared primer (id=2)
SHARED_RAW=$(_mcp_inner 2)
if [ -n "$SHARED_RAW" ]; then
    SHARED_BODY=$(printf '%s' "$SHARED_RAW" | jq -r '.content // empty' 2>/dev/null)
    if [ -n "$SHARED_BODY" ]; then
        printf '# Shared Workflow Primer (from AEQI)\n%s\n\n' "$SHARED_BODY"
    fi
fi

# Project primer (id=3) — strip shared primer appended after standalone ---
PROJECT_RAW=$(_mcp_inner 3)
if [ -n "$PROJECT_RAW" ]; then
    PROJECT_BODY=$(printf '%s' "$PROJECT_RAW" | jq -r '.content // empty' 2>/dev/null)
    if [ -n "$PROJECT_BODY" ]; then
        PROJECT_BODY=$(printf '%s' "$PROJECT_BODY" | awk '/^---$/{exit} {print}')
        if [ -n "$PROJECT_BODY" ]; then
            printf '# Project Primer: %s (from AEQI)\n%s\n\n' "$PROJECT" "$PROJECT_BODY"
        fi
    fi
fi

# Quick Reference (always)
cat <<'QREF'
## Quick Reference — MCP Tool Names
  mcp__aeqi__aeqi_recall, mcp__aeqi__aeqi_remember, mcp__aeqi__aeqi_primer
  mcp__aeqi__aeqi_prompts, mcp__aeqi__aeqi_agents, mcp__aeqi__aeqi_notes
  mcp__aeqi__aeqi_create_task, mcp__aeqi__aeqi_close_task, mcp__aeqi__aeqi_status
QREF

# Skills list (id=4) — workflow skills first, then by phase
if [ -n "$PROJECT" ] && [ "$PROJECT" != "shared" ]; then
    SKILLS_RAW=$(_mcp_inner 4)
    if [ -n "$SKILLS_RAW" ]; then
        # Workflow skills — shown prominently with descriptions for selection
        WORKFLOW_FMT=$(printf '%s' "$SKILLS_RAW" | jq -r '
            .skills // [] |
            map(select(.tags // [] | index("workflow"))) |
            if length == 0 then empty else
            .[] | "  - \(.name): \(.description // .preview // "")"
            end
        ' 2>/dev/null)
        if [ -n "$WORKFLOW_FMT" ]; then
            printf '\n## Workflows (load one before starting)\n%s\n' "$WORKFLOW_FMT"
        fi

        # Phase skills — grouped by phase, excluding workflows
        SKILLS_FMT=$(printf '%s' "$SKILLS_RAW" | jq -r --arg proj "$PROJECT" '
            .skills // [] |
            map(select(
                (.source == $proj or .source == "shared") and
                ((.tags // []) | index("workflow") | not)
            )) |
            group_by((.tags // ["implement"])[0]) |
            map({
                tag: (.[0].tags // ["implement"])[0],
                names: ([.[] | .name] | .[0:5] | join(", ")) +
                    (if length > 5 then ", ..." else "" end)
            }) |
            sort_by(
                {"discover":0,"plan":1,"implement":2,"verify":3,"finalize":4}[.tag] // 99
            ) |
            .[] | "  \(.tag): \(.names)"
        ' 2>/dev/null)
        if [ -n "$SKILLS_FMT" ]; then
            printf '\n## Skills for %s (load per phase as needed)\n%s\n' "$PROJECT" "$SKILLS_FMT"
        fi
    fi
fi

# Agents list (id=6) — show available agents for current project or shared
AGENTS_RAW=$(_mcp_inner 6)
if [ -n "$AGENTS_RAW" ]; then
    PROJ_FILTER="${PROJECT:-shared}"
    AGENTS_FMT=$(printf '%s' "$AGENTS_RAW" | jq -r --arg proj "$PROJ_FILTER" '
        .agents // [] |
        map(select(.source == $proj or .source == "shared")) |
        .[] | "  \(.name) — \(.description // "")"
    ' 2>/dev/null)
    if [ -n "$AGENTS_FMT" ]; then
        printf '\n## Agents (use aeqi_agents to load templates)\n%s\n' "$AGENTS_FMT"
    fi
fi

# Projects list (id=5) — when in root directory
if [ -z "$PROJECT" ] || [ "$PROJECT" = "shared" ]; then
    PROJECTS_RAW=$(_mcp_inner 5)
    if [ -n "$PROJECTS_RAW" ]; then
        PROJECTS_FMT=$(printf '%s' "$PROJECTS_RAW" | jq -r '
            {
                "aeqi": "agent runtime + orchestration (Rust, 9 crates)",
                "algostaking": "lunar-epoch market making (Rust, 15 services)",
                "riftdecks-shop": "card e-commerce (Next.js)",
                "entity-legal": "legal entity platform (Next.js)",
                "aeqi": "venture OS smart contracts (Solidity)",
                "unifutures": "decentralized futures (Solidity)"
            } as $descs |
            .projects // [] | .[] |
            "  \(.name) \u2014 \($descs[.name] // "prefix=\(.prefix // "?")")"
        ' 2>/dev/null)
        if [ -n "$PROJECTS_FMT" ]; then
            printf '\n## Active Projects\n%s\n' "$PROJECTS_FMT"
        fi
    fi
fi

# Reverse notes channel — surface signals from prior sessions
emit_reverse_channel "${PROJECT:-aeqi}"

log_hook "session-primer" "injected" "event=$EVENT project=${PROJECT:-root}"
