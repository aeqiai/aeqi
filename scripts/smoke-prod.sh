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
# Authed checks (entities ↔ billing drift, X-Entity proxy header end-to-end)
# require a long-lived JWT for a smoke-test account. Sources, in order:
#   1. $SMOKE_TEST_TOKEN env var
#   2. /etc/aeqi/smoke.token (root-only readable)
# When neither is present the authed block is skipped with a WARN — these
# checks are advisory; deploy.sh already invokes us non-blocking.
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

# Authed variant: writes the response body to OUT_FILE, prints an [ok]/[FAIL]
# line itself, and returns 0 on success / 1 on failure. Counters are owned
# by the caller (we cannot mutate them from inside command substitution).
authed_request() {
    local name="$1"
    local url="$2"
    local token="$3"
    local extra_header="$4"
    local out_file="$5"
    local expect_status="${6:-200}"

    local curl_args=(
        -sS -o "$out_file" -w '%{http_code}'
        --max-time 10
        -H 'User-Agent: aeqi-smoke-prod/1'
        -H "Authorization: Bearer $token"
    )
    if [ -n "$extra_header" ]; then
        curl_args+=(-H "$extra_header")
    fi

    local response
    response=$(curl "${curl_args[@]}" "$url" 2>/dev/null) || {
        printf '  [FAIL] %-30s curl failed for %s\n' "$name" "$url"
        : > "$out_file"
        return 1
    }

    if [ "$response" != "$expect_status" ]; then
        printf '  [FAIL] %-30s %s → HTTP %s (expected %s)\n' \
            "$name" "$url" "$response" "$expect_status"
        : > "$out_file"
        return 1
    fi

    printf '  [ok]   %-30s %s → %s\n' "$name" "$url" "$response"
    return 0
}

# ── smoke checks ─────────────────────────────────────────────────────────

echo "Smoke testing $BASE ..."
echo

# Platform health (the canonical liveness probe).
check "platform/health"   "$BASE/api/health"             200 '"ok":true'

# UI shell must load — catches dist/ staging failures.
check "ui/index"          "$BASE/"                        200 "<html"

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

# ── authed checks ────────────────────────────────────────────────────────
# Catches the bug class where deploy claims "successful" while every authed
# request 400s in prod (the X-Root → X-Entity proxy header rename, 2026-04).
# Also catches /api/entities ↔ /api/billing/overview count drift — they
# describe the same set of companies and must agree.

SMOKE_TOKEN=""
if [ -n "${SMOKE_TEST_TOKEN:-}" ]; then
    SMOKE_TOKEN="$SMOKE_TEST_TOKEN"
elif [ -r /etc/aeqi/smoke.token ]; then
    SMOKE_TOKEN=$(cat /etc/aeqi/smoke.token)
fi

echo
if [ -z "$SMOKE_TOKEN" ]; then
    echo "  [WARN] authed checks skipped — no \$SMOKE_TEST_TOKEN or /etc/aeqi/smoke.token"
elif ! command -v jq >/dev/null 2>&1; then
    echo "  [WARN] authed checks skipped — jq not installed on this host"
else
    ENTITIES_FILE="/tmp/smoke-entities.$$"
    BILLING_FILE="/tmp/smoke-billing.$$"
    AGENTS_FILE="/tmp/smoke-agents.$$"

    CHECKS=$((CHECKS + 1))
    ENTITIES_OK=0
    if authed_request "entities (authed)" "$BASE/api/entities" \
            "$SMOKE_TOKEN" "" "$ENTITIES_FILE" 200; then
        ENTITIES_OK=1
    else
        FAIL=$((FAIL + 1))
    fi

    CHECKS=$((CHECKS + 1))
    BILLING_OK=0
    if authed_request "billing/overview" "$BASE/api/billing/overview" \
            "$SMOKE_TOKEN" "" "$BILLING_FILE" 200; then
        BILLING_OK=1
    else
        FAIL=$((FAIL + 1))
    fi

    CHECKS=$((CHECKS + 1))
    if [ "$ENTITIES_OK" = "1" ] && [ "$BILLING_OK" = "1" ]; then
        ENTITIES_COUNT=$(jq -r '.roots | length' "$ENTITIES_FILE" 2>/dev/null || echo "?")
        BILLING_COUNT=$(jq -r '.companies | length' "$BILLING_FILE" 2>/dev/null || echo "?")
        if [ "$ENTITIES_COUNT" = "$BILLING_COUNT" ] && [ "$ENTITIES_COUNT" != "?" ]; then
            printf '  [ok]   %-30s entities=%s billing=%s\n' \
                "entities ↔ billing parity" "$ENTITIES_COUNT" "$BILLING_COUNT"
        else
            printf '  [FAIL] %-30s entities=%s billing=%s (drift)\n' \
                "entities ↔ billing parity" "$ENTITIES_COUNT" "$BILLING_COUNT"
            FAIL=$((FAIL + 1))
        fi

        # Pick the first entity name — proxied /api/agents needs an
        # X-Entity header, and we want to prove the rename works
        # end-to-end (request reaches the runtime and returns 200), not
        # just that the platform accepts the header.
        FIRST_ENTITY=$(jq -r '.roots[0].name // empty' "$ENTITIES_FILE" 2>/dev/null)
        if [ -n "$FIRST_ENTITY" ]; then
            CHECKS=$((CHECKS + 1))
            if ! authed_request "agents (X-Entity proxy)" "$BASE/api/agents" \
                    "$SMOKE_TOKEN" "X-Entity: $FIRST_ENTITY" "$AGENTS_FILE" 200; then
                FAIL=$((FAIL + 1))
            fi
        else
            printf '  [WARN] %-30s no entities to probe X-Entity proxy with\n' \
                "agents (X-Entity proxy)"
        fi
    else
        printf '  [FAIL] %-30s could not fetch both bodies, skipping parity check\n' \
            "entities ↔ billing parity"
        FAIL=$((FAIL + 1))
    fi

    rm -f "$ENTITIES_FILE" "$BILLING_FILE" "$AGENTS_FILE"
fi

echo
if [ "$FAIL" -eq 0 ]; then
    echo "All $CHECKS smoke checks passed."
    exit 0
else
    echo "$FAIL of $CHECKS smoke checks failed."
    exit 1
fi
