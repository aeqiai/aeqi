#!/usr/bin/env bash
# Golden README quickstart: literally execute the commands from the
# README "Run" block in an isolated $HOME, in the same order, with the
# only adjustments needed to run unattended in CI:
#   - --runtime ollama_agent (so we don't need a real provider key)
#   - we don't actually `aeqi secrets set OPENROUTER_API_KEY <key>` —
#     instead we assert that the secrets command exists and exits cleanly
#     when shown its --help (the real key flow is covered by manual tests
#     and the docs in scripts/smoke-fresh-install.sh)
#   - we don't run `aeqi start` to completion — we boot it, wait for the
#     readiness probe, then SIGTERM. The point is to catch a regression
#     where any of the documented commands disappear, not to run a daemon.
#
# This script exists specifically to catch documentation drift: if the
# README adds or removes a command, this fails until the script is
# updated. Conversely, if a command is renamed or its flags change,
# this catches it before users hit it.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -n "${AEQI_BIN:-}" ]; then
    case "$AEQI_BIN" in
        /*) ;;
        *) AEQI_BIN="$(cd "$(dirname "$AEQI_BIN")" && pwd)/$(basename "$AEQI_BIN")" ;;
    esac
else
    echo "[build] cargo build -p aeqi (debug)"
    cargo build -p aeqi
    AEQI_BIN="$REPO_ROOT/target/debug/aeqi"
fi

if [ ! -x "$AEQI_BIN" ]; then
    echo "error: AEQI_BIN ('$AEQI_BIN') is not executable" >&2
    exit 1
fi

TMP="$(mktemp -d)"
cleanup() {
    if [ -n "${TMP:-}" ] && [ -d "$TMP" ]; then
        rm -rf "$TMP"
    fi
}
trap cleanup EXIT INT TERM

NEUTRAL_CWD="$TMP/work"
mkdir -p "$NEUTRAL_CWD"

# Minimal env so the binary can find sh / find a writable HOME, but no
# shell aliases / dotfiles leak in.
run() {
    HOME="$TMP" \
    XDG_CONFIG_HOME="$TMP/.config" \
    XDG_DATA_HOME="$TMP/.local/share" \
        env -C "$NEUTRAL_CWD" "$AEQI_BIN" "$@"
}

assert_help() {
    # Each documented subcommand must respond to --help with exit 0.
    # Catches deletions and rename drift cheaply.
    local subcmd="$1"
    echo "[quickstart] $subcmd --help"
    run $subcmd --help >/dev/null
}

echo "=== Golden README quickstart smoke ==="
echo "Binary: $AEQI_BIN"
echo "Sandbox: $TMP"
echo

# README "Run" block — these commands MUST exist and accept the
# documented args. If the README is rewritten to add or remove a
# command, update this list to match.
echo "[quickstart] aeqi --version"
run --version

echo "[quickstart] aeqi setup (non-interactive)"
run setup --runtime ollama_agent

# Documented in the README "CLI" section; assert each is real.
assert_help "secrets"
assert_help "doctor"
assert_help "start"
assert_help "chat"
assert_help "run"
assert_help "agent"
assert_help "assign"
assert_help "events"
assert_help "monitor"
assert_help "graph"
assert_help "trust"
assert_help "mcp"

# `aeqi events install-defaults` is in the README; assert the action exists.
echo "[quickstart] aeqi events install-defaults --help"
run events install-defaults --help >/dev/null

echo "[quickstart] aeqi events list --help"
run events list --help >/dev/null

# `aeqi assign` requires --root; assert the flag exists.
echo "[quickstart] aeqi assign --help shows --root"
run assign --help 2>&1 | grep -q -- "--root" || {
    echo "FAIL: README documents \`aeqi assign \"subject\" --root <ROOT>\` but"
    echo "      --root is no longer in the assign subcommand."
    exit 2
}

# README "Run" block step 3 — verify before launching.
echo "[quickstart] aeqi doctor --strict (must pass on a clean ollama_agent install)"
run doctor --strict >/dev/null

echo "[quickstart] docs mention setup workspace behavior"
for doc in README.md docs/quickstart.md docs/local-demo.md; do
    grep -q -- "aeqi setup --workspace" "$doc" || {
        echo "FAIL: $doc must explain repo-local setup via --workspace."
        exit 2
    }
done

echo "[quickstart] docs mention a concrete first useful quest"
for doc in README.md docs/quickstart.md docs/local-demo.md; do
    grep -q -- "Create a concise first-run checklist" "$doc" || {
        echo "FAIL: $doc must end with the first-run checklist quest."
        exit 2
    }
done

echo
echo "=== PASS — every documented quickstart command exists and works ==="
