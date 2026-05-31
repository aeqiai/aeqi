#!/usr/bin/env bash
# Smoke test the first-time-user path: setup -> doctor -> config show -> agent list.
# Runs against an isolated $HOME so the developer's real ~/.aeqi is untouched.
#
# Default behaviour: build the debug binary from the worktree being checked.
# We deliberately do NOT company `aeqi` on $PATH — that would silently smoke-test
# whatever stale global install the developer has, which is the opposite of
# what this script is meant to gate.
#
# Usage:
#   scripts/smoke-fresh-install.sh                                # build + smoke
#   AEQI_BIN=/abs/path/to/aeqi scripts/smoke-fresh-install.sh     # use prebuilt
#
# Exit codes:
#   0 — first-run path is clean (only allowlisted WARNs from doctor)
#   1 — script invariant broken (binary missing, etc.)
#   2 — doctor surfaced a structural issue (unexpected WARN/FAIL)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Resolve AEQI_BIN to an absolute path. If unset, build from this worktree.
# Never fall back to `command -v aeqi` — see header comment.
if [ -n "${AEQI_BIN:-}" ]; then
    case "$AEQI_BIN" in
        /*) ;;  # already absolute
        *) AEQI_BIN="$(cd "$(dirname "$AEQI_BIN")" && pwd)/$(basename "$AEQI_BIN")" ;;
    esac
else
    echo "[build] cargo build -p aeqi (debug)"
    cargo build -p aeqi
    AEQI_BIN="$REPO_ROOT/target/debug/aeqi"
fi

if [ ! -x "$AEQI_BIN" ]; then
    echo "error: AEQI_BIN ('$AEQI_BIN') is not an executable file" >&2
    exit 1
fi
echo "[smoke] using binary: $AEQI_BIN"

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

# `doctor` runs in --strict so we get a non-zero exit if any BLOCK
# issues remain. NEEDS / OPT items are expected on a clean install
# (provider key not set, ollama not reachable, etc.) and don't fail
# strict mode. Any unexpected BLOCK / FAIL is a structural regression
# and trips this script.
#
# We still allow-list a few known WARN-style log lines (e.g. tracing
# warns from the sqlite-vec module loader) that aren't doctor checks
# but get printed to stdout by underlying crates.
echo
echo "[smoke] doctor --strict (BLOCK fails strict; NEEDS / OPT are setup TODOs)"
DOCTOR_LOG="$TMP_HOME/doctor.log"
DOCTOR_EXIT=0
HOME="$TMP_HOME" \
XDG_CONFIG_HOME="$TMP_HOME/.config" \
XDG_DATA_HOME="$TMP_HOME/.local/share" \
    env -C "$NEUTRAL_CWD" "$AEQI_BIN" doctor --strict 2>&1 | tee "$DOCTOR_LOG" \
    || DOCTOR_EXIT=$?

if [ "$DOCTOR_EXIT" -ne 0 ]; then
    echo
    echo "[smoke] FAIL — doctor --strict exited $DOCTOR_EXIT (structural break)."
    exit 2
fi

# Defence-in-depth: allow-list scan of any [BLOCK] / [FAIL] / [WARN]
# lines that did slip through (in case strict mode is loosened later).
ALLOWED_PATTERNS=(
    "Ollama: error sending request"
    "Ollama: HTTP error"
    "sqlite-vec virtual table unavailable"
)
UNEXPECTED=0
while IFS= read -r line; do
    matched=0
    for pat in "${ALLOWED_PATTERNS[@]}"; do
        case "$line" in
            *"$pat"*) matched=1; break ;;
        esac
    done
    if [ "$matched" = "0" ]; then
        echo "[smoke] UNEXPECTED: $line"
        UNEXPECTED=$((UNEXPECTED + 1))
    fi
done < <(grep -E '^\[(BLOCK|FAIL|WARN)\]' "$DOCTOR_LOG" || true)

if [ "$UNEXPECTED" -gt 0 ]; then
    echo
    echo "[smoke] FAIL — doctor surfaced $UNEXPECTED unexpected issue(s)."
    echo "         Either fix the regression, or add the substring to"
    echo "         ALLOWED_PATTERNS in scripts/smoke-fresh-install.sh after"
    echo "         confirming it's expected on a clean install."
    exit 2
fi

echo
echo "[smoke] PASS — first-time-user path works end-to-end."
