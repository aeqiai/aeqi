#!/usr/bin/env bash
set -euo pipefail

ROOT_REPO="${AEQI_REPO:-/home/claudedev/aeqi}"
APP_NODE_MODULES="$ROOT_REPO/apps/ui/node_modules"
ROOT_NODE_MODULES="$ROOT_REPO/node_modules"

usage() {
  cat <<'EOF'
Usage:
  scripts/ui-worktree.sh doctor <worktree> [--repair]
  scripts/ui-worktree.sh dev <worktree> [--port <port|auto>] [--api <prod|url|port>]
  scripts/ui-worktree.sh visual <worktree> --url <route> [visual-route args...]
  scripts/ui-worktree.sh cleanup <worktree>

Examples:
  npm run ui:wt -- doctor /home/claudedev/aeqi-ui-work --repair
  npm run ui:wt -- dev /home/claudedev/aeqi-ui-work --port auto --api prod
  npm run ui:wt -- visual /home/claudedev/aeqi-ui-work --url /trust/.../roles --require-auth
EOF
}

die() {
  echo "ui-worktree: $*" >&2
  exit 1
}

abs_path() {
  local target="$1"
  if [[ "$target" = /* ]]; then
    printf '%s\n' "$target"
  else
    printf '%s/%s\n' "$PWD" "$target"
  fi
}

link_node_modules() {
  local link_path="$1"
  local target_path="$2"
  local repair="$3"

  [[ -d "$target_path" ]] || die "missing dependency target: $target_path"

  if [[ -L "$link_path" ]]; then
    local current
    current="$(readlink "$link_path")"
    [[ "$current" == "$target_path" ]] && return 0
    [[ "$repair" == "1" ]] || die "$link_path points at $current; rerun with --repair"
    rm "$link_path"
  elif [[ -e "$link_path" ]]; then
    [[ "$repair" == "1" ]] || die "$link_path already exists; rerun with --repair"
    rm -rf "$link_path"
  fi

  ln -s "$target_path" "$link_path"
}

doctor() {
  local wt="$1"
  local repair="${2:-0}"
  [[ -d "$wt/.git" || -f "$wt/.git" ]] || die "not a git worktree: $wt"
  [[ -f "$wt/apps/ui/package.json" ]] || die "missing apps/ui/package.json in $wt"

  if [[ "$repair" == "1" && ! -d "$APP_NODE_MODULES" ]]; then
    (cd "$ROOT_REPO/apps/ui" && npm ci)
  fi
  if [[ "$repair" == "1" && ! -d "$ROOT_NODE_MODULES" ]]; then
    (cd "$ROOT_REPO" && npm install)
  fi

  [[ -x "$APP_NODE_MODULES/.bin/tsc" ]] || die "missing UI tsc in $APP_NODE_MODULES"
  [[ -x "$APP_NODE_MODULES/.bin/prettier" ]] || die "missing UI prettier in $APP_NODE_MODULES"
  [[ -f "$ROOT_NODE_MODULES/playwright/package.json" ]] || die "missing root playwright in $ROOT_NODE_MODULES"

  link_node_modules "$wt/apps/ui/node_modules" "$APP_NODE_MODULES" "$repair"
  link_node_modules "$wt/node_modules" "$ROOT_NODE_MODULES" "$repair"

  echo "ui-worktree: ok $wt"
}

free_port() {
  local port="${1:-5173}"
  while ss -ltn "( sport = :$port )" | grep -q ":$port"; do
    port=$((port + 1))
  done
  printf '%s\n' "$port"
}

api_target() {
  local api="${1:-prod}"
  case "$api" in
    prod) printf '%s\n' "https://app.aeqi.ai" ;;
    local) printf '%s\n' "http://127.0.0.1:8400" ;;
    http://*|https://*) printf '%s\n' "$api" ;;
    *[!0-9]*) die "unknown --api value: $api" ;;
    *) printf 'http://127.0.0.1:%s\n' "$api" ;;
  esac
}

cmd="${1:-}"
[[ -n "$cmd" ]] || { usage; exit 2; }
shift

case "$cmd" in
  doctor)
    [[ $# -ge 1 && -n "${1:-}" ]] || die "doctor requires a worktree path"
    wt="$(abs_path "${1:-}")"
    repair=0
    [[ "${2:-}" == "--repair" ]] && repair=1
    doctor "$wt" "$repair"
    ;;
  dev)
    [[ $# -ge 1 && -n "${1:-}" ]] || die "dev requires a worktree path"
    wt="$(abs_path "${1:-}")"
    shift
    port="5173"
    api="prod"
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --port) port="${2:-}"; shift 2 ;;
        --api) api="${2:-}"; shift 2 ;;
        *) die "unknown dev arg: $1" ;;
      esac
    done
    [[ "$port" == "auto" ]] && port="$(free_port 5173)"
    doctor "$wt" 1
    echo "ui-worktree: dev http://127.0.0.1:$port -> $(api_target "$api")"
    cd "$wt/apps/ui"
    AEQI_UI_API_PROXY_TARGET="$(api_target "$api")" npm run dev -- --host 127.0.0.1 --port "$port" --strictPort
    ;;
  visual)
    [[ $# -ge 1 && -n "${1:-}" ]] || die "visual requires a worktree path"
    wt="$(abs_path "${1:-}")"
    shift
    doctor "$wt" 1
    cd "$wt"
    npm run visual:route -- "$@"
    ;;
  cleanup)
    [[ $# -ge 1 && -n "${1:-}" ]] || die "cleanup requires a worktree path"
    wt="$(abs_path "${1:-}")"
    [[ -L "$wt/apps/ui/node_modules" ]] && rm "$wt/apps/ui/node_modules"
    [[ -L "$wt/node_modules" ]] && rm "$wt/node_modules"
    echo "ui-worktree: cleaned $wt"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
