#!/usr/bin/env bash
# Guard the source-available public repository surface.
#
# This scanner intentionally checks only tracked files. Maintainers may keep
# local operator scripts, UX walks, and notes in ignored paths; they must not
# become part of the public tree.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
cd "$ROOT"

fail=0

report() {
    local title="$1"
    local body="$2"

    if [ -n "$body" ]; then
        printf '\n[public-surface] %s\n' "$title" >&2
        printf '%s\n' "$body" >&2
        fail=1
    fi
}

tracked_paths() {
    git ls-files
}

tracked_text_paths() {
    git ls-files \
        '*.md' '*.mdx' '*.txt' '*.toml' '*.json' '*.yml' '*.yaml' \
        '*.rs' '*.js' '*.jsx' '*.ts' '*.tsx' '*.css' '*.sh' \
        ':!:apps/ui/package-lock.json' \
        ':!:scripts/public-surface-scan.sh' \
        ':!:Cargo.lock'
}

blocked_paths=$(
    tracked_paths | rg -n \
        '(^|/)(CLAUDE\.md|OPEN_SOURCE_EXPERIENCE_REPORT\.md|RELEASES\.md|INDEXER\.md|platform-friction\.md|skills-lock\.json)$|^\.agents/|^\.claude/|^docs/internal/|^scripts/ux-|^scripts/persona-walk-|^scripts/_.*\.mjs$|^scripts/(smoke-prod(\.mjs|\.sh)?|deploy-storybook\.sh|aeqi-tenant-mcp\.mjs|audit-frontend\.mjs|self-observe\.mjs)$|^apps/ui/scripts/ux-' || true
)
report "blocked tracked paths" "$blocked_paths"

root_raster_assets=$(
    tracked_paths | rg -n '^[^/]+\.(png|jpe?g|webp|gif)$' || true
)
report "root raster assets" "$root_raster_assets"

local_paths=$(
    tracked_text_paths | xargs -r rg -n -I --with-filename \
        '(/home/claudedev|/Users/[^[:space:]]+/aeqi|C:\\Users\\[^[:space:]]+\\aeqi)' || true
)
report "local workstation paths" "$local_paths"

internal_markers=$(
    tracked_text_paths | xargs -r rg -n -I --with-filename \
        '\b(AEIQ|dogfood)\b|docs/internal|OPEN_SOURCE_EXPERIENCE_REPORT|platform-friction|aeqi-indexer-build|aeqi-core-deploy-fix|ux-walk|persona-walk|smoke-prod' || true
)
report "internal or dogfood markers" "$internal_markers"

# `/etc/aeqi/secrets.env` is a canonical secret path. Operator scripts and
# security-feature code (file_safety denylist, runtime walks doc comments)
# legitimately reference it as DATA, not a leak. Narrow allowlist: only the
# files that build/exercise the path as a literal — not arbitrary mentions.
prod_markers=$(
    tracked_text_paths | xargs -r rg -n -I --with-filename \
        'aeqi-host-[<{]?(entity|entity_id)|Cross-tenant|/var/lib/aeqi/containers|/etc/aeqi/secrets\.env' \
        | rg -v \
            '^crates/aeqi-tools/src/file_safety\.rs:|^crates/aeqi-orchestrator/src/walks\.rs:|^scripts/rollout-sandbox-runtimes\.sh:' \
        || true
)
report "hosted production markers" "$prod_markers"

open_source_mislabel=$(
    git ls-files '*.md' '*.mdx' ':!:LICENSE' | xargs -r rg -n -I --with-filename \
        '\b(open[- ]source|OSS)\b' || true
)
if [ -n "$open_source_mislabel" ]; then
    allowed_open_source=$(
        printf '%s\n' "$open_source_mislabel" | rg -v \
            'README\.md:.*Converts to Apache 2\.0|docs/README\.md:|docs/runtime-platform-separation\.md:' || true
    )
    report "open-source wording in BSL repo" "$allowed_open_source"
fi

if [ "$fail" -ne 0 ]; then
    cat >&2 <<'EOF'

Public surface scan failed.

Move internal/operator artifacts to ignored paths, or rewrite examples to use
generic placeholders such as <host>, <entity_id>, and <repo>. If a term is a
legitimate public API, update this scanner with a narrow allowlist entry.
EOF
    exit 1
fi

echo "[public-surface] clean"
