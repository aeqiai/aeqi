#!/usr/bin/env bash
# Repeatable onboarding hygiene loop for cron, CI, and local contributor checks.
#
# This is intentionally offline-friendly and non-destructive: it reuses local
# scripts, isolates AEQI runtime state under temporary HOME directories, and only
# reads the optional Hermes comparison repo when HERMES_REPO is provided.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

failures=0

log() {
    printf '[onboarding-loop] %s\n' "$*"
}

record_fail() {
    printf '[onboarding-loop] FAIL: %s\n' "$*" >&2
    failures=$((failures + 1))
}

run_step() {
    local name="$1"
    shift

    log "$name"
    if "$@"; then
        log "PASS: $name"
    else
        record_fail "$name"
    fi
}

resolve_aeqi_bin() {
    if [ -n "${AEQI_BIN:-}" ]; then
        command -v "$AEQI_BIN" >/dev/null 2>&1 || [ -x "$AEQI_BIN" ] || return 1
        case "$AEQI_BIN" in
            /*) printf '%s\n' "$AEQI_BIN" ;;
            *) command -v "$AEQI_BIN" ;;
        esac
        return 0
    fi

    if [ -x "$REPO_ROOT/target/debug/aeqi" ]; then
        printf '%s\n' "$REPO_ROOT/target/debug/aeqi"
        return 0
    fi

    if [ -x "$REPO_ROOT/target/release/aeqi" ]; then
        printf '%s\n' "$REPO_ROOT/target/release/aeqi"
        return 0
    fi

    command -v aeqi 2>/dev/null || return 1
}

require_aeqi_bin() {
    if AEQI_RESOLVED_BIN="$(resolve_aeqi_bin)"; then
        export AEQI_BIN="$AEQI_RESOLVED_BIN"
        log "AEQI binary: $AEQI_BIN"
        return 0
    fi

    printf '%s\n' \
        "No AEQI binary found. Build one with 'cargo build -p aeqi' or set AEQI_BIN=/path/to/aeqi." >&2
    return 1
}

smoke_paths_if_available() {
    local candidate paths_bin path_bin
    paths_bin=""

    for candidate in "$REPO_ROOT/target/debug/aeqi" "$REPO_ROOT/target/release/aeqi"; do
        if [ -x "$candidate" ] && "$candidate" paths --help >/dev/null 2>&1; then
            paths_bin="$candidate"
            break
        fi
    done

    if [ -z "$paths_bin" ] && path_bin="$(command -v aeqi 2>/dev/null)"; then
        if "$path_bin" paths --help >/dev/null 2>&1; then
            paths_bin="$path_bin"
        fi
    fi

    if [ -z "$paths_bin" ]; then
        log "SKIP: aeqi paths is not available in target/debug/aeqi or PATH"
        return 0
    fi

    local tmp
    tmp="$(mktemp -d)"

    log "aeqi paths binary: $paths_bin"
    log "aeqi paths --help"
    "$paths_bin" paths --help >/dev/null

    log "aeqi paths"
    if ! HOME="$tmp" \
        XDG_CONFIG_HOME="$tmp/.config" \
        XDG_DATA_HOME="$tmp/.local/share" \
            env -C "$tmp" "$paths_bin" paths >/dev/null; then
        rm -rf "$tmp"
        return 1
    fi
    rm -rf "$tmp"
}

check_optional_hermes_signals() {
    if [ -z "${HERMES_REPO:-}" ]; then
        log "SKIP: HERMES_REPO not set"
        return 0
    fi

    if [ ! -d "$HERMES_REPO" ]; then
        printf 'HERMES_REPO does not exist or is not a directory: %s\n' "$HERMES_REPO" >&2
        return 1
    fi

    local root_rasters
    root_rasters="$(
        find "$REPO_ROOT" -maxdepth 1 -type f \
            \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \) \
            -print
    )"
    if [ -n "$root_rasters" ]; then
        printf 'Root raster assets found in AEQI repo:\n%s\n' "$root_rasters" >&2
        return 1
    fi

    root_rasters="$(
        find "$HERMES_REPO" -maxdepth 1 -type f \
            \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' \) \
            -print
    )"
    if [ -n "$root_rasters" ]; then
        printf 'Root raster assets found in Hermes comparison repo:\n%s\n' "$root_rasters" >&2
        return 1
    fi

    if ! grep -R -q -E '(\$HOME|~)/\.aeqi|config/aeqi\.toml|aeqi setup --workspace' \
        README.md docs scripts 2>/dev/null; then
        printf '%s\n' "AEQI onboarding docs/scripts do not clearly mention home/config setup paths." >&2
        return 1
    fi

    if ! grep -R -q -E '(\$HOME|~)/\.hermes|HERMES_HOME|config\.yaml' \
        "$HERMES_REPO/README.md" "$HERMES_REPO/docs" "$HERMES_REPO/scripts" 2>/dev/null; then
        printf '%s\n' "Hermes comparison repo lacks visible home/config documentation signals." >&2
        return 1
    fi

    log "Hermes comparison signals present: no root raster assets; AEQI and Hermes document home/config paths"
}

main() {
    log "repo: $REPO_ROOT"

    if require_aeqi_bin; then
        run_step "public surface scan" scripts/public-surface-scan.sh
        run_step "golden README quickstart smoke" scripts/smoke-quickstart-readme.sh
        run_step "aeqi paths smoke if available" smoke_paths_if_available
    else
        run_step "public surface scan" scripts/public-surface-scan.sh
        record_fail "golden README quickstart smoke requires an AEQI binary"
        record_fail "aeqi paths smoke requires an AEQI binary"
    fi

    run_step "optional Hermes hygiene comparison" check_optional_hermes_signals

    if [ "$failures" -ne 0 ]; then
        printf '[onboarding-loop] completed with %s failure(s)\n' "$failures" >&2
        return 1
    fi

    log "completed successfully"
}

main "$@"
