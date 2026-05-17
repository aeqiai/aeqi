#!/usr/bin/env bash
# Boot a freshly built aeqi runtime against a copied, non-fresh DB and
# require /api/health to respond. This catches startup-only failures:
# SQLite migration order, router path panics, stale bind handling, etc.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-${AEQI_SMOKE_RUNTIME_BIN:-${AEQI_BIN:-$ROOT/target/debug/aeqi}}}"
REQUIRED="${AEQI_SMOKE_REQUIRED:-0}"
TIMEOUT_SECS="${AEQI_SMOKE_TIMEOUT_SECS:-60}"

case "$BIN" in
  /*) ;;
  *) BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")" ;;
esac

if [ ! -x "$BIN" ]; then
  echo "[runtime-smoke] runtime binary not executable: $BIN" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "[runtime-smoke] curl is required" >&2
  exit 1
fi

discover_source_dir() {
  if [ -n "${AEQI_SMOKE_SOURCE_DIR:-}" ]; then
    if [ -f "$AEQI_SMOKE_SOURCE_DIR/aeqi.db" ]; then
      printf '%s\n' "$AEQI_SMOKE_SOURCE_DIR"
      return 0
    fi
    echo "[runtime-smoke] AEQI_SMOKE_SOURCE_DIR has no aeqi.db: $AEQI_SMOKE_SOURCE_DIR" >&2
    return 1
  fi

  local canonical="/var/lib/aeqi/hosts/6708630a-69c4-42fa-a8a7-5a00412a61cf"
  if [ -f "$canonical/aeqi.db" ]; then
    printf '%s\n' "$canonical"
    return 0
  fi

  if [ -f "$HOME/.aeqi/aeqi.db" ]; then
    printf '%s\n' "$HOME/.aeqi"
    return 0
  fi

  if [ -d /var/lib/aeqi/hosts ]; then
    local db
    db="$(find /var/lib/aeqi/hosts -maxdepth 4 -name aeqi.db -type f 2>/dev/null | sort | head -1 || true)"
    if [ -n "$db" ]; then
      dirname "$db"
      return 0
    fi
  fi

  return 1
}

SOURCE_DIR="$(discover_source_dir || true)"
if [ -z "$SOURCE_DIR" ]; then
  if [ "$REQUIRED" = "1" ]; then
    echo "[runtime-smoke] no existing aeqi.db fixture found" >&2
    exit 1
  fi
  echo "[runtime-smoke] SKIP — no existing aeqi.db fixture found"
  exit 0
fi

choose_bind() {
  if [ -n "${AEQI_SMOKE_BIND:-}" ]; then
    printf '%s\n' "$AEQI_SMOKE_BIND"
    return 0
  fi

  local port
  for port in $(seq 18501 18530); do
    if ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$port$"; then
      printf '127.0.0.1:%s\n' "$port"
      return 0
    fi
  done

  echo "[runtime-smoke] no free smoke port in 18501..18530" >&2
  return 1
}

BIND="$(choose_bind)"
URL="http://$BIND/api/health"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aeqi-runtime-smoke.XXXXXX")"
DATA_DIR="$TMP/data"
CONFIG="$TMP/aeqi.toml"
LOG="$TMP/runtime.log"
PID=""

cleanup() {
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$DATA_DIR"

copy_sqlite_db() {
  local src="$1"
  local dst="$2"

  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$src" ".backup '$dst'"
    return 0
  fi

  cp "$src" "$dst"
  [ -f "$src-wal" ] && cp "$src-wal" "$dst-wal"
  [ -f "$src-shm" ] && cp "$src-shm" "$dst-shm"
}

for db in "$SOURCE_DIR"/*.db; do
  [ -f "$db" ] || continue
  copy_sqlite_db "$db" "$DATA_DIR/$(basename "$db")"
done
if [ -f "$SOURCE_DIR/project_ids.json" ]; then
  cp "$SOURCE_DIR/project_ids.json" "$DATA_DIR/project_ids.json"
fi

cat >"$CONFIG" <<EOF
[aeqi]
name = "runtime-smoke"
data_dir = "$DATA_DIR"
default_runtime = "ollama_agent"

[web]
auth_secret = "runtime-smoke-secret"

[providers.ollama]
url = "http://127.0.0.1:11434"
default_model = "llama3.1:8b"

[security]
autonomy = "supervised"
workspace_only = true
max_cost_per_day_usd = 0.01

[memory]
backend = "sqlite"
temporal_decay_halflife_days = 30

[team]
router_cooldown_secs = 60
max_background_cost_usd = 0.0

[orchestrator]
background_automation_enabled = false
expertise_routing = false
adaptive_retry = false
failure_analysis_model = "openai/gpt-4o-mini"
infer_deps_threshold = 0.85
dispatch_ttl_secs = 3600

[[agents]]
name = "smoke"
prefix = "smoke"
role = "orchestrator"
voice = "concise"
runtime = "ollama_agent"
max_workers = 0
EOF

echo "[runtime-smoke] booting $BIN with fixture $SOURCE_DIR on $BIND"
"$BIN" --config "$CONFIG" --log-level warn start --bind "$BIND" >"$LOG" 2>&1 &
PID="$!"

deadline=$((SECONDS + TIMEOUT_SECS))
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "[runtime-smoke] OK — $URL responded"
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[runtime-smoke] FAILED — runtime exited before health responded" >&2
    sed -n '1,160p' "$LOG" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "[runtime-smoke] FAILED — $URL did not respond within ${TIMEOUT_SECS}s" >&2
sed -n '1,200p' "$LOG" >&2 || true
exit 1
