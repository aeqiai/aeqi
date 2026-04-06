#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="/var/www/aeqi-ai"

echo "Building landing page..."
cd "$SCRIPT_DIR"
npm run build --silent

echo "Deploying to $DEPLOY_DIR..."
sudo rsync -a --delete dist/ "$DEPLOY_DIR/"

echo "Deployed to aeqi.ai"
