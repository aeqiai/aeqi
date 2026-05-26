#!/usr/bin/env bash
# Atomic UI-only deploy: build apps/ui and rsync the bundle into the
# platform host's ui-dist. Use this for pure apps/ui changes; for any
# diff that touches Rust crates, blueprint JSON, or the binary build,
# run ./scripts/deploy.sh instead — that path rebuilds the runtime.
#
# Why a script and not an inline `npm run build && rsync`: every
# session that types the command by hand eventually adds a `2>&1 |
# tail -3` to trim output, which masks the build's exit code. With
# `set -euo pipefail` here, a failed build halts before rsync — so a
# broken bundle never overwrites the previous live dist.
#
# History: this script was first added 2026-05-14 (4d7a8712), then
# deleted later that day in 699c9f74 ("docs: explain hosted
# organization CLI flow" — commit message lied about diff content).
# Re-added 2026-05-14 with the same canonical recipe. If you want to
# remove it again, state that intent in the commit message AND remove
# the references in `apps/ui/CLAUDE.md` and the /ship skill.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UI_DIR="$REPO_ROOT/apps/ui"
TARGET="${AEQI_UI_DIST:-$HOME/aeqi-platform/ui-dist}"

if [ ! -d "$TARGET" ]; then
  echo "deploy failed: target $TARGET does not exist" >&2
  exit 1
fi

cd "$UI_DIR"
if node "$REPO_ROOT/scripts/ui-verify-stamp.mjs" --check --quiet; then
  echo "verified dist matches source - reusing apps/ui/dist"
else
  npm run build
fi

if [ ! -f "$UI_DIR/dist/index.html" ]; then
  echo "build did not produce dist/index.html — refusing to rsync" >&2
  exit 1
fi

rsync -a --delete "$UI_DIR/dist/" "$TARGET/"
echo "rsync complete"
