#!/usr/bin/env bash
# scripts/ui-deploy.sh — atomic UI-only deploy.
#
# Builds apps/ui and rsyncs the bundle to aeqi-platform/ui-dist/. The
# /ship skill calls this; humans can also run it directly after a
# manual edit.
#
# Why this script exists: the inline recipe is `vite build && rsync`,
# which is correct — but every session adapter that types it by hand
# eventually adds `2>&1 | tail -3` to trim the build output, masking
# the exit code and letting rsync ship the previous dist on a failed
# build. This script removes the composition surface so the recipe
# can't be misadapted.
#
# Exit non-zero on any failure. Never silently ship a stale bundle.

set -euo pipefail

REPO=/home/claudedev/aeqi
UI=$REPO/apps/ui
TARGET=/home/claudedev/aeqi-platform/ui-dist

cd "$UI"

# Vite recovery. Plain `[ -x .bin/vite ]` is unreliable — the symlink
# can resolve while its target directory is missing (partial install
# from a prior interrupted run). Test by actually executing.
if ! ./node_modules/.bin/vite --version >/dev/null 2>&1; then
  echo "vite missing or broken — repairing"
  npm install || true
fi
if ! ./node_modules/.bin/vite --version >/dev/null 2>&1; then
  echo "still broken — full nuke"
  # rm -rf can race against a concurrent finalizer (sibling worktree
  # symlink teardown, npm install partial state) and exit ENOTEMPTY on
  # deeply nested viem / walletconnect / appkit dirs. Retry once after
  # a brief pause — by the second attempt the kernel has settled.
  rm -rf node_modules || (sleep 2 && rm -rf node_modules)
  npm install
fi

# Bin-link insurance. After an interrupted install or a worktree-symlink
# race, npm sometimes leaves packages installed but `.bin/<tool>`
# symlinks missing — `vite --version` may pass while `tsc` / `prettier`
# / `eslint` are absent, which breaks worktree verifies later. `npm
# rebuild` is fast (~5s) and idempotent; force-recreates every bin
# symlink without touching the package tree.
npm rebuild >/dev/null 2>&1 || true

./node_modules/.bin/vite build
rsync -a --delete dist/ "$TARGET/"

echo "deployed: $(stat -c %y dist/index.html | cut -d. -f1)"
