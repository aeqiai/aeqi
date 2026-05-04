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
     `--radius-*`, `--font-*`). Use them.
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

**Critical:** The symlink MUST exist before running `npm run verify`. The worktree's node_modules points to the parent's to share the `node_modules/.bin/` cache and avoid redundant installs across branches. If the symlink is missing, verify fails with `tsc: not found` or similar, even if the parent's node_modules is healthy. Always create it immediately after `git worktree add`.

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

**Verify before merging:**

```bash
cd /home/claudedev/aeqi-<topic>/apps/ui && npm run verify
```

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
node /home/claudedev/aeqi/apps/ui/node_modules/vite/bin/vite.js build
node scripts/hygiene-check.mjs
```

This is the parallel-subagent fallback for the full verify gauntlet.
The `PATH=".../node_modules/.bin:$PATH" npm run verify` pattern does
NOT work in this project — npm spawns a fresh shell that resets PATH,
so the binary injections never reach the subprocess. The `node` form
is the only reliable approach when `.bin/` is contested.

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
