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

**`cargo fmt -p <crate>` picks up pre-existing intra-crate drift.** Running
`cargo fmt -p aeqi-indexer` will reformat ALL files in the crate, including
ones you didn't author. Before committing, run `cargo fmt -p <crate> -- --check`
first to see the full scope — if it flags files you didn't touch, decide
consciously whether to include that whitespace churn. Including it is fine
(clean slate), but it inflates the diff and makes code review harder. Cost
(2026-05-05): `chain.rs` + `decode.rs` + `main.rs` in aeqi-indexer each
reformatted in the governance-queries commit despite being untouched by the
feature work.

**`.observations/` lives in the main working tree, not worktrees.** The
`.observations/` directory is only present in `/home/claudedev/aeqi/` (the
main checkout). Worktrees don't have their own copy. When autonomous
subagents need to write to the state file, use the absolute path
`/home/claudedev/aeqi/.observations/autonomous-push-state.md` — not a
relative path from the worktree root.

**Don't `cp` worktree files to main before the branch merges.** If a script
or file is created inside a worktree and copied to the main checkout's
working tree (e.g. `cp worktree/scripts/foo.mjs aeqi/scripts/foo.mjs`), it
becomes an untracked file on main. When the worktree's branch later merges
via `git merge --ff-only`, Git aborts with `"The following untracked working
tree files would be overwritten by merge"`. Fix: `rm` the collision file on
main before merging. Prevention: only place new files inside the worktree —
the merge brings them to main. Copying to main is always a redundant step
that creates an untracked-collision footgun. Cost (2026-05-05): one manual
`rm` + retry on the v10 walk script ship.

**The reverse is also a footgun: don't edit on main then `cp` to the worktree.**
Editing a file on main (e.g. `CLAUDE.md`) then copying it into the worktree
(`cp aeqi/apps/ui/CLAUDE.md aeqi-topic/apps/ui/CLAUDE.md`) leaves the file
dirty on main. When `git merge --ff-only` runs, Git aborts with "Your local
changes to the following files would be overwritten by merge." Fix: `git
checkout -- <file>` on main to revert (the worktree branch has the right
version and will bring it in via ff-merge). Prevention: always edit files
INSIDE the worktree path from the start. Cost (2026-05-05): one `git
checkout --` + merge retry on the evolve doc ship.

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

**UX walk — `AEQI_UPPERCASE_STRUCTURAL` fires false positives on session sidebar.**
The structural AEQI detector queries `nav, header, ASIDE, [class*=sidebar]` to
catch uppercase "AEQI" in product copy. But the session-rail ASIDE on agent-overview
and agent-sessions contains user-typed session titles — the selector scope spans
the full rail, so a title like "help me improve aeqi tiself" causes the detector
to fire 7x on that route even though `AEQI_UPPERCASE_TOTAL` shows only 1. Fix in
the next walk-script version: exclude elements matched by `[class*=session-rail],
[class*=sessions-rail], [class*=sessions-sidebar]` from the structural query,
or walk only elements whose `dataset.kind !== "user-content"`. Fixed in v8 script.
Until fixed, treat `AEQI_UPPERCASE_STRUCTURAL` fires on agent-overview/sessions as
false positives when `AEQI_UPPERCASE_TOTAL` ≤ 1 on those routes.

**UX walk — role card detector: `innerText === "Director"` misses sibling UUID node.**
A detector that finds the Director role card by matching an element with
`innerText.trim() === "Director"` will capture only the label element, not its
sibling UUID text node. The UUID appears as a separate text node in the card's
parent — `card.innerText` includes it but only when you climb up to a sufficiently
wide ancestor. Pattern: use `el.closest("[class]").innerText` (go to the nearest
classed ancestor) AND cross-check against the page's raw `bodyTextSample` for UUID
regex matches near the "Director" string. `bodyTextSample` is ground truth;
`evaluate()` card-element text is narrow by default. Cost (2026-05-05): v8 detector
reported `DIRECTOR_OCCUPANT_RESOLVED` (false positive) while body text confirmed
`"Director\nbbbd909d-02ab-4ea6-9da2-98d10d4aeba8"` was still present.
Canonical fix (v9): skip DOM traversal entirely for presence checks; instead scan
`bodyTextSample` directly — check if the known UUID appears within N characters
of the role name. This is immune to shadow-DOM, text-node splitting, and React
rendering order. See `scripts/ux-v9-walk.mjs` check `v9-B` for the reference
implementation.

**UX walk — wallet/stub probe returns 400 (X-Entity) when route not deployed.**
Out-of-band API probes in the walk script expect HTTP 501 (stub deployed) or
401 (route unregistered, falls to authed catch-all). A third state exists: when the
route IS registered in source but the live binary predates the commit, the route
falls through to the catch-all proxy — which calls `extract_entity_id()` and returns
400 `{"error":"X-Entity header required"}` when no `X-Entity` header is sent. 401 =
route was never registered at all. 400 = route was registered but binary predates
the commit. Walk probe logic must handle all three cases explicitly. Cost
(2026-05-05): v10 `WALLET_UPGRADE_UNEXPECTED` fired on 400 instead of the cleaner
`WALLET_UPGRADE_STILL_401` path; required binary stat + service-start-time comparison
to diagnose. Pattern: `stat <binary> | grep Modify` vs `git log -1 --format=%ci
<commit>` tells you unambiguously whether a given commit is deployed.

**UI fix scoping — list view vs detail view are different components.**
When fixing a data-display bug (e.g. "UUID shown instead of display name"), always
identify BOTH the list page component AND the detail page component. In the roles
subsystem: list is `EntityRolesTab.tsx` → `RolesCards.tsx` + `RolesList.tsx`;
detail is `RoleDetailPage.tsx`. A fix to `RoleDetailPage.tsx` does not affect what
renders on the `/roles` list route. Rule: after any component-level fix, grep for
all render sites of the affected field (`occupant_id`, etc.) across `src/components/`
and `src/pages/` and confirm each site is addressed. Cost (2026-05-05): WS-22-C
fixed `RoleDetailPage.tsx`; UUID persisted on the list view through v8 rating.

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

**`#[cfg(test)]` is invisible to integration tests.** Methods or items
gated with `#[cfg(test)]` are compiled only when the *crate itself* is
built in test mode (`cargo test -p <crate> --lib`). Integration tests
under `tests/` compile as a *separate crate* — they have no `#[cfg(test)]`
context and cannot see `#[cfg(test)]`-gated items from the library crate.
The compiler error is `no method named '<fn>' found for struct '<T>'`.
Fix: remove `#[cfg(test)]` from methods that integration tests need
(typically test-helper constructors like `with_base_url`) and document
their test-only intent in a doc comment instead. Cost (2026-05-05): one
edit pass when `DeepInfraProvider::with_base_url` was gated but needed
by `tests/it_chat_completions.rs`.

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

**`aeqi-indexer` deploy recipe.** When `crates/aeqi-indexer/` changes, the
indexer needs its own rebuild + swap — `./scripts/deploy.sh` does NOT touch
it (that script builds the runtime binary, not the indexer). Canonical sequence:

```bash
# 1. Build release binary from the worktree (before /ship merges)
cargo build -p aeqi-indexer --release

# 2. Stop service, swap binary (rm-then-cp avoids "Text file busy")
systemctl --user stop aeqi-indexer-anvil.service
rm /home/claudedev/aeqi/target/release/aeqi-indexer
cp <worktree>/target/release/aeqi-indexer /home/claudedev/aeqi/target/release/aeqi-indexer

# 3. Fix DB permissions if needed (root-owned DB causes "readonly database")
sudo chown claudedev:claudedev /var/lib/aeqi/indexer-anvil.db

# 4. Start and verify
systemctl --user start aeqi-indexer-anvil.service
curl -s http://localhost:8501/healthz   # should return "ok"
```

**`aeqi-indexer` deploy — root-process + DB-permissions trap.** A previous
session that ran `aeqi-indexer-anvil.service` as root leaves two footguns:
(a) the binary at `aeqi/target/release/aeqi-indexer` is root-owned, so `cp`
fails with `Text file busy` even when the service is stopped (the kernel
marks the inode busy while a root process holds it). Fix: `rm` then `cp`
rather than a direct overwrite. (b) `/var/lib/aeqi/indexer-anvil.db` is
root-owned, causing `attempt to write a readonly database` on service start.
Fix: `sudo chown claudedev:claudedev /var/lib/aeqi/indexer-anvil.db`.
(c) A stale root process keeps port 8501 bound after `systemctl --user stop`
returns — user-scoped `pkill`/`fuser -k` can't reach it. Find it with
`ps aux | grep aeqi-indexer | grep -v grep` and `sudo kill <pid>`.
Diagnostic walk: `journalctl --user -u aeqi-indexer-anvil.service -n 10`
shows `Address already in use` → stale root process; `Attempt to write a
readonly database` → DB permissions; `Error: Text file busy` → rm-then-cp.
Cost (2026-05-05): ~5 min across three recovery loops.

**`scripts/deploy.sh` swallows UI build failures.** The `[1/4] Building dashboard UI...` step pipes `npm run build` through `2>&1 | tail -3`, so the pipe's exit code (always 0) wins under `set -e` and a failed vite build looks identical to a successful one in the deploy log ("✓ built in Xs" + "staged UI dist"). The Rust binary still ships, but `apps/ui/dist/` stays stale and the live `index-*.js` hash doesn't move. Verify after every full deploy: `cat /home/claudedev/aeqi/apps/ui/dist/index.html | grep -oE 'index-[A-Za-z0-9_-]+\.js'` MUST match `curl -sL https://app.aeqi.ai/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1`. If they diverge, the UI build silently failed — run `./node_modules/.bin/vite build` directly from `apps/ui/` to surface the real error (most often the viem partial-tree, fixed via `rm -rf apps/ui/node_modules && npm install`).

**`npm install ENOTEMPTY` when sibling worktrees are active.** When running `ui-deploy.sh` while parallel subagents have active worktrees with `apps/ui/node_modules` symlinked to the parent's tree, `npm install` or `npm ci` hits `ENOTEMPTY: directory not empty, rename` on packages like viem, jsdom, walletconnect that keep file handles open. The `ui-deploy.sh` script tries `rm -rf` recovery, but that also fails with ENOTEMPTY when the handles are held by a sibling. Fallback is in-place `npm install` (no rm), which repairs `.bin/` gradually without atomicity — slower but safe. If deploy hangs on npm install and the log shows `ENOTEMPTY` repeatedly: this is expected when >1 worktree is running. Either wait for sibling worktrees to complete, or manually run `cd /home/claudedev/aeqi/apps/ui && npm install --silent` and then retry `ui-deploy.sh`. Cost (2026-05-05): deploy script hung mid-recovery due to parallel cargo build contention holding file handles.

**When parent's `.bin/` is missing/broken mid-ship (rebase context).** The `/ship`
skill's Step 0 pre-flight checks for `~/.bin/tsc` and runs `npm install` if missing.
However, a rebase on main (Step 4) can happen AFTER Step 0 runs, and if main's
node_modules diverged (e.g., a sibling ship ran `npm install` and left the tree
partially corrupted), the worktree's symlink points to a broken parent. Symptom:
post-rebase `tsc --noEmit` fails with "tsc: not found" even though `.bin/tsc` exists.
Cause: `.bin/` has symlinks but underlying packages are partial (interrupted install).
Fix: `cd /home/claudedev/aeqi/apps/ui && npm install --silent` — run it immediately
when `.bin/` symlinks exist but tsc fails to execute. This recovers incomplete
installations in-place without requiring `rm -rf`. Cost (2026-05-05): ~10 min when
this happened mid-rebase; the recovery pattern is now canonical to prevent repeat.

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

## AA bundler — known traps (2026-05-05)

**Use rundler, not silius.** silius has no pre-built Linux binaries — every release is source-only alpha tarballs. Building from source takes ~10 min and is fragile. rundler (Alchemy, `alchemyplatform/rundler`) ships signed x86_64-linux tarballs on every release. It is production-grade, ERC-4337 v0.6+v0.7 capable, and actively maintained. Binary at `/usr/local/bin/rundler`. Service: `aeqi-bundler.service`. Docs: `docs/aa-bundler-deployment.md`.

**`--network dev` hardcodes chain ID 1337 — always use `--chain_spec` for local anvil.** rundler's built-in `dev` network derives from ganache heritage and sets `chainId = 1337`. foundry anvil defaults to `31337`. If you run `--network dev` against a 31337 anvil, the bundler reports the wrong chain ID via `eth_chainId` and will compute incorrect UserOp hashes (chain ID is committed in the hash). There is no error — just silent hash mismatches downstream. Fix: always use `--chain_spec /etc/aeqi-bundler/chain-spec.toml` (field name is `id`, not `chain_id`). The chain spec file is at `/etc/aeqi-bundler/chain-spec.toml`. Smoke-verify after start: `curl -s http://127.0.0.1:3000 -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'` must return `"0x7a69"` (31337).

**EntryPoint v0.7 on dev anvil requires `anvil_setCode`, not CREATE2.** The canonical EP v0.7 address `0x0000000071727De22E5E9d8BAf0edAc6f37da032` is deployed via a specific eth-infinitism deterministic deployer — not the standard Arachnid CREATE2 factory (`0x4e59b...`). On a fresh anvil the address is empty. The EIP-2470 singleton factory approach also fails (raw tx is ganache-specific). Correct approach: deploy EP from `@account-abstraction/contracts@0.7.0` bytecode via `cast send --create` to get the runtime bytecode, then seed the canonical address with `anvil_setCode`. This is handled automatically by `/usr/local/bin/aeqi-bundler-preflight` on every `aeqi-bundler.service` start. **`anvil_setCode` does not persist across anvil restarts** — the preflight re-seeds on service start. If anvil is wiped, re-deploy the reference EP first (see `docs/aa-bundler-deployment.md` troubleshooting section).

**ERC-7677 paymaster JSON-RPC always returns HTTP 200 — errors are in the body.** Unlike REST, JSON-RPC 2.0 uses HTTP 200 for both success and error responses. Error shape: `{"jsonrpc":"2.0","id":N,"error":{"code":-32NNN,"message":"..."}}`. Canonical error codes for `pm_sponsorUserOperation`: `-32500` = sponsorship denied (AA-rejected per ERC-4337); `-32601` = method not found; `-32602` = invalid params; `-32603` = internal error. The bundler / wallet client distinguishes success from failure via presence of `result` vs `error` key, NOT via HTTP status. Service at `127.0.0.1:3001`. Docs: `docs/aa-paymaster-deployment.md`.

**`cargo fmt -p <crate>` must run before `git commit`, not at `/ship` verify time.** The verify gauntlet catches fmt drift at ship time, but that requires a rebase-then-force-push loop. Run `cargo fmt -p aeqi-paymaster` (or whichever crate) as the last step before committing Rust changes. Cost (2026-05-05): one fmt pass + force-push loop during paymaster ship cycle.

**ERC-4337 v0.7 paymasterAndData layout incompatibility — Paymaster.sol reads wrong offsets.** v0.7 inserts two 16-byte gas-limit fields between the address and paymasterData: `[0:20]=addr, [20:36]=paymasterVerifGasLimit, [36:52]=paymasterPostOpGasLimit, [52:]=paymasterData`. v0.6-style Solidity (and the current Paymaster.sol) reads `[20:26]` expecting validUntil — it gets gas-limit bytes instead, causing silent signature mismatch and validation failure. Fix: update Paymaster.sol to read validUntil/validAfter starting at offset 52. Until fixed, use the self-paying path (no paymaster) for v0.7 bundler end-to-end tests. Documented in `docs/aa-userop-lifecycle.md`.

**Paymaster signing digest — no eth_sign prefix; account signing uses eth_sign prefix.** The paymaster signer signs a raw `keccak256` over packed fields (`userOpHash + validUntil + validAfter + paymaster_addr`) with no `\x19Ethereum Signed Message:\n32` wrapper. Paymaster.sol uses `ECDSA.recover(hash, sig)`, not `toEthSignedMessageHash`. By contrast, SimpleAccount validates owner signatures WITH the eth_sign prefix (`\x19Ethereum Signed Message:\n32` + getUserOpHash). Mixing these up produces an ecrecover-wrong-address failure with no on-chain diagnostic. The distinction is: paymaster key = raw keccak, account owner key = eth_sign prefix.

**`bash -c` silently drops arguments when hex string exceeds ~4096 chars.** Embedding large bytecode strings inline in `bash -c "cast send --create 0x<4700 chars>"` fails with no error — the argument is silently truncated or the shell exits 1. Fix: export the hex as an env var and reference it by name: `AEQI_DEPLOY_DATA=$(cat bytecode.hex); bash -c 'cast send --create "$AEQI_DEPLOY_DATA"'`. The `cast_deploy()` helper in `it_paymaster_real_userop.rs` uses this pattern. Cost (2026-05-05): multiple silent failures before root cause identified.

**`cast call` output includes `[1e18]` annotation — parse with `awk '{print $1}'`.** `cast call <addr> "balanceOf(address)(uint256)" <addr>` returns `"1000000000000000000 [1e18]"`. A direct `.parse::<u128>()` fails because of the annotation suffix. Always pipe through `awk '{print $1}'` or split on space before parsing. `cast --to-dec` and `cast --to-base` are alternatives for format conversion without annotation injection.

**AA integration tests that share a deployer key must run single-threaded.** When multiple `#[ignore]` tests in the same test binary all deploy contracts from the same EOA (same nonce source), parallel execution produces nonce conflicts — transactions land out-of-order and tx2/tx3 fail with `nonce too low`. Fix: always run with `--test-threads=1`: `cargo test -p <crate> --test <file> -- --ignored --test-threads=1`. Document this in the test file's module-level doc comment so the next runner doesn't hit it.

**Operator CLI binaries in `src/bin/` are not deployed as services.** `migrate-to-passkey` and similar one-shot operator tools live in `crates/<crate>/src/bin/`. They are built on demand (`cargo build -p <crate> --bin <name> --release`) and run by an operator. No systemd unit, no rsync, no binary swap in deploy.sh. `deploy.sh` exit-1 after a pure `src/bin/` addition is a buffering false-positive if `/api/health` returns 200 — the runtime binary is unaffected.

**Planned stub routes MUST return explicit 501, not be left unregistered.** When a frontend feature is built against a route that isn't implemented yet (e.g. `POST /api/wallet/upgrade-to-passkey`), leaving the route unregistered causes axum's authed catch-all to return 401 "missing authorization header" — which is indistinguishable from a real auth failure. Frontend graceful-degradation logic that checks `if (msg.includes("501") || msg.toLowerCase().includes("not implemented"))` never fires; the user sees a red error banner instead of the intended "processing in background" success state. **Fix**: always register a one-liner 501 stub in aeqi-platform before shipping the frontend that calls it: `post(|| async { (StatusCode::NOT_IMPLEMENTED, Json(json!({"error": "not yet implemented"}))) })`. Cost (2026-05-05): dogfood v3 — passkey upgrade modal showed error banner for every user instead of the graceful success state.

## Platform-level friction (out of our hands)

Tracked separately in `platform-friction.md`. These are paper cuts in the
Claude Code platform itself — the project conventions can route around
them but only the platform team can fix them. Add to that file when a
new pattern emerges; don't pollute project-level docs with platform issues.
