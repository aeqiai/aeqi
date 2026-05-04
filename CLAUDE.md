# aeqi

Unopinionated agent runtime. Four primitives: **agents**, **ideas**, **quests**, **events**.

This file is conventions for AI-pair-programming agents (e.g. Claude Code) working
in this repo. Human contributors should start at [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Development Standards

### Before every commit

```
cargo fmt
cargo clippy --workspace -- -D warnings
cargo test --workspace
cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"
```

All must pass before merge. The pre-commit hook only enforces the UI subset
when `apps/ui` files are staged; Rust checks remain a manual/CI responsibility.

**`cargo fmt` workspace false-positives.** `cargo fmt --check` run at the
workspace root may flag pre-existing formatting issues in sibling crates
(e.g. `aeqi-indexer` has known style drift). When adding a new crate, run
`cargo fmt -p <your-crate> -- --check` to isolate the check to your crate
only. Fix your crate's fmt; don't fix siblings unless you own that diff.

**`.observations/` lives in the main working tree, not worktrees.** The
`.observations/` directory is only present in `/home/claudedev/aeqi/` (the
main checkout). Worktrees don't have their own copy. When autonomous
subagents need to write to the state file, use the absolute path
`/home/claudedev/aeqi/.observations/autonomous-push-state.md` — not a
relative path from the worktree root.

**UX rerun scripts — keyword checks must be verified against screenshots.** When
writing P0 verification scripts (`scripts/ux-p0-rerun.mjs` pattern), content
keyword lists produce misleading FAIL verdicts if the keywords don't match what
the page actually renders. Specific traps hit 2026-05-05: (a) `æconomy`
(special char) not in the rendered text even though the economy page was live;
(b) `wallet` not present on `/me/treasury` which renders "balances" instead;
(c) `Economic` (capitalised) not matching lowercase body copy. Rule: after a
script reports FAIL, always inspect `bodyTextSample` from the JSON output AND
the screenshot before writing a BROKEN verdict. The script's PASS/FAIL is a
hint, not ground truth — screenshots are the source of record.

`cargo test --workspace` is non-negotiable — `cargo check --workspace` does
NOT compile test code. A required-field added to a public struct (e.g. `Template`
gaining `seed_roles` in `35113194`) can leave test fixtures uncompilable while
`cargo check --workspace` stays green; the break only surfaces when somebody
runs `cargo test -p <crate> --lib`. Caught one such drift on 2026-04-30
(`crates/aeqi-orchestrator/src/ipc/templates.rs` literal-init blocks at lines
767 + 1075). Run `cargo test --workspace` — or at minimum `cargo build --workspace --tests` — before declaring a Rust change green.

### Code quality

- Zero warnings, zero clippy lints, zero unused variables
- No backward compatibility aliases, stubs, or dead code
- No comments about removed code
- No `#[allow(dead_code)]` unless justified
- Use `spawn_blocking` for all SQLite operations in async context

### New-crate bootstrapping traps (edition 2024)

**`std::env::set_var` is `unsafe` in edition 2024.** Any test that
calls `std::env::set_var` must wrap it in an `unsafe {}` block with a
`// SAFETY: single-threaded test context; no concurrent env reads.`
comment. Applies to unit tests (`#[cfg(test)]` blocks) AND integration
tests (`tests/*.rs`). The compiler error is `call to unsafe function
requires unsafe block` on the `set_var` line. Cost (2026-05-04): two
edit passes — once in `src/signer.rs` unit tests, once in
`tests/api_smoke.rs` — when adding `aeqi-paymaster`.

**`anyhow::Result` vs a concrete error type mismatch in `spawn_blocking`
closures.** When a closure is typed as `Result<T, MyError>` but calls a
helper that returns `anyhow::Result<T>`, the `?` operator fails with
`From<anyhow::Error>` not implemented. Fix: add
`.map_err(|e| MyError::Internal(e.to_string()))` after the
`anyhow`-returning call, or add `#[from] anyhow::Error` to the error
enum if you own it. Cost (2026-05-04): one edit pass in `aeqi-paymaster`
`api.rs` `spawn_blocking` closure.

**SQLite test isolation: use `TempDir`, not `NamedTempFile`.** When
a test seeds a SQLite DB, then passes the path to a `spawn_blocking`
closure that opens it independently, using `tempfile::NamedTempFile`
causes `Error code 1032: Database cannot be modified because database
file has moved`. The fix is `tempfile::TempDir::new()` — keep the
`TempDir` value alive for the full test duration (e.g. as `_tmp` in a
destructuring tuple). Cost (2026-05-04): test rewrite and second
`cargo test` pass when adding `aeqi-paymaster`.

### Frontend

- Prettier enforced (double quotes, trailing commas, 100 width)
- Components extracted to own files (no 500-line monoliths)
- Path-based routing: `/agents/:id/:tab/:itemId`
- Reuse `asv-sidebar` / `asv-main` pattern for split layouts
- Design system: `apps/ui/src/styles/primitives.css` for tokens

### Architecture

- Events = pattern + tool_calls (Vec<ToolCall>). 7 lifecycle seeds:
  session:start, session:quest_start, session:quest_end, session:quest_result,
  session:step_start, session:stopped, context:budget:exceeded. session:start
  fires once at session birth (like a system prompt); session:execution_start
  fires every spawn (resume or fresh).
- ToolRegistry unifies LLM-fired and event-fired tool calls with CallerKind
  (Llm/Event/System) ACLs.
- Middleware detectors fire patterns (loop:detected, guardrail:violation,
  graph_guardrail:high_impact, shell:command_failed); events own the response
  via tool_calls; DEFAULT_HANDLERS preserve old behavior as fallback.
- Compaction-as-delegation: context:budget:exceeded fires session.spawn
  (lightweight ephemeral compactor session) + transcript.replace_middle.
  Current session_id preserved. Inline compaction pipeline is fallback when no
  PatternDispatcher.
- Legacy event fields (idea_ids, query_template, query_top_k, query_tag_filter)
  remain as fallback when tool_calls is empty.
- Ideas have tags (Vec<String>), no category field
- Quest owns worktree. Session owns nothing. Execution owns one turn.
- Every execution is ephemeral: one turn per spawn. The agent task exits on
  Complete. The next user/transport/scheduler trigger INSERTs into
  `pending_messages`, a fresh spawn starts. No parked agents, no mpsc input
  channels.
- Every execution in bwrap (when available)
- Auto-commit at end of turn in quest worktrees
- Tools configurable per agent via tool_deny

### Deploy

```
./scripts/deploy.sh
```

For UI-only changes (no Rust touched), use the lighter UI deploy path documented in `apps/ui/CLAUDE.md` — skip `deploy.sh`.

**`presets/blueprints/*.json` are compiled into the binary via `include_str!`.** Changes to any blueprint JSON require a full `./scripts/deploy.sh` — NOT the UI-only rsync path. Two consumers embed them at compile time: `crates/aeqi-orchestrator/src/blueprints/mod.rs` (runtime) and `aeqi-platform/src/blueprints.rs` (platform). Changing a blueprint JSON means both repos need a Rust rebuild and deploy to pick up the change. Caught 2026-05-04 when adding `templateSlug` field — the `/ship` skill correctly routed to full deploy because the files aren't under `apps/ui/`, but the reason (compile-time embedding) wasn't obvious.

### Deploy — known traps

**`scripts/deploy.sh` leaves per-tenant host services stopped.** The
script stops every `aeqi-host-<entity>.service`, swaps the binary,
restarts only `aeqi-platform.service`, then exits. Every host stays
dead until the next request triggers the proxy's "host runtime was
down, restarting" self-heal — and any in-flight WS / fetch in that
window 503s. Hit twice on 2026-05-01. Workaround until the script is
fixed:

```bash
for s in $(systemctl list-units --type=service --all | awk '/aeqi-host-/ {print $1}'); do
  sudo systemctl start "$s"
done
```

**"API error: Service Unavailable" diagnostic walk.** When 503s show
up after a deploy or for a freshly-created company:

1. `systemctl is-active aeqi-host-<entity>.service` — start it if dead.
2. `sudo journalctl -u aeqi-platform.service -n 50 | grep -i 'placement\|503'` — look for `runtime placement not ready`.
3. `sudo sqlite3 /var/lib/aeqi/platform.db "SELECT entity_id, placement_type, status, target_port FROM runtime_placements;"` — `status=pending` with NULL routing fields means provisioning never finished. Repoint the row to a live host as a manual fix; sandbox auto-provisioning is currently broken.

**Don't manually exercise `aeqi setup` from the worktree root.** Setup
treats any cwd that contains `Cargo.toml` / `.git` / `agents/` /
`config/` as workspace mode and writes seed agent files into that cwd
— so a one-off test from `/home/claudedev/aeqi-<branch>/` litters the
worktree with `agents/shared/WORKFLOW.md` and friends, which then
needs cleanup before commit. Use the wrapper:

```bash
scripts/dev-isolated-aeqi.sh setup --runtime ollama_agent
scripts/dev-isolated-aeqi.sh start --bind 127.0.0.1:18403
scripts/dev-isolated-aeqi.sh doctor --strict
```

It builds the debug binary if needed, mints a fresh `$HOME` + neutral
cwd in a tempdir, and execs aeqi with both pointed at it. Don't use
the bare `HOME=$tmp aeqi …` form — cwd is still the worktree, setup
detects workspace mode, and you're back to pulling stray
`agents/shared/` out of the diff. For full curl-install path coverage
(no manual single-command testing) use
`scripts/smoke-fresh-install.sh`. Hit twice in two consecutive ship
cycles 2026-05-02 / 2026-05-03 — wrapper added so muscle memory has
a shorter right answer than the wrong one.

**`scripts/deploy.sh` swallows UI build failures.** The `[1/4] Building dashboard UI...` step pipes `npm run build` through `2>&1 | tail -3`, so the pipe's exit code (always 0) wins under `set -e` and a failed vite build looks identical to a successful one in the deploy log ("✓ built in Xs" + "staged UI dist"). The Rust binary still ships, but `apps/ui/dist/` stays stale and the live `index-*.js` hash doesn't move. Verify after every full deploy: `cat /home/claudedev/aeqi/apps/ui/dist/index.html | grep -oE 'index-[A-Za-z0-9_-]+\.js'` MUST match `curl -sL https://app.aeqi.ai/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1`. If they diverge, the UI build silently failed — run `./node_modules/.bin/vite build` directly from `apps/ui/` to surface the real error (most often the viem partial-tree, fixed via `rm -rf apps/ui/node_modules && npm install`).

## Workflow — locked

**Never work on main directly.** Every non-trivial change goes through a worktree.
See `apps/ui/CLAUDE.md` "Worktree workflow" for the canonical ritual.

**Use `/ship` to merge + deploy.** The user has delegated the full ship cycle
(verify → commit → push → ff-or-cherry-pick → push main → cleanup → UI-only
deploy → auto-invoke `/evolve`) to the `/ship` skill. Never type
`git merge` / `rsync … ui-dist/` by hand from main — invoke `/ship`.

**`/evolve` runs after every `/ship`.** Captures any new friction into the
relevant CLAUDE.md / SKILL.md so the next session is smoother. Don't ask
permission; the user has delegated it. Small fixes apply directly. Bigger
proposals surface for review.

**`/design-system-wave` for primitive cluster work.** The 7-wave campaign
that canonized the apps/ui design system is packaged. To run another wave
(e.g., on a new cluster), invoke `/design-system-wave` with cluster name +
primitives. Skill handles parallel audits → synthesis → parallel
implementation → verify → ship.

## aeqi-web server — `into_make_service_with_connect_info` is mandatory

**`axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?`** — NOT `axum::serve(listener, app).await?`. Without `ConnectInfo`, `tower_governor`'s `SmartIpKeyExtractor` cannot extract the peer address from any request and throws `GovernorError::UnableToExtractKey` as HTTP 500 `Unable To Extract Key!`. This kills every rate-limited API route. `/api/health` is exempt (not rate-limited) so health checks pass while the rest 500 — making the server look healthy when it isn't.

The fix is one word: `app` → `app.into_make_service_with_connect_info::<SocketAddr>()` in `crates/aeqi-web/src/server.rs`. Add `use std::net::SocketAddr;` if not already imported. Cost (2026-05-05): VPS dogfood run — health check passed at 54s, all /api/* calls 500'd, entire VPS provision marked failed.

## Platform-level friction (out of our hands)

Tracked separately in `platform-friction.md`. These are paper cuts in the
Claude Code platform itself — the project conventions can route around
them but only the platform team can fix them. Add to that file when a
new pattern emerges; don't pollute project-level docs with platform issues.
