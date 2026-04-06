#!/usr/bin/env bash
# Shared project detection — sourced by hook scripts.
# Parses aeqi.toml [[projects]] using awk. Zero python dependency.
#
# Usage:
#   source detect-project.sh
#   PROJECT=$(detect_project "/home/claudedev/aeqi/crates/foo.rs")
#   PROJECT=$(detect_project)  # uses $PWD

detect_project() {
    local target="${1:-$PWD}"
    local config="${AEQI_CONFIG:-/home/claudedev/aeqi/config/aeqi.toml}"

    [ -f "$config" ] || return 0

    # Expand ~ in target
    target="${target/#\~/$HOME}"

    # Parse [[projects]] name + repo pairs, find longest repo prefix match
    awk -v target="$target" -v home="$HOME" '
    function check_match() {
        if (name && repo) {
            gsub(/^~/, home, repo)
            rlen = length(repo)
            if (substr(target, 1, rlen) == repo && rlen > best_len) {
                c = substr(target, rlen+1, 1)
                if (c == "" || c == "/") {
                    best = name
                    best_len = rlen
                }
            }
        }
    }
    BEGIN { best=""; best_len=0; in_proj=0 }
    /^\[\[projects\]\]/ {
        # Process previous project block before starting new one
        if (in_proj) check_match()
        in_proj=1; name=""; repo=""; next
    }
    /^\[/ && !/^\[\[projects\./ {
        if (in_proj) { check_match(); in_proj=0 }
        next
    }
    in_proj && /^name[[:space:]]*=/ {
        val = $0
        sub(/^[^=]*=[[:space:]]*"?/, "", val)
        sub(/".*/, "", val)
        if (!name) name = val
    }
    in_proj && /^repo[[:space:]]*=/ {
        val = $0
        sub(/^[^=]*=[[:space:]]*"?/, "", val)
        sub(/".*/, "", val)
        repo = val
    }
    END {
        if (in_proj) check_match()
        print best
    }
    ' "$config"
}

# Quickly check if a path belongs to ANY known project
is_project_path() {
    local result
    result=$(detect_project "$1")
    [ -n "$result" ]
}
