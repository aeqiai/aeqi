#!/usr/bin/env bash
# Smoke test the first-time-user path: setup -> doctor -> config show -> agent list.
# Runs against an isolated $HOME so the developer's real ~/.aeqi is untouched.
#
# Designed to be runnable both locally and in CI. It builds a debug binary if
# `aeqi` isn't already on $PATH, and uses the `ollama_agent` runtime preset so
# the path doesn't depend on a live provider key.
#
# Usage:
#   scripts/smoke-fresh-install.sh                  # build debug binary, smoke
#   AEQI_BIN=target/release/aeqi scripts/smoke-fresh-install.sh   # use prebuilt

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

AEQI_BIN="${AEQI_BIN:-}"
if [ -z "$AEQI_BIN" ]; then
    if command -v aeqi >/dev/null 2>&1; then
        AEQI_BIN="aeqi"
    else
        echo "[build] cargo build -p aeqi (debug)"
        cargo build -p aeqi
        AEQI_BIN="$REPO_ROOT/target/debug/aeqi"
    fi
fi

if [ ! -x "$AEQI_BIN" ] && ! command -v "$AEQI_BIN" >/dev/null 2>&1; then
    echo "error: AEQI_BIN ('$AEQI_BIN') is not executable" >&2
    exit 1
fi

TMP_HOME="$(mktemp -d)"
cleanup() {
    if [ -n "${TMP_HOME:-}" ] && [ -d "$TMP_HOME" ]; then
        rm -rf "$TMP_HOME"
    fi
}
trap cleanup EXIT INT TERM

# Run aeqi from a directory that is NOT a workspace, so setup writes
# starter files under $TMP_HOME/.aeqi (the curl-install path).
NEUTRAL_CWD="$TMP_HOME/work"
mkdir -p "$NEUTRAL_CWD"

run() {
    echo
    echo "[smoke] $*"
    HOME="$TMP_HOME" \
    XDG_CONFIG_HOME="$TMP_HOME/.config" \
    XDG_DATA_HOME="$TMP_HOME/.local/share" \
        env -C "$NEUTRAL_CWD" "$AEQI_BIN" "$@"
}

run --version
run setup --runtime ollama_agent
run config show >/dev/null
run agent list >/dev/null

# `doctor` (non-strict) must run cleanly even when no provider is reachable.
# We capture exit code separately because doctor returns non-zero if it can't
# even read the config — that's a real regression. A WARN about Ollama not
# being reachable is fine.
echo
echo "[smoke] doctor (non-strict; Ollama warn is expected)"
HOME="$TMP_HOME" \
XDG_CONFIG_HOME="$TMP_HOME/.config" \
XDG_DATA_HOME="$TMP_HOME/.local/share" \
    env -C "$NEUTRAL_CWD" "$AEQI_BIN" doctor

echo
echo "[smoke] PASS — first-time-user path works end-to-end."
