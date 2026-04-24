#!/usr/bin/env bash
# Build and publish Storybook to storybook.aeqi.ai.
#
# The main ./scripts/deploy.sh only ships apps/ui/dist (the app). Storybook
# is served by nginx from /var/www/storybook-aeqi/ as its own static site;
# this script is what refreshes it.
#
# Usage:
#   ./scripts/deploy-storybook.sh

set -euo pipefail

AEQI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI_ROOT="$AEQI_ROOT/apps/ui"
WEB_ROOT="/var/www/storybook-aeqi"

cd "$UI_ROOT"

if [ ! -d "$WEB_ROOT" ]; then
    echo "[deploy-storybook] $WEB_ROOT does not exist. Not a production server?"
    exit 1
fi

echo "[1/3] Building storybook..."
npx storybook build --quiet 2>&1 | tail -3

echo "[2/3] Syncing to $WEB_ROOT ..."
rsync -a --delete --exclude='.well-known' "$UI_ROOT/storybook-static/" "$WEB_ROOT/"

echo "[3/3] Smoke testing https://storybook.aeqi.ai ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://storybook.aeqi.ai/index.json?bust=$(date +%s)")
if [ "$HTTP_CODE" = "200" ]; then
    echo "  [ok]   https://storybook.aeqi.ai/index.json → 200"
    echo
    echo "Deploy successful."
else
    echo "  [fail] https://storybook.aeqi.ai/index.json → $HTTP_CODE"
    exit 1
fi
