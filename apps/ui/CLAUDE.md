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
- **`window.location.assign` / `window.location.href =` in SPA components.**
  All navigation inside `apps/ui` goes through React Router `navigate` (from
  `useNavigate()`). `window.location.*` bypasses the router, causes a full page
  reload, drops Zustand store state, and breaks scroll restoration. In reusable
  section components that need to trigger navigation (e.g., a catalog list-row
  button inside `BlueprintCategorySection`), pass an `onNavigate: (path: string)
=> void` prop and call it with the target path — the page component wires its
  own `navigate` in. Cost (2026-05-05): caught during blueprint category-section
  implementation; required adding `onNavigate` prop and re-threading `navigate`
  down from `BlueprintsPage`.

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
- `s.agents` is the active scope's real agent list from `/api/agents`.
  `listAgentDirectory` calls only `/api/agents` — it does NOT synthesise
  fake root-agent rows from `/api/entities` (that pattern was the
  superseded agent-Company unification model, removed 2026-05-06).
  Any entity-scoped _list_ surface MUST still filter by
  `a.entity_id === entityId` — the daemon store aggregates agents across
  scopes, so rendering `s.agents` raw shows every agent in the directory,
  not just the current company's. Map-style id→name lookups are safe;
  rendering the array raw is not. Cost of guessing wrong (2026-04-30):
  `/c/:entityId/agents` shipped without the filter and showed every
  agent on the page.

### Personal entity resolution — read `entity.agent_id`, not `agents.find()`

When `/me/{agents,quests,ideas,events,treasury}` needs a root agent for the
user's personal entity, do NOT use `agents.find(a => a.entity_id === pid)`
on the daemon store. The daemon's `agents` array is filtered by the active
X-Entity scope — when the user is currently scoped to a company, the personal
entity's root agent is absent from the array and the lookup returns null.

The right shape is `entity.agent_id` directly off the `/api/entities`
payload. The platform serialises `agent_id` on every placement; the entities
normaliser at `apps/ui/src/api/entities.ts` exposes it on the Entity type
(added 2026-05-07). Resolution order for the personal entity is now:
(1) first `placement_type === "host"` entity, (2) first matching `user.roots`
entry, (3) `entities[0]`. Then read `personalEntity.agent_id` directly.
Cost (2026-05-07): MePage rendered "No personal entity found." for every
account that DID have a personal placement, because the `agents.find()`
lookup returned null on company-scoped pageviews.

### `User.roots` is dead — `/api/auth/me` returns `entities`, not `roots`

The `User` type in `src/store/auth.ts` declares `roots?: string[]`, but the
platform's `/api/auth/me` handler returns `entities: <ids>`. The `roots`
field is ALWAYS `undefined` in production. Code that reads `user.roots`
silently falls through to a fallback path; new code must NOT depend on
`user.roots`. Read `useDaemonStore(s => s.entities)` instead. The
`needsOnboarding()` check on line 388-391 (currently `!user.roots ||
user.roots.length === 0`) is similarly a permanent `true` for verified
users — flag the next session that touches it; this needs a contract fix.

### Persona-walk briefs — verify against raw.json + DB before implementing

When a persona-walk brief asserts a root cause (e.g. "Luca has no personal
entity"), confirm against ground truth BEFORE building a fix:

1. **Console errors / network failures**: read
   `.observations/persona-walk-<date>/raw.json` directly; only fix what
   appears in `consoleErrors` / `networkFailures` arrays. The brief's
   page-level audit text can describe symptoms that don't appear in the
   actual capture (different walk run, manual annotation, etc.).
2. **Data assertions**: hit the DB directly. `sudo sqlite3
/var/lib/aeqi/platform.db "SELECT ... FROM runtime_placements WHERE
user_id = '<uid>'"` is one query and ~5 seconds — versus 5+ minutes
   reading auth.rs / start.rs / account.rs to triangulate.
3. **Architectural memory items**: code intent and current code can drift.
   The `architecture_user_account_is_company.md` memory said signups
   auto-create personal Companies; the live `signup_handler` says
   "No auto-spawn of a personal sandbox here." Trust the code over the
   memory when they disagree.

Cost (2026-05-07): UX P0 hotfix brief asserted Luca had no personal entity

- called for a Rust backfill migration. SQL showed two placements (one
  host, one sandbox) — the bug was purely the frontend resolution path. ~5
  min triangulation across three files saved by a single SQL query.

### `isDrilledAgent` is dead — bare `/c/<id>/` Overview routes through CompanyPage, not AgentPage

**Don't use `agent.id !== agent.entity_id` to detect "drilled into a specific
agent"** — root agents post-2026-04-29 have `entity_id` populated (the entity
they own), so the check returns `true` for them and silently routes the bare
`/c/<id>/` URL into AgentOverviewTab instead of EntityOverviewTab. The
EntityHeroStrip never mounts. URL semantics are the only reliable signal:
`/c/<id>/` (bare) means entity-scope; `/c/<id>/agents/<aid>/` means drilled.

The canonical dispatch already encodes this — AppLayout routes bare URLs
through CompanyPage, drilled URLs go straight to AgentPage. CompanyPage
handles `tab="overview"` directly with `<EntityOverviewTab entityId={…} />`,
no agent-scope detection needed. Don't reintroduce `isDrilledAgent` checks
in the entity-overview path. Cost (2026-05-08): UX walk v16 P0 #2/#3 —
EntityHeroStrip in the bundle but never rendering on AEIQ or Personal
overviews. Fixed in CompanyPage.tsx; AgentPage's stale `isDrilledAgent`
branch is now only reached from drilled URLs where the heuristic doesn't
matter (drilled URLs always have a non-root agent).

### Brief asserts UI hardcodes a string — grep before assuming

When a brief or walk report says "the apps/ui IntegrationCard might be
reading a hardcoded string instead of the runtime catalog. Fix to read
from runtime, OR update the hardcoded string to match" — grep first.
The default architecture for catalog-shaped data is "UI reads from API"
and the brief's hedge usually exists because the writer didn't verify.
If `grep -rn "<canonical-substring>" apps/` returns empty, the UI is
already correct and the symptom (stale copy in prod) is a backend deploy
issue, not a UI fix. Don't manufacture a fix to satisfy the brief. Cost
(2026-05-08): walk v16 Fix 2 (Drive scopes / fourteen tools); UI was
already reading `entry.description` from `/integrations`. The visible
stale copy was caused by the platform binary being two days stale —
out of UI scope.

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
node /home/claudedev/aeqi-<topic>/apps/ui/node_modules/eslint/bin/eslint.js src/
node /home/claudedev/aeqi/apps/ui/node_modules/vitest/vitest.mjs run
./node_modules/.bin/vite build
node scripts/hygiene-check.mjs
```

This is the parallel-subagent fallback for the full verify gauntlet.
The `PATH=".../node_modules/.bin:$PATH" npm run verify` pattern does
NOT work in this project — npm spawns a fresh shell that resets PATH,
so the binary injections never reach the subprocess. The `node` form
is the only reliable approach when `.bin/` is contested.

**`OwnershipPage` snapshot tests are pre-existing failing drift — not your regression.**
`src/test/components/OwnershipPage.test.tsx` has 2 snapshot tests that fail on main
and on every worktree branch. They show a stale "Human" occupant label vs the live
"user…er-1" truncated ID rendering. When `vitest run` reports these 2 failures, confirm
they also fail on main before diagnosing your change: `git -C /home/claudedev/aeqi stash
&& node .../vitest.mjs run src/test/components/OwnershipPage.test.tsx`. If they fail
there too, they're pre-existing — skip and proceed. Don't chase them unless your change
touches `OwnershipPage.tsx` or its mock data. Cost (2026-05-06): ~1 min confirmation per
session that sees them.

**`Icon.tsx` / `Icon.stories.tsx` lucide-react tsc errors are pre-existing — not your regression.**
`src/components/ui/Icon.tsx` and `src/components/ui/Icon.stories.tsx` emit `TS7016:
Could not find a declaration file for module 'lucide-react'` on main and every worktree
branch. When `tsc --noEmit` exits 2 with only these two errors, they're pre-existing drift —
confirm with `git -C /home/claudedev/aeqi stash && node node_modules/typescript/bin/tsc
--noEmit 2>&1 | grep lucide` from the parent. The error count on main must match exactly;
any additional errors are your regression and require a fix. Don't chase the lucide errors
unless your change touches `Icon.tsx` or its stories. Cost (2026-05-06): ~1 min verification
per session that sees them.

**Avatar render architecture — agent avatars are client-side, human avatars are proxy-injected.**
The roles surfaces (`RoleNode`, `RolesList`, `RolesChart`, `RolesCards`) and agents list
(`EntityAgentsTab`) resolve avatar URLs from two different sources:

- **Agent occupants**: `agent.avatar` field from the daemon store — available in `EntityRolesTab`
  as `agentAvatars: Map<string, string>` (built from `useDaemonStore(s => s.agents)`). No extra
  HTTP call needed — the daemon store already has it.
- **Human occupants**: `role.occupant_avatar_url` field on the `Role` type — injected by the
  platform proxy's `patch_role` helper in `aeqi-platform/src/routes/proxy.rs` from the `users`
  table `avatar_url` column (Google OAuth photo URL).

When a URL is present, render it as a circular `<img>` (borderRadius `999px`, objectFit `cover`).
When absent, fall back to a neutral grey initials circle (`--color-bg-subtle` background). No
per-role color field exists; the `occupant_color` field is on Agent, not Role.

If avatar data stops showing: (a) for agents, check that `useDaemonStore` returns agents with
`avatar` populated; (b) for humans, check that `proxy.rs` `patch_role` is hitting the user
record — the `users` table `avatar_url` may be null if the user authenticated without Google.
Cost (2026-05-06): ~2 sessions of implicit knowledge about this split before it was written down.

**`npm run verify` exit code 216 = binary not found, not a code error.**
Exit 216 is Node.js's "could not find the executable" signal — it means
the first binary in the verify chain (`tsc`, `prettier`, etc.) was missing,
not that your TypeScript or lint had errors. When you see exit 216 from
`npm run verify`, check `ls node_modules/typescript/bin/tsc` before
chasing phantom type errors. Fix is always `npm install --ignore-scripts`,
not editing code. Cost (2026-05-05): ~30s confusion before diagnosing.

**P0 triage: run prettier on only the changed file, not `src/**/_`.**
When main has pre-existing prettier drift in unrelated files (e.g.
`RolesList.tsx`failing format checks from a prior session's merge), a
blanket`prettier --check "src/\*\*/_.{ts,tsx,css}"`creates false-alarm
noise during a P0 fix and can look like your change is dirty. Narrow to
the changed file for the surgical signal:`prettier --check
"src/pages/YourChangedFile.tsx"`. If it's clean, the P0 fix is clean —
the other file's drift is pre-existing and not your regression.

**`replace_all` on inline style strings triggers prettier reformatting — run `prettier --write` after any `replace_all` pass.**
When `replace_all` substitutes a shorter/longer token alias inside an inline JSX style
object (e.g. `var(--text-muted)` → `var(--color-text-muted)`), adjacent lines in the
same style object may now exceed prettier's 100-char limit, causing `prettier --check`
to fail on lines you didn't intend to touch. The fix is always `prettier --write` on
the affected files immediately after the `replace_all` pass — not manual line-splitting.
Three files hit this in the role-pages token sweep (2026-05-06):
`RoleEditPage.tsx`, `RoleInvitePage.tsx`, `RoleNewPage.tsx`. Only `RoleDetailPage.tsx`
(which used surgical single-line edits, not `replace_all`) was unaffected.
Rule: after any `replace_all` pass on TSX/TS files, run
`./node_modules/.bin/prettier --write <file>` on all modified files before verify.

**eslint must be invoked via the worktree symlink path, not the parent path.** When the parent's `node_modules/eslint/` exists on disk but is partially extracted (stat shows the directory, `ls` shows files, but `node /home/claudedev/aeqi/apps/ui/node_modules/eslint/bin/eslint.js` throws `MODULE_NOT_FOUND`), the worktree symlink path resolves correctly: `node /home/claudedev/aeqi-<topic>/apps/ui/node_modules/eslint/bin/eslint.js`. The symlink traversal uses a different inode than the direct path when concurrent writes are in progress. Always use the worktree symlink form for eslint specifically. Cost (2026-05-05): one MODULE_NOT_FOUND failure that recovered by switching to the symlink path.

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

**Background `ui-deploy.sh` stale-output-file race.** When the script is
run in background mode and the output file already exists from a prior run,
the Monitor tool may fire on the old `rsync complete` line before the new
run reaches that point — giving a false success signal. The new run may then
fail silently (e.g. because the worktree was already removed, or a build
environment issue). Prevention: run `ui-deploy.sh` synchronously when
possible. If background mode is required, confirm the deploy by checking the
live hash after the script finishes: `curl -sL https://app.aeqi.ai/ | grep -oE
'index-[A-Za-z0-9_-]+\.js' | head -1` must match `cat apps/ui/dist/index.html
| grep -oE 'index-[A-Za-z0-9_-]+\.js'`. Cost (2026-05-06): background deploy
appeared to succeed (Monitor fired on stale `rsync complete`); synchronous
re-run was needed to actually ship.

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

## Adding a UI dependency from inside a worktree

Two-step recipe — installs the package into the parent's `node_modules` so the
symlinked worktree can resolve it immediately, AND updates the worktree's
`package-lock.json` so prod ships reproducibly. Worked first try on the
BlockNote ship (2026-05-06) without any ELOOP / ENOTEMPTY contention.

```bash
# 1. Add the dep entry to the worktree's package.json (Edit tool)

# 2. Install into PARENT'S node_modules without touching the parent's
#    package.json — `--no-save` avoids polluting main's tree. The
#    worktree's symlink picks the package up at the same inode the
#    parent has it; vite + tsc + verify all resolve immediately.
cd /home/claudedev/aeqi/apps/ui && npm install --no-save --silent <pkg>@<ver> [<pkg2>@<ver2>...]

# 3. Update the WORKTREE'S package-lock.json without re-installing.
#    This is the file that gets committed; prod's `npm ci` reads it
#    and gets the same versions the worktree built+verified against.
cd /home/claudedev/aeqi-<topic>/apps/ui && npm install --package-lock-only --silent

# 4. Verify and ship as normal.
cd /home/claudedev/aeqi-<topic>/apps/ui && npm run verify
```

Why this order: doing `npm install <pkg>` in the worktree directly would
create a real `node_modules` (breaking the symlink) and contend with sibling
worktrees. Doing it in the parent without `--no-save` would dirty main's
package.json. The split keeps the worktree's diff scoped to package.json +
package-lock.json + the actual feature code, and the parent's tree stays
write-clean except for the new package directories.

Pre-flight: confirm the package supports the project's React major before
pinning. `npm view <pkg> peerDependencies` is the one-line check.

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

await apiRequest("/account/enroll-passkey", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

`apiRequest` is the lower-level fetch wrapper that `api.*` methods
build on. Use it when you need a one-off POST/PUT/DELETE that doesn't
warrant a named method on the `api` object. Cost (2026-05-04): one
tsc edit pass when writing `AAEnrollmentPage`.

**`apiRequest` already prepends `/api` — paths must NOT start with `/api/`.**
`API_BASE_URL` in `apps/ui/src/api/client.ts` is `"/api"` (or
`VITE_API_URL`). `apiRequest("/foo/bar")` resolves to `/api/foo/bar`.
Calling `apiRequest("/api/foo/bar")` produces `/api/api/foo/bar` and
404s — the platform's catch-all proxy doesn't strip the duplicate
prefix. Symptom: route works in tsc, fails in browser, brief reads
"the page returns 404 on submit." Same trap caught twice now —
`01aae710` fixed `GoogleConnectCard`, `9f607ce2` fixed `StudioPage`'s
three architect verbs. Pattern hits any new page wiring `apiRequest`
because the dev intuitively types the full path. Rule for new code:
strip the `/api` prefix from every `apiRequest()` first argument.
Grep before commit: `grep -n 'apiRequest("/api/' src/` should return
zero matches.

## Modal accepts no `size` prop

`ModalProps` is `{ open, onClose, title?, children, className? }`. There
is no `size` variant. Passing `<Modal size="md">` silently compiles in
some TypeScript modes but fails strict tsc with "Property 'size' does not
exist on type 'ModalProps'". Don't add a size workaround inline — if you
need a wider modal, add a `size` prop to `Modal.tsx` + `Modal.module.css`
officially, or use `className` to override width on the call site.
Cost (2026-05-05): one tsc error caught during Wave 33 StackWizard work.

## Wiring keyboard shortcuts to existing popovers — controlled-open opt-in

When a parent surface needs to open a popover via keyboard (Linear-style
`S` / `P` / `A` / `D` shortcuts on the Quest detail), the standard
project popovers (`QuestStatusPopover`, `QuestPriorityPopover`,
`AssigneePicker`, `IdeasScopePopover`, etc.) own their own
`useState(false)` — there's no way for a parent to flip them open
without forking the component.

Canonical extension pattern: add **optional** `open?: boolean` +
`onOpenChange?: (next: boolean) => void` props that override the
internal state when present. Internal state is the default; controlled
state is opt-in. Every existing call site keeps working unchanged.

```tsx
const [openState, setOpenState] = useState(false);
const open = openProp ?? openState;
const setOpen = (next: boolean) => {
  if (openProp === undefined) setOpenState(next);
  onOpenChangeProp?.(next);
};
```

Then thread the controlled props through any wrapping toolbar to the
parent that owns the keyboard handler. The handler closes its siblings
when opening one popover (only one open at a time) and skips when
focus is in an editable element — same conventions as `j`/`k`
navigation. Cost (2026-05-07): `S`/`P`/`A` shortcut wiring on the
Quest detail page; pattern is generalisable to any popover that gains
a single-key shortcut.

## `import type` cannot import runtime values

`import type { Foo }` is erased at compile time — it works for interfaces
and type aliases but silently drops function or class imports. If you write
`import type { isSingleBlueprint }` where `isSingleBlueprint` is an
`export function`, TypeScript (in `isolatedModules` mode) either errors or
treats the identifier as `undefined` at runtime. The correct split:

```ts
import type { SingleBlueprint } from "@/lib/types"; // type only
import { isSingleBlueprint } from "@/lib/types"; // runtime function
```

Rule: scan every new `import type { ... }` for function or const exports
mixed in with interfaces. Move those to a plain `import { ... }` line.
Cost (2026-05-05): `BlueprintLaunchPicker.tsx` had `isSingleBlueprint`
stuck in a type import from the prior session; caught at session start
before tsc ran.

## Test copy coupling — update tests when changing empty-state text

Component tests use exact string matchers for user-visible copy
(`screen.getByText("No proposals yet.")`, `/no treasury activity yet/i`).
When an empty-state or heading string changes during a copy polish pass,
the companion test file must be updated in the same commit or verify will
fail with "Unable to find an element with the text: ...".

Rule: after any copy change in a page component (`src/pages/*.tsx`), grep
the companion test file (`src/test/components/<Page>.test.tsx`) for the
old string and update every match. The search is quick; missing it costs a
wasted verify run. Cost (2026-05-06): TreasuryPage and GovernancePage tests
both needed copy updates when empty-state text was polished.

Pattern for the search:

```bash
OLD="No treasury activity yet"
grep -rn "$OLD" src/test/ src/pages/
```

## Test store-state coupling — update `initialLoaded` when adding a loading gate

Smoke tests that call `useDaemonStore.setState({ ..., initialLoaded: false })` in
`beforeEach` will break immediately when a loading gate is added to the component
under test. The component now renders a `<Spinner />` instead of content, so any
test that queries for a button, heading, or element inside the empty state will get
`null` and fail with "expected null not to be null."

Rule: when adding a loading gate (any `if (!initialLoaded)` or `if (isLoading)` early
return) to a component, search `src/test/` for `initialLoaded: false` in any
`beforeEach`/`setState` block that also renders that component. Flip to `true` (or
the specific test's required loaded state). The daemon store's default is `false`,
so any existing smoke test that happened to pass before the gate was added only
passed because the gate didn't exist yet.

Pattern for the search:

```bash
grep -rn "initialLoaded: false" src/test/
```

For react-query hooks (`useAgentIdeas`, `useAgentEvents`), the equivalent trap is
tests that don't mock the query — react-query starts as `isLoading: true` in JSDOM
because no server is running, so the new loading gate renders the spinner on every
test render. Mock the query to return `{ data: [], isLoading: false }` in the test's
`beforeEach`, or use `queryClient.setQueryData(...)` to seed the result.

Cost (2026-05-06): smoke test `AgentQuestsTab smoke > exposes a New quest button on
the empty board` failed after adding `initialLoaded` gate — `beforeEach` had
`initialLoaded: false`; fix was a one-line flip to `true`.

## wagmi + native chain balance — `/chain/rpc` proxy pattern

**The browser cannot reach `127.0.0.1:8545` (anvil) directly.** Any wagmi hook that reads native ETH balance (`useBalance`) or calls RPC methods must go through the platform's `/chain/rpc` reverse-proxy, not directly to the node URL.

**Three-piece setup required:**

1. **Platform route** (`aeqi-platform/src/routes/rpc_proxy.rs` + `server.rs`): `axum::routing::any(rpc_handler)` on `/chain/rpc`. Mirrors the `/indexer/graphql` proxy pattern. Returns 503 when `AEQI_CHAIN_ACTIVE` is unset.

2. **wagmiConfig** (`src/lib/wagmiConfig.ts`): Add `anvil` from `wagmi/chains` to the `chains` array and `transports` map. Transport URL is `VITE_CHAIN_RPC` env var (default `/chain/rpc`):

```typescript
import { anvil } from "wagmi/chains";
const CHAIN_RPC_URL = (import.meta.env.VITE_CHAIN_RPC as string | undefined) || "/chain/rpc";

export const wagmiConfig = createConfig({
  chains: [mainnet, sepolia, anvil],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [anvil.id]: http(CHAIN_RPC_URL),
  },
  ...
});
```

3. **Usage** (`useBalance` or any wagmi RPC hook): Pass `chainId: anvil.id` to scope to the local chain:

```typescript
import { useBalance } from "wagmi";
import { anvil } from "wagmi/chains";

const { data: ethBalance } = useBalance({
  address: trustAddress as `0x${string}`,
  chainId: anvil.id,
});
// ethBalance?.formatted → "1.0000" (18-decimal ETH string)
```

**Chain label config** — use `VITE_CHAIN_NAME` (default `"anvil"`) and `VITE_CHAIN_EXPLORER` (default `""`) to drive human-readable labels and explorer links. Never hardcode chain names ("Base Sepolia", "Mainnet") in component copy. Cost (2026-05-06): `TreasuryPage.tsx` had "Base Sepolia" hardcoded on line 216; required env-var extraction.

**`useBalance` vitest stub** — in tests, mock wagmi to stub `useBalance` since there's no real RPC in test scope:

```typescript
vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return { ...actual, useBalance: vi.fn(() => ({ data: undefined, isLoading: false })) };
});
```

## Lazy wallet split — QueryClientProvider stays at root

**When lazy-loading the wallet provider stack, `QueryClientProvider` must stay in `main.tsx`, NOT inside the lazy module.** The app uses react-query throughout (ideas, quests, events, agents, channels queries) — not only for wagmi. If `QueryClientProvider` moves inside the lazy `WalletProvider` chunk, every non-wallet query throws "No QueryClient set" until the wallet bundle loads.

Correct tree (as of 2026-05-06):

```
StrictMode
  QueryClientProvider          ← EAGER in main.tsx
    Suspense
      WalletProvider (lazy)    ← WagmiProvider + RainbowKitProvider only
        BrowserRouter
          App
```

`WagmiProvider` sees `QueryClientProvider` as an ancestor — that satisfies wagmi's requirement. `wagmiConfig` and both rainbowkit imports live inside `WalletProvider.tsx` only.

**`import type { ReactNode }` in new lazy components.** The project uses `"jsx": "react-jsx"` — no auto `import React`. New lazy components that accept `{ children }` must import the type explicitly: `import type { ReactNode } from "react"`. Cost (2026-05-06): first draft used `React.ReactNode` without an import, caught immediately by tsc.

## BlockNote schema — defaults already include every block

**`useCreateBlockNote()` with no `schema` argument uses `defaultBlockSpecs`, which already includes every shipping block — `paragraph`, `heading`, `bulletListItem`, `numberedListItem`, `checkListItem`, `codeBlock`, `quote`, `divider`, `pageBreak`, `image`, `video`, `audio`, `file`, `toggleListItem`, `table`, etc.** The slash menu and drag-handle add-block menu surface all of them automatically. There is no "enable the X block" config — every block ships on.

So if a brief says "enable the table block" or "turn on the toggle list," the work is one of two things:

1. **Already on.** Open any BlockEditor in dev, type `/`, confirm the block appears in the slash menu. If it does, ship a CSS pass against the design tokens (BlockNote's default styles use hardcoded `#ddd` cell borders, etc.) and call it done.
2. **Schema is intentionally restricted.** If `BlockNoteSchema.create({ blockSpecs: { paragraph, heading } })` was used to lock the editor down, then "enabling X" means widening the spec map. Grep for `BlockNoteSchema.create` first.

When extending for Phase 2 / 3 work (custom blocks, formula bars), the canonical pattern is:

```ts
const editorSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, customBlock: customBlockSpec },
});
```

Don't replace `defaultBlockSpecs` with a hand-picked subset unless you specifically want to disable blocks. Cost (2026-05-07): ~3 min reading BlockNote `.d.ts` to confirm `table` is in the defaults — confirmed, no enablement work was needed for Tables-in-Ideas Phase 1, only an explicit-schema declaration (for future extension hooks) plus design-token border CSS.

## v3 token drift — broken aliases with no compat bridge

**`--text-{2xs,xs,sm,base,lg,xl}` are broken tokens — no bridge, no v4 equivalent.**
These font-size shorthands exist in some pages but are NOT defined anywhere in
`primitives.css` or `tokens.css`. They silently produce `undefined` (fontSize not
applied). Canonical fix: `--text-{size}` → `--font-size-{size}` (direct rename, the
`--font-size-*` scale is the v4 canonical set). Affected files found in v3-sweep
(2026-05-06): OwnershipPage, GovernancePage, TreasuryPage, WalletUpgradeSection,
AAEnrollmentPage. Grep: `grep -rn 'var(--text-[0-9a-z]' src/`.

**`--text-tertiary` has no compat bridge — silently applies no color.**
`primitives.css` bridges `--text-{primary,secondary,muted}` to the v4 `--color-text-*`
equivalents, but `--text-tertiary` was never bridged. Elements using it inherit their
parent's color instead of reading as demoted/muted text. Fix: `--text-tertiary` →
`--color-text-muted`. Cost (2026-05-06): discovered mid-sweep when grep found 14
occurrences in blueprints-store.css, blueprint-launch-picker.css, and pages.css with
no matching definition anywhere in the token files.

**`--space-{xs,sm,md,lg,xl}` v3 shorthand aliases were undefined — now bridged.**
The v3 shorthand scale (`--space-xs` through `--space-xl`) was used extensively in
`GovernancePage.tsx` and `TreasuryPage.tsx` but was never defined in `primitives.css`
or `tokens.css`. Every padding, margin, and gap that referenced these aliases silently
resolved to zero — the pages had no visible spacing until the bridge was added (2026-05-06):

```css
--space-xs: var(--space-2); /* 8px */
--space-sm: var(--space-3); /* 12px */
--space-md: var(--space-4); /* 16px */
--space-lg: var(--space-6); /* 24px */
--space-xl: var(--space-8); /* 32px */
```

These aliases are now in `primitives.css` `:root`. They are the ONLY supported shorthand
form. New pages must use `--space-{N}` (the canonical numeric scale). These bridges exist
only for backward compat with pages written against the v3 schema. Do NOT add new usage
of `--space-xs/sm/md/lg/xl` in new pages or components — go to `--space-{2,3,4,6,8}`
directly. Grep for silent zeros: `grep -rn 'var(--space-[a-z]' src/`.

## Hover audit — verify `.is-clickable:hover` actually changes the visual state

**A hover style that sets the same property to the same value as the resting state
is a no-op — invisible to the user but not to the linter.** Pattern to catch:
`.role-node.is-clickable:hover { background: var(--color-card-elevated); }` — this was
a no-op because `.role-node`'s resting background IS `var(--color-card-elevated)`. The
rule compiled fine but provided zero hover feedback. Fixed (2026-05-06) by switching to
`box-shadow: var(--shadow-sm)`, which provides perceivable lift without changing the
background tier.

Rule: after any hover CSS edit, verify the property you're setting differs between resting
state and hover state. The canonical hover signals are: `box-shadow` lift (`--shadow-sm`),
`background` step-up ONE tier (card → card-elevated, never jumping two), or `opacity`
reduction for danger/muted actions. Grep for no-op candidates:

```bash
# Find hover rules that set background to card-elevated, then check if
# the same selector's resting state also uses card-elevated.
grep -A2 ':hover' src/styles/*.css | grep 'color-card-elevated'
```

## Brief specs vs locked design rules — translate, don't transcribe

**When a task brief specifies a CSS technique that conflicts with a locked anti-pattern,
translate it to the canonical equivalent silently — don't hedge, don't deviate-and-explain.**
Example pattern (Tables Phase 2.5, 2026-05-07): brief said "lane highlight (border-left-color
shift on `dragOver`)". `feedback_no_hairlines.md` and `.impeccable.md` both ban 1px borders
for separation. Canonical translation:

| Brief says                                                  | Canonical translation                               |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `border-left-color` shift / `border` accent stripe          | `background` tier step (card → card-elevated)       |
| 1px divider line                                            | spacing + tint shift                                |
| `box-shadow: inset 0 0 0 1px ...` (cosmetic-swap of border) | real `--shadow-sm` lift OR background step          |
| explicit hex / rgba color                                   | nearest design-system token (grep `primitives.css`) |
| custom radius value                                         | nearest `--radius-*`                                |
| custom font-size literal                                    | nearest `--font-size-*`                             |

Briefs are written by humans/subagents who don't always carry the design-system constraints
in working memory. The agent does. Apply the canonical move; the brief is intent, not contract.
Do NOT add a paragraph in the reply explaining the deviation — it's a translation, not a
disagreement. If the canonical move materially changes the UX (not just the CSS technique),
THEN flag it in the reply. Cost (2026-05-07): one mid-implementation pause to weigh
brief-fidelity vs hairline ban — translating without comment is the cheaper path.

## Auth pages — skip link pattern

**Auth pages render outside `AppLayout` and need their own skip link.** `AppLayout`
injects `.skip-link` as its first child, so every in-shell route gets it for free.
`LoginPage` and `SignupPage` both render a bare `<main className="signup-split">`
with no shell wrapper — they must include the link themselves.

Canonical placement (two required lines, always together):

```tsx
<main className="signup-split">
  <a className="skip-link" href="#main-content">
    Skip to main content
  </a>
  <div className="signup-form-side" id="main-content">
    {/* form content */}
  </div>
  <div className="signup-pitch-side">...</div>
</main>
```

Key points:

- Skip link is the **first DOM child** of `<main>`, before any focusable element.
- `id="main-content"` goes on `signup-form-side` (the form column), NOT on `<main>`.
  `<main>` is the two-column split wrapper — landing there skips nothing visible.
- `LoginPage` has **two render branches** (secret mode + accounts mode). Both need
  the skip link. Don't fix one branch and miss the other.
- `SignupPage` has one render branch. Both auth pages are now fully covered (fixed 2026-05-06).

## Org-chart viewport — `offsetWidth` not `scrollWidth` for auto-fit

**`scrollWidth` / `scrollHeight` are clamped by parent overflow — use `offsetWidth` / `offsetHeight`.**
The zoom-viewport auto-fit in `OrgZoomViewport` (`RolesChart.tsx`) computes the initial
scale from the inner div's natural width. `scrollWidth` only reflects overflow that has
scrolled past the edge — when the parent container uses `overflow: hidden` (as the
viewport does), `scrollWidth` is clamped to the container width rather than the content
width. For a wide org tree the canvas can be ~1740px but `scrollWidth` reports ≈1440
(the container width), the computed scale lands at ≈1.0, and the rightmost nodes clip.
`offsetWidth` is the element's laid-out box width, independent of parent clipping.
Fix: `inner.offsetWidth` / `inner.offsetHeight`. Cost (2026-05-06): right-side nodes
clipped at default zoom until this was corrected.

## Org chart — use `layoutChart` directly, no dept-cluster envelopes

**Both `RolesChart` and `AgentsChart` render a Reingold-Tilford tidy-tree via
`layoutChart` from `roles/layout.ts`.** Each subtree claims a horizontal slot
proportional to its own width (deep subtrees get more space than leaf siblings),
and every parent is centred over its children cluster. The chart is a single SVG
canvas: CEO at layer 0, direct reports at layer 1, grandchildren at layer 2, etc.
No painted department-cluster envelopes — hierarchy is expressed by vertical
position and bezier edges alone. V_GAP=120, H_GAP=48.

`layoutDepts` and the `DeptCluster` / `DeptLayout` interfaces were deleted in
`100ac7b9` (2026-05-06). Do not reintroduce them. The old "swim-lane" model was
wrong because Backend Intern belongs in Backend Engineer's subtree, not in a CTO
envelope painted as a peer of the CTO node.

Rule: if you're building a chart surface over `Role[]` + `RoleEdge[]`, import
`layoutChart` (and `NODE_W` / `NODE_H`) from `roles/layout.ts` and render nodes
at their absolute `(x, y)` positions.

**List views use pre-order DAG traversal + depth indent, not section headers.**
`RolesList` (Roles tab list view) and `AgentsList` (Agents tab list view) both
express hierarchy as a depth-indented flat list — pre-order DFS from roots,
`paddingLeft: depth * 24` on the first cell. Section-header grouping by
`role_type` or department label was the prior anti-pattern and was removed
(2026-05-06) from `EntityRolesTab.tsx`. Do not reintroduce `ROLE_TYPE_ORDER`
or any section-header loop in the list view — hierarchy lives in the indent,
not in headers.

CSS classes that are gone and must NOT be added back:
`.roles-chart-dept-cluster`, `.roles-chart-dept-root`, `.roles-chart-ceo-row`,
`.roles-chart-dept-row`, `.roles-chart-dept-label`.
