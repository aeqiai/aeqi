#!/usr/bin/env bash
# Prepare an AEQI checkout for source builds without creating runtime state.
#
# This script intentionally does not run `aeqi setup`, copy .env files, write
# secrets, install services, or create repository-local runtime data.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RUN_UI_INSTALL=1
RUN_UI_BUILD=1
RUN_CARGO_BUILD=1
CHECK_ONLY=0

usage() {
    cat <<'USAGE'
Usage: scripts/setup-contributor.sh [options]

Prepares source build prerequisites in a conservative order:
  1. verify local tools
  2. npm run ui:install
  3. npm run ui:build
  4. cargo build

Options:
  --check-only        Verify tools and print guidance without installing/building
  --skip-ui-install  Skip npm run ui:install
  --skip-ui-build    Skip npm run ui:build
  --skip-cargo-build Skip cargo build
  -h, --help         Show this help

Runtime setup is explicit and separate:
  aeqi setup              # default: writes runtime state under your home AEQI dir
  aeqi setup --workspace  # opt in to workspace-local runtime state
USAGE
}

log() {
    printf '\n==> %s\n' "$1"
}

note() {
    printf '    %s\n' "$1"
}

die() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || die "required tool '$1' not found in PATH"
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --check-only)
                CHECK_ONLY=1
                RUN_UI_INSTALL=0
                RUN_UI_BUILD=0
                RUN_CARGO_BUILD=0
                ;;
            --skip-ui-install)
                RUN_UI_INSTALL=0
                ;;
            --skip-ui-build)
                RUN_UI_BUILD=0
                ;;
            --skip-cargo-build)
                RUN_CARGO_BUILD=0
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                die "unknown option: $1"
                ;;
        esac
        shift
    done
}

check_node_version() {
    local major

    need node
    major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
    if [ -z "$major" ] || [ "$major" -lt 22 ]; then
        die "Node.js 22+ is required for apps/ui; found $(node --version 2>/dev/null || printf 'unknown')"
    fi
}

print_runtime_boundary() {
    log "Runtime state boundary"
    note "This helper prepares source build dependencies only."
    note "It will not run 'aeqi setup', create .env files, write secrets, install services, or seed runtime databases."
    note "Use 'aeqi setup' for the default home-scoped runtime state."
    note "Use 'aeqi setup --workspace' only when you intentionally want workspace-local runtime state."
}

run_ui_install() {
    log "Installing UI dependencies"
    note "Running: npm run ui:install"
    npm run ui:install
}

run_ui_build() {
    log "Building UI"
    note "Running: npm run ui:build"
    npm run ui:build
}

run_cargo_build() {
    log "Building Rust workspace"
    note "Running: cargo build"
    cargo build
}

main() {
    parse_args "$@"

    cd "$REPO_ROOT"

    log "Checking prerequisites"
    need npm
    need cargo
    check_node_version
    note "npm: $(npm --version)"
    note "node: $(node --version)"
    note "cargo: $(cargo --version)"

    print_runtime_boundary

    if [ "$CHECK_ONLY" -eq 1 ]; then
        log "Check-only mode complete"
        note "No install, build, or runtime setup commands were run."
    else
        if [ "$RUN_UI_INSTALL" -eq 1 ]; then
            run_ui_install
        else
            log "Skipping UI dependency install"
        fi

        if [ "$RUN_UI_BUILD" -eq 1 ]; then
            run_ui_build
        else
            log "Skipping UI build"
        fi

        if [ "$RUN_CARGO_BUILD" -eq 1 ]; then
            run_cargo_build
        else
            log "Skipping Rust build"
        fi
    fi

    log "Next steps"
    note "To configure runtime credentials and local state in your home AEQI dir: aeqi setup"
    note "To opt into workspace-local runtime state instead: aeqi setup --workspace"
    note "This script does not invoke either command automatically."
}

main "$@"
