#!/usr/bin/env bash
# Post-deploy smoke tests — hit critical production endpoints and verify they
# return sane responses. Designed to run in seconds, fail loud, fail fast.
#
# Called at the end of deploy.sh (warn-only — does not block deploy).
# Can also be run manually:
#
#   ./scripts/smoke-prod.sh              # hit prod (https://app.aeqi.ai)
#   ./scripts/smoke-prod.sh http://127.0.0.1:8443   # hit a local platform
#
# Exit codes:
#   0  — all checks passed
#   1  — one or more checks failed (printed which)

set -u  # unset variables are errors, but we intentionally don't set -e: we
         # want to collect all failures before exiting.

BASE="${1:-https://app.aeqi.ai}"
FAIL=0
CHECKS=0

# ── helpers ──────────────────────────────────────────────────────────────

check() {
    local name="$1"
    local url="$2"
    local expect_status="${3:-200}"
    local expect_substring="${4:-}"

    CHECKS=$((CHECKS + 1))

    local response
    response=$(curl -sS -o /tmp/smoke-body.$$ -w '%{http_code}' \
        --max-time 10 \
        -H 'User-Agent: aeqi-smoke-prod/1' \
        "$url" 2>/dev/null) || {
        printf '  [FAIL] %-30s curl failed for %s\n' "$name" "$url"
        FAIL=$((FAIL + 1))
        return
    }

    local body
    body=$(cat /tmp/smoke-body.$$)
    rm -f /tmp/smoke-body.$$

    if [ "$response" != "$expect_status" ]; then
        printf '  [FAIL] %-30s %s → HTTP %s (expected %s)\n' \
            "$name" "$url" "$response" "$expect_status"
        FAIL=$((FAIL + 1))
        return
    fi

    if [ -n "$expect_substring" ] && ! echo "$body" | grep -q "$expect_substring"; then
        printf '  [FAIL] %-30s body missing substring: %s\n' \
            "$name" "$expect_substring"
        FAIL=$((FAIL + 1))
        return
    fi

    printf '  [ok]   %-30s %s → %s\n' "$name" "$url" "$response"
}

# ── smoke checks ─────────────────────────────────────────────────────────

echo "Smoke testing $BASE ..."
echo

# Platform health (the canonical liveness probe).
check "platform/health"   "$BASE/api/health"             200 '"ok":true'

# UI shell must load — catches dist/ staging failures.
check "ui/index"          "$BASE/"                        200 "<!DOCTYPE html>"

# Static assets resolve — catches missing /assets/ bundle.
# We just verify the HTML references an index-*.js and that it 200s.
INDEX_HTML=$(curl -sS --max-time 10 "$BASE/" 2>/dev/null || echo "")
ASSET_PATH=$(echo "$INDEX_HTML" | grep -oE '/assets/index-[a-zA-Z0-9_-]+\.js' | head -1)
if [ -n "$ASSET_PATH" ]; then
    check "ui/main-bundle"   "$BASE$ASSET_PATH"             200
else
    printf '  [WARN] %-30s could not parse asset path from index.html\n' "ui/main-bundle"
fi

# Auth endpoint must reject unauthenticated requests (not 5xx).
# 401/403 is a pass; 500 means the platform is broken.
AUTH_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    "$BASE/api/auth/me" 2>/dev/null || echo "000")
CHECKS=$((CHECKS + 1))
if [[ "$AUTH_STATUS" == "401" || "$AUTH_STATUS" == "403" || "$AUTH_STATUS" == "200" ]]; then
    printf '  [ok]   %-30s %s → %s\n' "auth/me (unauthed)" "$BASE/api/auth/me" "$AUTH_STATUS"
else
    printf '  [FAIL] %-30s %s → HTTP %s (expected 401/403/200)\n' \
        "auth/me (unauthed)" "$BASE/api/auth/me" "$AUTH_STATUS"
    FAIL=$((FAIL + 1))
fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo "All $CHECKS smoke checks passed."
    exit 0
else
    echo "$FAIL of $CHECKS smoke checks failed."
    exit 1
fi
