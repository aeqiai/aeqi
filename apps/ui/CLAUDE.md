# AEQI Web Dashboard

Frontend for the AEQI agent runtime. Vite + React 19 + Zustand + TypeScript.

## Before any UI change

Read [`./.impeccable.md`](./.impeccable.md). It's the design-system
constitution — palette, typefaces, ratio rule, locked toolbar zones,
anti-references. Non-negotiable; supersedes any default behavior the
agent would otherwise drift toward.

For component APIs and pattern recipes, the Storybook docs are the
canonical reference:

- `src/components/ui/Welcome.mdx` — sidebar map, where to look for what.
- `src/components/ui/docs/Foundations*.mdx` — color, typography, spacing,
  radii, motion, principles.
- `src/components/ui/docs/Patterns*.mdx` — composed recipes.
  `PatternsToolbar.mdx` is the canonical search / sort / filter / view /
  - New layout, including the chrome / paper / ink tier rule.

When a need doesn't map to an existing primitive, propose a new one
before writing a page-level class. Grep before adding any new style or
component — the codebase has more primitives than the file structure
suggests.

## MVP charter — read this before touching any UI

**The goal is to ship the MVP.** Every UI decision must be measured against
"does this get us closer to a usable product the user can demo?" If a change
isn't on that path, don't make it.

### Hard rules

1. **Use the design system. Don't invent.**
   - Tokens live in `src/styles/primitives.css` (`--color-*`, `--text-*`,
     `--bg-*`, `--accent`, `--border*`, `--input-*`, `--space-*`,
     `--radius-*`, `--font-*`). Use them. Gotcha: background aliases use
     `--bg-subtle` / `--bg-row` / `--bg-surface` (not `--color-bg-*` —
     that namespace doesn't exist). When in doubt, grep primitives.css.
   - Reusable components live in `src/components/ui/` (Button, IconButton,
     Input, Select, Menu, Popover, Spinner, Badge, EmptyState, Tooltip).
     Use them. Extend them via variants — don't fork.
   - Surface-level patterns (`.ideas-toolbar-btn`, `.ideas-tag-chip`,
     `.ideas-list-head`, `.scope-dot`) are canonical for their surface and
     should be reused, not re-skinned.

2. **No custom design.**
   - No bespoke colors. No new font sizes outside the scale. No new spacing
     values outside the 4pt grid. No new border radii. No new shadow values.
   - If a token is missing, add it to `primitives.css` (or
     `packages/tokens/src/tokens.css`) once, then reuse it. Don't sprinkle
     literal values through component CSS.
   - No "I'll just make it work for this one screen" CSS overrides. If a
     pattern doesn't fit, surface that as feedback before forking.

3. **Reuse over rewrite.**
   - Before adding a new component, search `src/components/` for one that
     fits. If something close exists, extend it (add a prop or variant).
   - Before writing fresh CSS, search `src/styles/` for the pattern. If a
     class already does this, use it.
   - Buttons in toolbars use `.ideas-toolbar-btn` (or its design-system
     successor). Pills use `border-radius: 999px`. Icons are 13px stroked
     SVGs. There is one canonical answer for each — find it.

4. **No flourish without function.**
   - No animations beyond `transition: 0.12s ease` on hover/focus states.
     No bounce, no elastic, no scroll-driven, no decorative motion.
   - No editorial flourishes (eyebrow micro-caps, marquee headings, hero
     typography) on internal app surfaces. Reserve those for marketing.
   - No icons that don't disambiguate an action.

5. **Drop dead code on the same commit.**
   - When a class/component/file is no longer used, remove it. Don't leave
     "// removed" comments. Don't leave dead CSS rules. CLAUDE.md says
     "no dead code" — enforce it on every ship.

### Anti-patterns to refuse

- **Border-left coloured stripe** on cards/rows/alerts (memory has rejected
  this twice; impeccable hard-bans it).
- **Gradient text** (`background-clip: text` + gradient).
- **Glassmorphism** (backdrop-blur on resting surfaces).
- **Rounded-square buttons.** Pills (`999px`) for labeled, circles
  (`999px`) for icon-only. Nothing in between.
- **Verbose state labels** ("Edited — unsaved", "Saving…", "Saved").
  Communicate state through presence (the Save button appears when there's
  work) or a single colored dot, not prose.
- **Custom scope/status chips per surface.** Use `.scope-chip` /
  `.scope-dot` / the existing primitives.
- **JetBrains Mono.** Removed from the design system; use `var(--font-mono)`
  which now resolves to the system mono stack.
- **Initial-letter brand accents** on tabs/nav (`a` `e` `q` `i` letters in
  Zen Dots — rejected twice).
- **"AEQI" in prose.** "aeqi" is always lowercase outside code identifiers.

### When in doubt

Ask. The user prefers a 30-second clarifying question over a 30-minute
custom-design detour. If something feels like it needs a one-off treatment,
that's almost always a sign the existing pattern needs a small extension —
not a fork.

The user is shipping a product, not commissioning a design system. Move
fast, reuse hard, and don't make them puke.

### Nav structure default — page-internal sub-rail, not global sidebar

When the user describes a vertical sub-nav for a top-level destination
("Company has Overview as the first option," "Economy needs Discovery
and Blueprints"), the default answer is a **page-internal `PageRail`**
inside that destination's page (mirror `EconomyPage.tsx`,
`BlueprintDetailPage.tsx`, `ProfilePage.tsx`), NOT new entries in the
global `LeftSidebar`. The global sidebar is reserved for top-level
destinations only — Inbox, Company, Operate, Control, Economy.

Cost of guessing wrong (2026-04-29): six sub-tabs got promoted to root
sidebar items, the user rejected the shape, full restructure required.
Cheaper rule: ask once if it's not obvious which level a nav item lives at.

### UI bug-report triage — read source before blaming cache

When the user reports the UI looking wrong, read the relevant source
file FIRST and confirm the deployed shape matches what they want, BEFORE
suggesting a hard-refresh / cache-bust. "Browser cache" is a hypothesis,
not a default. If the deployed shape is itself wrong, hard-refreshing
just shows them the same wrong shape faster — which is the opposite of
helpful.

### User-facing copy & pricing — single source of truth

Before quoting any plan name, price, token allowance, or feature bullet
in UI code, READ `apps/ui/src/lib/pricing.ts`. Don't fabricate
"Solo / Studio / Agency" / "Pro / Team" / etc. — the canonical PLANS
are `Free` / `Launch ($39 · 8M tokens)` / `Scale ($119 · 32M tokens)`,
exported as `FREE` / `PLANS` / `BACKEND_PLAN_ID`. The same file is
mirrored at `aeqi-landing/src/pricing.ts` (file header notes the
mirror). When prices change, both files update together.

Cost of guessing wrong (2026-04-30): an entire setup page got built
with hallucinated tiers, deployed to prod, and had to be rewritten in
a follow-up commit. Same rule applies to user-visible vocabulary
(blueprint vs template, role vs position, company vs root agent) —
grep before introducing a new term.

### Network / socket / proxy regressions — run the audit

`npm run verify` cannot catch a query-param mismatch on a WebSocket URL,
a fetch-ordering bug that fires `X-Entity required` calls before the
entity is known, or a wagmi config that crashes RainbowKit at module
init. These only show up when the deployed app boots in a real browser.

When the user reports "weird 400s" / "something feels off in prod" / WS
not connecting, OR after any change that touches `apps/ui/src/api/`,
`apps/ui/src/hooks/use*Socket*`, daemon-store ordering, or the platform
proxy contract — run the headless audit. Recipe:
[`scripts/AUDIT.md`](../../scripts/AUDIT.md). One command,
authed-as-user, captures network + console + WS state across every
route plus a refresh-reconnect probe per route.

The two recurring contract bugs the audit catches:

- WS query param: the platform proxy reads `entity` or `entity_id`
  from the WS URL query, not `root`. Both `useDaemonSocket.ts` and
  `useWebSocketChat.ts` send to the proxy boundary — keep them in
  lockstep.
- Daemon `fetchAll` ordering: `fetchEntities` is user-scoped (no
  X-Entity required); the rest are entity-scoped. Run entities first
  and gate the rest on `getScopedEntity()` returning non-empty.
- `s.agents` is a directory union, not a per-entity list.
  `listAgentDirectory` synthesises one root-agent row per company the
  user owns (from `/api/entities`) and unions with the active scope's
  `/api/agents` subtree. Any entity-scoped _list_ surface MUST filter
  by `a.entity_id === entityId` (and usually `|| a.id === entityId` to
  keep the entity's own root row), or it renders the sidebar entity
  switcher. Map-style id→name lookups are safe; rendering the array
  raw is not. Cost of guessing wrong (2026-04-30):
  `/c/:entityId/agents` shipped without the filter and showed every
  company on the page.

## Stack

- **Build:** Vite 6, React 19, TypeScript 5
- **State:** Zustand (auth store, daemon store, chat store, ui store)
- **Routing:** React Router v7
- **Styling:** CSS custom properties in `src/styles/primitives.css` (graphite + ink v5.1 palette, Inter + Exo 2 + Zen Dots; JetBrains Mono retired 2026-04-27, `--font-mono` falls back to the system mono stack)
- **API:** `src/lib/api.ts` -- fetch wrapper with JWT auth, auto-redirect on 401

## Layout

Two-column layout: AgentTree sidebar (left, 240px) + content area with floating nav bar (search via Cmd+K, page links). Content renders in `<Outlet />` inside the content panel.

## Primitives

The UI is built around four primitives:

- **Agent** -- autonomous entities with parent-child hierarchy
- **Quest** -- work items (formerly "tasks")
- **Event** -- audit/activity stream
- **Idea** -- agent knowledge, identity, instructions, memories

## Pages

| Page         | Path                                              | What it does                                                                                                                                       |
| ------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company Home | `/:companyId`                                     | Company-scoped inbox and execution surface                                                                                                         |
| Quests       | `/:companyId/quests`                              | Quest list, filter by status/agent                                                                                                                 |
| Sessions     | `/:companyId/agents/:agentId/sessions/:sessionId` | Split pane: session list + transcript. WebSocket chat with one agent. Legacy `/sessions/:sessionId` redirects to this shape via `SessionRedirect`. |
| Events       | `/:companyId/events`                              | Event stream (audit trail)                                                                                                                         |
| Ideas        | `/:companyId/ideas`                               | Company knowledge/idea search                                                                                                                      |
| Agents       | `/:companyId/agents`                              | Company org chart and agent hierarchy                                                                                                              |
| Account      | `/account`                                        | User profile and account settings                                                                                                                  |
| Login        | `/login`                                          | JWT authentication                                                                                                                                 |

Legacy paths redirect to their current equivalents.

## State Stores

| Store  | File                  | Purpose                                |
| ------ | --------------------- | -------------------------------------- |
| auth   | `src/store/auth.ts`   | JWT token, login/logout                |
| daemon | `src/store/daemon.ts` | Agents, quests, events, cost, status   |
| chat   | `src/store/chat.ts`   | Selected agent, per-agent thread state |
| ui     | `src/store/ui.ts`     | UI preferences (sidebar, layout)       |

## Deployment

```bash
cd apps/ui
npm run build
```

- Build outputs to `apps/ui/dist`
- Set `[web].ui_dist_dir` in `aeqi.toml`
- Run `aeqi web start`

## Dev

```bash
npm run dev  # Vite dev server on :5173, proxies /api to :8400
```

## Verify

```bash
npm run verify
```

One command runs the full gauntlet: tsc + prettier + eslint + vitest +
hygiene-check + vite build. Every Storybook / primitive / wave worker
ends with `npm run verify` — must pass clean before shipping.

## Worktree workflow (canonical)

For any non-trivial UI work, cut a worktree off main. Never edit main
directly. The full ritual:

**Cut + symlink:**

```bash
git worktree add /home/claudedev/aeqi-<topic> -b design/<topic> main
ln -sfn /home/claudedev/aeqi/apps/ui/node_modules \
        /home/claudedev/aeqi-<topic>/apps/ui/node_modules
```

**CRITICAL: The symlink MUST exist before any npm command.** The worktree's node_modules points to the parent's to share the `node_modules/.bin/` cache and avoid redundant installs across branches. Without it:
- `npm run verify` fails with `tsc: not found`, `prettier: not found`, etc. even if the parent's node_modules is healthy
- `npm install` in the worktree creates a fresh `node_modules` tree instead of using the parent's, doubling build time and contending with parallel sibling worktrees (ENOTEMPTY errors during deploy)
- Any npm command that expects dev tools will fail

**Always create the symlink immediately after `git worktree add`.** If you skip this step and accidentally run npm, manually create the symlink afterward — it doesn't undo the partial tree, but at least subsequent commands will use the parent's cache going forward.

**Inside the worktree, always use `git -C` for git ops.** The shell cwd
does NOT persist reliably between separate Bash tool calls — relying
on it once cost ~10 min recovering from a commit that landed on the
wrong branch.

```bash
git -C /home/claudedev/aeqi-<topic> add -A
git -C /home/claudedev/aeqi-<topic> commit -m "..."
git -C /home/claudedev/aeqi-<topic> push -u origin design/<topic>
```

**Read at the worktree path before editing in the worktree.** The Edit
tool tracks file Reads per absolute path. Reading
`/home/claudedev/aeqi/apps/ui/src/foo.tsx` does NOT satisfy a
subsequent edit at `/home/claudedev/aeqi-<topic>/apps/ui/src/foo.tsx`
— it errors with "File has not been read yet." Always Read at the
exact path you intend to Edit.

**Confirm symlink exists immediately after worktree creation.** Before
running any npm command, verify the symlink was created:

```bash
ls -la /home/claudedev/aeqi-<topic>/apps/ui/node_modules
# Output should be: lrwxrwxrwx ... -> /home/claudedev/aeqi/apps/ui/node_modules
```

If the symlink doesn't exist, the worktree's node_modules is either a partial
real tree (created by an errant npm command) or genuinely missing. Recreate it:

```bash
rm /home/claudedev/aeqi-<topic>/apps/ui/node_modules 2>/dev/null
ln -s /home/claudedev/aeqi/apps/ui/node_modules /home/claudedev/aeqi-<topic>/apps/ui/node_modules
```

**Pre-verify: ensure parent node_modules/.bin/ is healthy.** Before running
verify in the worktree, check that the parent's `.bin/` has all required
binaries (tsc, prettier, eslint, vite). If parallel sibling worktrees or a
prior failed npm install left the parent tree partial:

```bash
if [ ! -f "/home/claudedev/aeqi/apps/ui/node_modules/.bin/tsc" ]; then
  echo "Parent .bin/ is broken — rebuilding"
  cd /home/claudedev/aeqi/apps/ui && npm rebuild
  # If npm rebuild fails with "tshy: not found", fall through to npm install
  if [ ! -f "/home/claudedev/aeqi/apps/ui/node_modules/.bin/tsc" ]; then
    npm install --silent
  fi
fi
```

If the parent's node_modules is missing large package directories entirely
(symptom: `Cannot find module 'typescript'` at the node level, not a .bin/
symlink), skip npm rebuild and go straight to `npm install`. This is rare but
surfaces after an aggressive `rm -rf node_modules` cleanup in a prior session.

**TypeScript binary present but lib files missing.** A third failure mode: `.bin/tsc`
exists and runs, but `lib/tsc.js` reports `Cannot find module '../lib/lib.dom.d.ts'`.
This happens when an interrupted `npm install` completed the bin symlinks but left
package internals partial. Run `npm install` again from the parent — a second pass
fills in the missing package contents. Cost (2026-05-05): confused `tsc` invocation
with missing bins when the real issue was incomplete TypeScript package innards.

**`keccak` / native-addon `spawn ELOOP` during `npm install`.** When the
parent's node_modules is absent and you run `npm install` while a worktree
symlink points at the same target, `npm` hits `spawn ELOOP` on native
addon install scripts (`keccak@3.0.4`, `bufferutil`, `utf-8-validate`).
The error is cosmetic: TypeScript and Vite binaries still land in `.bin/`
despite the error. After the error exits:

```bash
ls /home/claudedev/aeqi/apps/ui/node_modules/.bin/tsc   # should exist
ls /home/claudedev/aeqi/apps/ui/node_modules/.bin/vite  # should exist
```

If those are present, the install succeeded enough to verify. The ELOOP is
from keccak/bufferutil native build scripts tracing through the symlink —
it does NOT affect TypeScript/Vite/Prettier. If `.bin/tsc` is missing even
after the ELOOP, remove the worktree symlink first, then run `npm install`
from the parent directly, then restore the symlink.

**TypeScript `Cannot find module '../lib/tsc.js'` after partial install.**
If `tsc --noEmit` throws `Cannot find module '../lib/tsc.js'`, the
TypeScript package itself is present in `.bin/` but its lib files are
missing (interrupted install). Run `npm install` once more from the parent
— a second pass fills in the missing files. Do NOT delete the binary and
reinstall from scratch; that triggers the ELOOP loop again.

Recovery sequence (fastest path):
```bash
# 1. Remove worktree symlink to break ELOOP
rm /home/claudedev/aeqi-<topic>/apps/ui/node_modules
# 2. Install from parent (ELOOP may fire on keccak — that's fine)
cd /home/claudedev/aeqi/apps/ui && npm install
# 3. Check key binaries
ls node_modules/.bin/tsc node_modules/.bin/vite
# 4. If tsc still missing: run install a second time (fills incomplete TS pkg)
npm install
# 5. Restore worktree symlink
ln -s /home/claudedev/aeqi/apps/ui/node_modules \
      /home/claudedev/aeqi-<topic>/apps/ui/node_modules
```

**ELOOP when you can't remove the symlink (sibling worktrees are not yours).**
When OTHER agents' worktrees symlink to the parent's `node_modules` and you
can't remove their symlinks, `npm install` in the parent still hits ELOOP on
native addon builds (keccak/bufferutil). In this case the existing recipe
doesn't apply. Use `--ignore-scripts` instead:

```bash
cd /home/claudedev/aeqi/apps/ui
rm -rf node_modules           # or skip if already absent
npm install --ignore-scripts  # skips keccak/bufferutil native builds — OK for vite
ls node_modules/.bin/vite     # should exist
```

`--ignore-scripts` skips ALL postinstall/build scripts. The native addons
(keccak, bufferutil, utf-8-validate) are WalletConnect internals — they don't
affect vite build, tsc, or prettier. The UI builds and ships correctly without
them. Cost (2026-05-05): 3 deploy retries on governance ship cycle when 4
sibling agents were running simultaneously.

**Verify before merging:**

```bash
cd /home/claudedev/aeqi-<topic>/apps/ui && npm run verify
```

If `npm run verify` fails with ELOOP or other npm-environment errors (NOT code
errors), but the changes are CSS-only, a manual audit is acceptable fallback:

```bash
# For CSS-only diffs: check brace balance, var(--radius-*) usage, etc.
# Do NOT use this fallback for .ts/.tsx/.mdx changes — those need tsc + eslint
for f in src/styles/*.css; do
  OPEN=$(grep -o '{' "$f" | wc -l); CLOSE=$(grep -o '}' "$f" | wc -l)
  [ $OPEN -eq $CLOSE ] && echo "✓ $f" || echo "✗ $f: braces unbalanced"
done
```

This is a WORKAROUND only for environment issues (broken parent node_modules,
symlink loops), NOT a substitute for failing tooling. If tsc/prettier/eslint
fail due to code errors, fix the code — do not audit by hand.

**Merge back to main (worktree-safe):**

```bash
cd /home/claudedev/aeqi
git fetch origin
git status --short        # MUST be clean before ff. If api.ts shows
                          # uncommitted drift, that's in-flight parallel
                          # refactor work — stash it specifically:
                          # git stash push -- apps/ui/src/lib/api.ts
git merge --ff-only origin/design/<topic>
# If ff fails (main diverged):
git cherry-pick <sha-from-the-worktree-branch>
git push origin main
# git stash pop  (if stashed earlier)
```

**Cleanup, in THIS order:**

```bash
rm /home/claudedev/aeqi-<topic>/apps/ui/node_modules    # symlink ONLY
git worktree remove /home/claudedev/aeqi-<topic> --force
git branch -D design/<topic>
git push origin --delete design/<topic>
```

**If `vite: not found` after cleanup:** the parent's node_modules/.bin/
got damaged by the worktree teardown. Recover with a clean nuke +
reinstall:

```bash
rm -rf /home/claudedev/aeqi/apps/ui/node_modules
cd /home/claudedev/aeqi/apps/ui && npm install
```

`rm -rf` succeeds where `find -delete` does not. The earlier
`find -delete + npm install` recipe was unreliable: find returns
ENOTEMPTY on locked nested deps (`@reown/appkit`, `porto`,
`walletconnect`, `viem`, …), npm install then layers into a partial
tree, and the .bin/ symlinks come back broken. `rm -rf` removes the
whole tree atomically and npm rebuilds clean — same wall-clock cost,
total reliability.

**Caveat — sibling worktree symlinks active.** If another worktree's
`apps/ui/node_modules` still symlinks to this one (parallel subagent
mid-flight), `rm -rf` errors on the same viem / walletconnect nested
dirs because the symlink target keeps file handles open. Plain
`npm install` (no rm) repairs `.bin/` in place — slower than a clean
rebuild but safe for live sibling worktrees. Use this when WS-A and
WS-B ship back-to-back and one finishes before the other releases its
symlink.

**Plain `npm install` is not always sufficient.** It can leave a
half-installed tree where `.bin/<tool>` exists but the underlying
package directory is partial. Symptoms: `prettier: Permission denied`
(the .cjs entry point isn't `chmod +x`), `Error [ERR_MODULE_NOT_FOUND]:
node_modules/rollup/parseAst` (vite trying to load a missing rollup
file). When `npm install` succeeds but verify or build fails on
permission / missing-module errors, fall through to the full `rm -rf
node_modules && npm install` recipe — it's the only reliable cure
once the tree is partial. Caveat above still applies: only fall through
when no sibling worktrees hold a live symlink.

**node_modules can be a partial post-cleanup tree (packages absent, not just `.bin/` broken).** If a prior session cleaned node_modules aggressively, core packages like `typescript` may be missing entirely — not just their `.bin/` symlinks. Symptom: `Cannot find module '/home/claudedev/aeqi/apps/ui/node_modules/typescript/bin/tsc'` at the `node` call level (the package directory doesn't exist, not just the symlink). The parent's `ls node_modules | grep typescript` returns nothing. Fix: `cd /home/claudedev/aeqi/apps/ui && npm install`. Same recipe as the `.bin/`-broken case; the diagnostic difference is `ls node_modules/typescript` failing vs `.bin/tsc` being a dead symlink. Cost (2026-05-05): one `npm install` pass before verify could run.

**`.bin/` disappears mid-session during parallel autonomous pushes.**
When two subagents run simultaneously and one triggers a deploy script
that runs `npm install` (the `ui-deploy.sh` vite-recovery path), the
install can wipe `.bin/` while the other agent's `npm run verify` is
mid-flight — resulting in `tsc: not found` even though `.bin/tsc`
existed seconds earlier. The fix: **run tools via `node` directly**
rather than relying on `.bin/` symlinks, which are volatile:

```bash
node /home/claudedev/aeqi/apps/ui/node_modules/typescript/bin/tsc --noEmit
node /home/claudedev/aeqi/apps/ui/node_modules/prettier/bin/prettier.cjs --check "src/**/*.{ts,tsx,css,mdx}"
node /home/claudedev/aeqi/apps/ui/node_modules/eslint/bin/eslint.js src/
node /home/claudedev/aeqi/apps/ui/node_modules/vitest/vitest.mjs run
./node_modules/.bin/vite build
node scripts/hygiene-check.mjs
```

This is the parallel-subagent fallback for the full verify gauntlet.
The `PATH=".../node_modules/.bin:$PATH" npm run verify` pattern does
NOT work in this project — npm spawns a fresh shell that resets PATH,
so the binary injections never reach the subprocess. The `node` form
is the only reliable approach when `.bin/` is contested.

**vite is the exception: use `./node_modules/.bin/vite`, NOT the absolute
`node .../vite/bin/vite.js` form.** Vite resolves its internal plugins
relative to CWD, not its own location — calling it via absolute `node`
path from a worktree directory (which has no real node_modules, only a
symlink) causes `Cannot find module '@vitejs/...'` or `lit-element`
resolution failures. The `.bin/` symlink follows to the parent's vite
and runs with the correct base. Cost (2026-05-05): one failed build
pass before switching to `./node_modules/.bin/vite build`.

**UI-only deploy (no Rust changed):**

```bash
/home/claudedev/aeqi/scripts/ui-deploy.sh
```

The script handles vite recovery + build + rsync + post-build assertions.
Success marker: it emits `rsync complete` followed by `deployed: <timestamp>`
on the last line. When monitoring the script in background mode, grep for
`rsync complete` — NOT for `deployed:` (that line is for human reading only
and the timestamp makes it non-constant). Skip `./scripts/deploy.sh` — that's
for full runtime+platform rebuilds.

## /ship — automate the entire ritual

The user has explicitly delegated the merge / push / deploy / cleanup
sequence above to the `/ship` skill. From a worktree, invoking `/ship`
runs all the steps end-to-end without further confirmation, then
auto-invokes `/evolve` to capture any new friction patterns into the
relevant CLAUDE.md / SKILL.md.

If you find yourself running `git merge --ff-only` or `rsync … ui-dist/`
by hand: stop, invoke `/ship` instead.

## Known drift

`apps/ui/src/lib/api.ts` may show uncommitted local edits that aren't
yours — typically in-flight parallel refactor work. Specifically: the
`spawnAgent` `template?: string` line gets removed/restored by a
parallel campaign. Stash that file specifically before any ff-merge:

```bash
git stash push -- apps/ui/src/lib/api.ts
# ... merge ...
git stash pop
```

Don't try to commit or revert the drift — it's in-flight work.

**When a subagent edits main directly and /ship is invoked later:**
If a subagent (e.g. autonomous audit) modifies main's working tree directly
(not in a worktree), and a later task invokes `/ship` from a worktree branch,
the ff-merge will abort because main has uncommitted changes. Recipe:
(a) detect which files are modified on main (`git status --short`), (b) stash
specifically those files (not blanket `git stash`), (c) attempt ff-merge, and
(d) pop the stash by message (`git stash pop $(git stash list | grep -F 'ship-stash')`).
The per-repo drift list in /ship tracks known files; add new ones there. Cost
(2026-05-05): one stash-dance cycle when margin-normalize edits landed in main
before worktree was cut.

## Cross-package code (`packages/web-shared`, `packages/tokens`)

When apps/ui imports from a sibling package (`@aeqi/web-shared/*`,
`@aeqi/tokens`), the package's own source files import peer-deps
(`react`, `react-dom`, `react-router-dom`) directly. Without
intervention, Rollup walks up from the package dir looking for
`node_modules` and finds nothing — `Rollup failed to resolve import "react-router-dom"`.

**Pin peer-deps via vite alias + tsconfig paths to apps/ui's
`node_modules`** (already wired in `vite.config.ts` + `tsconfig.json`).
Don't reach for symlinks (`packages/<pkg>/node_modules → apps/ui/node_modules`)
— they were the first attempted fix and they're per-checkout fragile,
break across worktrees, and confuse npm.

If you add a new shared package:

1. tsconfig.json — add `paths` for `@aeqi/<name>/*`
2. vite.config.ts — add matching `resolve.alias` entry
3. **vitest.config.ts** — mirror the same `resolve.alias` entry. Vitest
   does NOT inherit vite.config.ts; the smoke test will fail with
   `Failed to resolve import "@aeqi/<name>"` until you do.
4. If the new package itself imports any peer-dep not already in the
   `react / react-dom / react-router-dom` set, pin THAT one too in all
   three files (vite.config.ts, tsconfig.json, vitest.config.ts).

## Running tools from a worktree without npm-install

A worktree's `apps/ui/node_modules` is a symlink to the parent's. The
parent has `.bin/` populated. But `npm run <script>` resolves binaries
relative to its CWD's package.json — and inside a fresh worktree it
sometimes can't see the parent's `.bin/`. Two recoveries:

```bash
# Option A — invoke via npx (slower; downloads if missing)
npx tsc --noEmit

# Option B — prepend the parent's .bin to PATH (fast, exact)
PATH="/home/claudedev/aeqi/apps/ui/node_modules/.bin:$PATH" npm run verify
```

Option B is preferred for `npm run verify` since the script chains many
binaries and `npx` per-call would be slow.

## Phantom TS errors in a worktree → clear `.tsbuildinfo`

`tsc --noEmit` is incremental: it caches a per-checkout
`apps/ui/.tsbuildinfo` with hashes of every file it has compiled. When
the same `node_modules` (parent's, via the symlink) gets reinstalled
mid-session, the cache desyncs and tsc reports errors that don't
reproduce on a fresh clone — recently `error TS2590: Expression
produces a union type that is too complex` on `Inline.tsx` even though
the file was unchanged.

Recovery:

```bash
rm /home/claudedev/aeqi-<topic>/apps/ui/.tsbuildinfo
rm /home/claudedev/aeqi/apps/ui/.tsbuildinfo  # parent too if it exists
```

Then re-run verify. Don't chase the reported error — it's stale state,
not a real type problem. The cost of guessing wrong (~2 min on
2026-04-30): re-reading polymorphic-`as` ref typing trying to find a
bug that wasn't there.

## Banner uses `kind`, not `variant`

The `Banner` component accepts a `kind` prop (`BannerKind =
"success" | "error" | "warning" | "info"`), NOT `variant`. Passing
`variant="success"` silently renders the wrong (or unstyled) banner
in some build modes and fails tsc in strict mode with "Property
'variant' does not exist on type 'BannerProps'". Always use `kind`:

```tsx
<Banner kind="success">...</Banner>
<Banner kind="error">...</Banner>
<Banner kind="info">...</Banner>
```

Cost (2026-05-04): two tsc edit passes when writing `AAEnrollmentPage`.

## `api` is an object — use `apiRequest` for raw HTTP

`api` from `@/lib/api.ts` is a plain object with named methods
(`api.getAgents()`, `api.getIdeas()`, etc.) — it is NOT callable.
Calling `api("/api/foo", { method: "POST", … })` fails at runtime and
tsc with "This expression is not callable."

For raw fetch-style calls (method + headers + body), use `apiRequest`
from `@/api/client`:

```tsx
import { apiRequest } from "@/api/client";

await apiRequest("/api/account/enroll-passkey", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

`apiRequest` is the lower-level fetch wrapper that `api.*` methods
build on. Use it when you need a one-off POST/PUT/DELETE that doesn't
warrant a named method on the `api` object. Cost (2026-05-04): one
tsc edit pass when writing `AAEnrollmentPage`.
