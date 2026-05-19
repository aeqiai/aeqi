#!/usr/bin/env bash
# Wire the tracked hooks in scripts/git-hooks/ into this clone's git.
#
# Run once per fresh clone:
#   scripts/install-git-hooks.sh
#
# This sets core.hooksPath locally — no global side effects, no submodule
# magic. Hooks are tracked in-tree so they evolve with the repo.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

HOOKS_DIR="scripts/git-hooks"

if [ ! -d "$HOOKS_DIR" ]; then
    echo "error: $HOOKS_DIR not found" >&2
    exit 1
fi

chmod +x "$HOOKS_DIR"/*

git config core.hooksPath "$HOOKS_DIR"

echo "✓ git hooks installed (core.hooksPath = $HOOKS_DIR)"
echo "  pre-commit  → cargo fmt --all --check on staged .rs"
echo "  pre-push    → fmt + clippy + tests (scripts/pre-push.sh)"
echo ""
echo "Bypass either gate with --no-verify when you mean it."
