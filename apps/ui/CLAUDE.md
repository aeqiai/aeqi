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

| Page         | Path                              | What it does                                                      |
| ------------ | --------------------------------- | ----------------------------------------------------------------- |
| Company Home | `/:companyId`                     | Company-scoped inbox and execution surface                        |
| Quests       | `/:companyId/quests`              | Quest list, filter by status/agent                                |
| Sessions     | `/:companyId/sessions/:sessionId` | Split pane: session list + transcript. WebSocket chat with agents |
| Events       | `/:companyId/events`              | Event stream (audit trail)                                        |
| Ideas        | `/:companyId/ideas`               | Company knowledge/idea search                                     |
| Agents       | `/:companyId/agents`              | Company org chart and agent hierarchy                             |
| Account      | `/account`                        | User profile and account settings                                 |
| Login        | `/login`                          | JWT authentication                                                |

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

**Inside the worktree, always use `git -C` for git ops.** The shell cwd
does NOT persist reliably between separate Bash tool calls — relying
on it once cost ~10 min recovering from a commit that landed on the
wrong branch.

```bash
git -C /home/claudedev/aeqi-<topic> add -A
git -C /home/claudedev/aeqi-<topic> commit -m "..."
git -C /home/claudedev/aeqi-<topic> push -u origin design/<topic>
```

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

**UI-only deploy (no Rust changed):**

```bash
cd /home/claudedev/aeqi/apps/ui
./node_modules/.bin/vite build
rsync -a --delete dist/ /home/claudedev/aeqi-platform/ui-dist/
```

Skip `./scripts/deploy.sh` — that's for full runtime+platform rebuilds.

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
