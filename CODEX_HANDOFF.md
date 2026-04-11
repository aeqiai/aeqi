# Codex Handoff: AEQI Chat UI + Runtime Deploy

Date: 2026-04-10

## User Goal

Improve AEQI chat UI/UX and deploy it to `app.aeqi.ai`.

## Repo State

Working tree intentionally has uncommitted edits. Do not revert them.

Modified in `/home/claudedev/aeqi`:
- `apps/ui/src/components/AgentSessionView.tsx`
- `apps/ui/src/components/AppLayout.tsx`
- `apps/ui/src/components/RoundAvatar.tsx`
- `apps/ui/src/styles/chat.css`
- `apps/ui/package.json`
- `apps/ui/package-lock.json`
- `crates/aeqi-core/src/agent.rs`
- `crates/aeqi-orchestrator/src/daemon.rs`
- `crates/aeqi-orchestrator/src/session_manager.rs`

Also updated platform-served artifacts in `/home/claudedev/aeqi-platform`:
- `ui-dist/`
- `runtime/bin/aeqi`

## What Was Fixed

Chat/session correctness:
- Fixed the UI-side stale `activeSessionId` closure via `sessionIdRef`.
- Fixed the deeper backend/UI split by allowing spawned sessions to bind to the UI session id.
- Added persisted `assistant_complete` metadata so refreshed messages keep duration/cost/tokens.
- Added `tool_use_id` to persisted tool-complete metadata.

Live vs refreshed rendering:
- Removed duplicate live transcript state: no more separate `streamText`, `liveToolEvents`, or `toolEvents` render paths.
- Live and refreshed messages now render from `segments`.
- `Turn N`, runtime status, memory activity, compacted, and delegate progress events no longer get folded into the final assistant message.
- Removed premature hardcoded `Recalling insights...`; memory activity now only emits after actual memory recall.

Visual/chat UI:
- Tool blocks use clean labels/status dots instead of mixed glyph icons.
- Metadata moved into a footer line.
- Copy button appears on hover.
- Markdown lists, blockquotes, tables, links, and code block styling improved.
- Message turn spacing improved in `chat.css`, especially user -> assistant and assistant -> user.
- User chat avatar now uses the real auth-store account image/name (`user.avatar_url`, `user.name`) instead of `localStorage.aeqi_user_name || "operator"`.
- `RoundAvatar` now accepts `src` and falls back to initials if the image fails.

Version:
- UI package metadata and footer label updated to `0.4.2`.

## Checks Already Passed

From `/home/claudedev/aeqi`:
- `npx tsc --noEmit` in `apps/ui`
- `npm run build` in `apps/ui`
- `cargo check -p aeqi-core -p aeqi-orchestrator -p aeqi`
- `cargo build --release -p aeqi`
- `git diff --check`

Known non-failing warning:
- Vite warns that one JS chunk is larger than 500 kB.

## Built/Staged Artifacts

Fresh local runtime binary:
- `/home/claudedev/aeqi/target/release/aeqi`

Staged platform tenant runtime binary:
- `/home/claudedev/aeqi-platform/runtime/bin/aeqi`
- Hash matches `target/release/aeqi` at the time of staging:
  `1b456bc7b759cb51d5bcf01ab5030768a26fb2c9716f4a5611e85b58c480835a`

Platform-served UI rebuilt:
- `/home/claudedev/aeqi-platform/ui-dist`

The platform UI was rebuilt with:
```bash
npm_config_ignore_scripts=true /home/claudedev/aeqi-platform/scripts/build-ui.sh /home/claudedev/aeqi
```

Reason for `npm_config_ignore_scripts=true`:
- In the restricted Codex sandbox, `npm ci` failed during esbuild postinstall with `EPERM` when trying to execute `node_modules/esbuild/bin/esbuild`.

## Remaining Deploy Blocker

Current Codex session was launched with sandbox restrictions and `--ask-for-approval never`. It could not run:
- `sudo ...` because `no_new_privileges` blocks sudo.
- `systemctl ...` because systemd bus access is blocked.
- network/DNS checks because outbound DNS is blocked in the sandbox.

So backend changes are built and staged, but already-running host/tenant processes may still need restarts.

## Restart Commands To Run With Host Rights

First inspect:
```bash
ps -eo pid,ppid,user,stat,lstart,cmd | rg 'aeqi-cloud|target/release/aeqi .*start|aeqi start|aeqi-tenant'
systemctl status --no-pager aeqi-platform.service aeqi-runtime.service
```

Then restart host services:
```bash
sudo systemctl restart aeqi-platform.service
sudo systemctl restart aeqi-runtime.service
```

Then restart tenant sandboxes so they pick up `/home/claudedev/aeqi-platform/runtime/bin/aeqi`.
Preferred if platform admin route is available:
```bash
curl -X POST https://app.aeqi.ai/api/admin/update \
  -H "x-admin-key: $AEQI_WEB_SECRET"
```

Alternative from host systemd:
```bash
systemctl list-units 'aeqi-tenant-*'
sudo systemctl restart 'aeqi-tenant-345234-234.service'
```

Actual visible tenant process before handoff included:
```text
/usr/bin/bwrap --ro-bind /home/claudedev/aeqi-platform/runtime/bin/aeqi /usr/local/bin/aeqi ... --bind /var/lib/aeqi/containers/345234-234 /data ... /usr/local/bin/aeqi start
```

## How To Relaunch Codex With Rights

Use either:
```bash
codex --ask-for-approval on-request --sandbox danger-full-access -C /home/claudedev/aeqi
```

or, if you intentionally want no sandbox prompts:
```bash
codex --dangerously-bypass-approvals-and-sandbox -C /home/claudedev/aeqi
```

After relaunch, tell Codex:
```text
Read CODEX_HANDOFF.md and finish the AEQI restart/deploy verification.
```

