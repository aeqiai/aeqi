#!/usr/bin/env bash
# Compatibility wrapper for older checkouts or docs that still call this path.
# The canonical pre-push contract lives in scripts/ci-local.sh and the
# installed hook is scripts/git-hooks/pre-push.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
exec "$ROOT/scripts/ci-local.sh" prepush
