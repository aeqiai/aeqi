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
  # rm -rf can race against a concurrent sibling-worktree symlink that
  # holds file handles open on viem / walletconnect / appkit nested dirs
  # and exits ENOTEMPTY. When rm fails, skip to npm install directly —
  # it repairs the partial tree in-place and restores .bin/ symlinks
  # without requiring a clean slate. A full nuke is only strictly needed
  # when npm install itself exits non-zero after the partial tree.
  if rm -rf node_modules 2>/dev/null; then
    npm install
  else
    echo "rm-rf ENOTEMPTY (sibling worktree active) — repairing in-place"
    npm install
  fi
fi

# Bin-link insurance. After an interrupted install or a worktree-symlink
# race, npm sometimes leaves packages installed but `.bin/<tool>`
# symlinks missing — `vite --version` may pass while `tsc` / `prettier`
# / `eslint` are absent, which breaks worktree verifies later. `npm
# rebuild` is fast (~5s) and idempotent; force-recreates every bin
# symlink without touching the package tree.
npm rebuild >/dev/null 2>&1 || true

./node_modules/.bin/vite build

# Post-build assertion. `vite build` has been seen to exit 0 while
# leaving dist/index.html missing — the surrounding `--delete` rsync
# then ships a half-written bundle (assets present, no entry HTML),
# and the live site 404s on `/`. Hit once 2026-05-03; root cause not
# yet pinned (suspected race with a concurrent build). Assert here
# so the script fails loud instead of shipping the gap.
test -f dist/index.html || {
  echo "build did not produce dist/index.html — refusing to rsync"
  exit 1
}

rsync -a --delete dist/ "$TARGET/"

# Post-rsync assertion. Defends against an empty source dir, a wrong
# TARGET path, or a partial rsync that drops the entry HTML. Without
# this, `echo deployed: $(stat …)` swallows the missing file because
# the stat error lives inside `$(...)` in an echo and doesn't trip
# `set -e`.
test -f "$TARGET/index.html" || {
  echo "rsync completed but $TARGET/index.html is missing"
  exit 1
}

echo "rsync complete"
echo "deployed: $(stat -c %y dist/index.html | cut -d. -f1)"
