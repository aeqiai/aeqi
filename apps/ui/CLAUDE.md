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

### Raw upstream payloads should never bleed into the UI — wrap with a parser

Whenever a UI component renders a string the runtime forwards verbatim
from an upstream service (LLM provider error envelopes, on-chain revert
data, IPC error messages, stack traces), the canonical shape is:
`parseFooContent(raw): { headline, detail?, hint? }` rendered as a
three-tier block. Headline weighted, detail+hint muted. Quiet visual
treatment (`--color-card-subtle` / `--color-text-muted`) — no
aggressive red unless it's a real fault state. Most "errors" are
upstream rate-limits or provider hiccups, not user-actionable faults.

Example shipped 2026-05-07 in `MessageItem.tsx`: `parseErrorContent`
recognises `OpenRouter API error (NNN ...): {...}` envelopes and
generic `error.message` JSON, lifts a one-line headline (e.g. "Upstream
is rate-limited"), surfaces a muted detail (provider + model + status)
and an optional hint (e.g. "Retrying or add your own OpenRouter key in
Settings → Integrations"). Falls through to raw content for unknown
shapes — never loses information.

Rule: any time a backend producer hands the UI a string that includes
stringified JSON / hex revert data / "Provider returned ..." preamble,
write the parser BEFORE rendering. The parser belongs next to the
component that consumes it (small file-local helper); only extract to
a shared util when ≥3 surfaces consume the same upstream shape.
Cost-of-skipping: founder catches the raw payload in dogfood and files
a P0. Three instances in the last week (alloy revert hex, venture
template revert, OpenRouter 429 envelope) — recurring enough to
canonise.

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

(`/me/*` routes were retired 2026-05-07; the lesson generalises to any entity
surface that needs the entity's root agent without relying on the active
X-Entity scope.) The daemon's `agents` array is filtered by the active
X-Entity scope — when the user is scoped to one company, another entity's
root agent is absent from the array and `agents.find(a => a.entity_id ===
otherId)` returns null.

The right shape is `entity.agent_id` directly off the `/api/entities`
payload. The platform serialises `agent_id` on every placement; the entities
normaliser at `apps/ui/src/api/entities.ts` exposes it on the Entity type
(added 2026-05-07). Resolution order for "the user's primary entity" is:
(1) first `placement_type === "host"` entity, (2) `entities[0]`. Then read
`primaryEntity.agent_id` directly. Cost (2026-05-07): MePage rendered "No
personal entity found." for every account that DID have a personal
placement, because the `agents.find()` lookup returned null on company-
scoped pageviews.

### Top-level routes that fire BEFORE AppLayout must kick `fetchEntities` themselves

`AppLayout` is the canonical hydration point for the daemon store: its
`useEffect(() => { fetchAll(); }, ...)` populates `entities`, `agents`,
`quests`, `events`, etc. Any route component that mounts INSIDE AppLayout
(every entity-scoped surface, `/account`, `/start`, `/economy`, `/blueprints`)
can read `useDaemonStore(s => s.entities)` immediately and assume hydration
is in flight or already done.

Top-level routes that mount OUTSIDE AppLayout cannot — `RootRouteSwitch`
(which decides the bare `/` redirect) is the canonical example. The store
is empty at first render. If the route's job is to read `entities` and
make a navigation decision, it must:

1. `useEffect` to call `fetchEntities()` (user-scoped, no X-Entity gate;
   safe to call before any entity is selected) when `!initialLoaded`.
2. Render a spinner / placeholder until `initialLoaded === true`.
3. Read the resolved value once hydration completes; navigate.

```ts
const entities = useDaemonStore((s) => s.entities);
const initialLoaded = useDaemonStore((s) => s.initialLoaded);
const fetchEntities = useDaemonStore((s) => s.fetchEntities);

useEffect(() => {
  if (authMode && authMode !== "none" && token && !initialLoaded) {
    void fetchEntities();
  }
}, [authMode, token, initialLoaded, fetchEntities]);

if (!initialLoaded) return <LoadingSpinner />;
const primary = entities.find((e) => e.placement_type === "host") ?? entities[0] ?? null;
if (primary) return <Navigate to={entityPath(primary, "inbox")} replace />;
```

The naming matters: call `fetchEntities` (just the user-scoped slice), NOT
`fetchAll`. `fetchAll` would chain into `fetchAgents` / `fetchQuests` etc.
which are X-Entity scoped and cannot fire before an entity is selected —
they'll 400 with "X-Entity required" and pollute the daemon store with
errors. The user-scoped `fetchEntities` is the ONLY pre-AppLayout-safe
hydration call. Cost (2026-05-07): drop-/me-routes ship — RootRouteSwitch
needed entities to compute the primary inbox URL, but `fetchAll` was the
first instinct and would have fired four 400s before resolving.

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

### Brief asserts file paths — many `/me/*` routes have no dedicated page file

Sister pattern to the "hardcoded string" trap. When a brief or audit
report says "fix X likely in `apps/ui/src/pages/MeQuestsPage.tsx`,
`apps/ui/src/pages/MeIdeasPage.tsx`, or sibling components" — the named
files often don't exist. The `/me/quests` and `/me/ideas` routes are
served by `MePage.tsx` dispatching to shared tab components
(`AgentQuestsTab`, `IdeasListView`); the same components serve
`/c/<id>/agents/<aid>/quests` and `/c/<id>/ideas`. The bug usually
lives in the SHARED component, not in a route-specific page file.

Recipe before reading the brief's named files:

```bash
# Does the named page file exist?
ls apps/ui/src/pages/MeQuestsPage.tsx 2>/dev/null
# If no — find what renders the route. MePage.tsx dispatches by tab.
grep -rn "MePage\|/me/quests\|/me/ideas" apps/ui/src/AppLayout.tsx apps/ui/src/pages/MePage.tsx
# Find the shared tab/list component, then grep for the buggy element.
```

Cost (2026-05-07): import-button-secondary ship — brief named two
non-existent files (MeQuestsPage / MeIdeasPage); first grep returned
empty, second grep found `ImportMenu.tsx` (the shared trigger
component) which is the canonical fix site for both routes. Brief
hedge "or sibling components" was correct; reading it as the primary
target instead of the named files saves one wasted grep.

### Brief asserts UI duplication — grep + read transports before refactoring

Sister pattern to the "hardcoded string" trap. When a brief asserts that
two/three surfaces "duplicate" the same primitive and asks for a unify
ship, two truths can hide:

1. **The unification already happened.** A shared primitive may already
   live in `components/<family>/` and one of the surfaces may already
   adopt it via a shell/wrapper file. Grep for the canonical class names
   the brief mentions before reading the named files. If `<SharedThing>`
   already exists, the ship is "adopt this in the holdouts," not "extract
   from scratch."
2. **The surfaces share a visual but not a transport.** Inbox uses a
   Zustand store + polling, Agent uses WebSocket streaming with thinking
   segments, Channels uses react-query polling. They look identical in
   screenshots but cannot be subsumed into one component without
   collapsing transport semantics. The right scope is: extract the
   _visual_ primitive (rail, card, row), have each surface adapt its
   data layer into the primitive's prop contract, leave the
   data/streaming layer per-surface. Don't try to unify transports in a
   single ship — that risks breaking streaming for cosmetic gain.

Recipe before any "unify the X primitive" ship:

```bash
# Does a shared primitive already exist?
ls apps/ui/src/components/<family>/ 2>/dev/null
grep -rn "<SharedClassName>" apps/ui/src/styles/ apps/ui/src/components/

# Read each surface's data layer — store / WS / react-query — and confirm
# they're the same transport before assuming the components duplicate.
grep -l "useWebSocketChat\|useChatStore\|useQuery\|useStore" \
  apps/ui/src/<surface-1> apps/ui/src/<surface-2>
```

Cost (2026-05-07): workstream-2 of session-unification asserted three
surfaces (MeInboxPage / AgentSessionView / ChannelDetailPage) duplicated
`<SessionRail>` + `<SessionDetail>`. Grep showed `shell/SessionsRail.tsx`
already existed and was adopted by AgentSessionView; only inbox needed
adoption. Detail-pane unification was out of scope: WS+segments vs
store+POST vs react-query+groupMessages. Reframed the ship to extract
`<SessionRail>` from shell/, generalize via prop contract, adopt in
inbox. Detail unification deferred. ~5 min triangulation saved a multi-
day refactor that would have broken streaming.

### Brief asserts row-content divergence — confirm the data shape is divergent-by-design before "unifying"

Sister pattern to "Brief asserts UI duplication." When a brief asserts
that two surfaces feeding the same primitive produce visually different
content ("inbox passes `r.subject` as `primary`; agent rail passes
`sessionLabel(s)`; make them the same") — read the locked-shape rules
first. The two surfaces may be feeding the SAME primitive with
canonical-per-surface content semantics, where unifying would regress.

Specifically for SessionRail:

- `apps/ui/CLAUDE.md` "SessionRail row shape" section locks single-line
  h=32 across both adopters. Visual TREATMENT is unified.
- The `primary` content is canonical-per-surface: inbox shows the
  awaiting question (most informative single string for a decision
  request); chat rail shows the session display label (most informative
  for an open conversation).
- "Sender name lives in the right-pane detail header, not duplicated in
  the rail row" — locked rule. A brief asking to "pass `from.name` as
  primary on inbox" would REGRESS the surface.

Recipe: when a brief proposes content unification, grep for the locked
shape rule before applying:

```bash
# Find the locked-shape section for the primitive
grep -A 20 "<PrimitiveName> row shape\|<PrimitiveName> shape — locked" \
  apps/ui/CLAUDE.md apps/ui/.impeccable.md
```

If a locked rule exists and contradicts the brief, the brief is wrong.
Apply the canonical surgical fix to the actual user-visible symptom
(in this session: composer position + double-mount + replyable gate),
not the brief's content-unification proposal. Document the decision in
the commit body so the next reader doesn't reopen the same question.
Cost (2026-05-07): SessionDetail-unify ship — brief asserted row primary
divergence; reading the locked SessionRail row shape rule established
the canonical answer; the actual user complaint was composer position,
not row primary. ~3 min triangulation prevented a regression.

### Brief asserts API extension — read the existing prop signature first

Sister pattern to "Brief asserts UI duplication." When a brief proposes
extending a primitive's API to add a slot ("`SurfaceHeader` needs a
`titleEditable?: boolean` + `onTitleChange?: (s: string) => void` prop,
OR a `customTitle?: ReactNode` slot"), open the primitive's source
BEFORE writing the API change. Most slot-shaped briefs are already
expressible with the existing API:

- A `title: ReactNode` prop already accepts an `<input>`, an avatar +
  name composition, or any other JSX — there is no need for a parallel
  `customTitle` slot.
- An `actions: ReactNode` prop already accepts a fragment of buttons —
  there is no need for a parallel `extraActions` slot.
- Any time the brief proposes adding a typed-shape prop (`titleEditable

* onTitleChange`) NEXT TO an existing free-form slot, the free-form
  slot is the canonical answer; the typed-shape prop is the brief's
  fallback for when the free-form slot doesn't exist yet.

Recipe before extending a primitive's API:

```bash
# Read the primitive's prop signature directly.
grep -A 20 "^export default function <Name>" apps/ui/src/components/<Name>.tsx

# If you see `<slot>: ReactNode` (or `: ReactNode | string`), the slot
# is the seam. Pass your editable input / button fragment as that prop.
```

When the existing slot IS the seam, fold the brief's content into it
and skip the API extension. Document the decision in the commit body
("SurfaceHeader's existing `title: ReactNode` and `actions: ReactNode`
already accept the input + button fragment; no API change needed") so
the next reader doesn't re-propose the extension. The brief is intent,
not contract — same as the design-system translation rule above.

Cost (2026-05-07): event-header-fold ship — brief proposed adding
`customTitle?: ReactNode` + `extraActions?: ReactNode` to SurfaceHeader;
existing `title` and `actions` props were already typed `ReactNode` and
took the fold without any API change. Saved ~5 min of API-extension
churn + a follow-up cleanup pass.

### "Match X's canonical shape" briefs — copy the imports too

When a brief asks to make surface B render with the same chrome as
surface A's canonical shape (e.g. "match event detail header to the
`.ideas-toolbar.ideas-canvas-toolbar` shape that idea + quest detail
use"), open the canonical file FIRST and copy its imports into the
target. The imports are part of the contract: `Tooltip` is exported
via `./ui` index in IdeaCanvas / QuestCanvas — not via individual
file paths. Reaching for `import Tooltip from "../ui/Tooltip"` ships
a typecheck error or a silent path desync; the canonical
`import { Button, Tooltip } from "../ui"` is what the matched file
already does and is what the new file should do.

Recipe before writing the new shape:

```bash
# Read the canonical file's import block
sed -n '1,20p' apps/ui/src/components/<CanonicalFile>.tsx
```

Copy the import shape verbatim; don't reinvent. Cost (2026-05-07):
event-detail-ideas-toolbar ship — first draft used
`import Tooltip from "../ui/Tooltip"` (default) when IdeaCanvas /
QuestCanvas both use the named `{ Tooltip }` from `./ui`. One edit
pass to align before tsc passed. Trivial fix; recurs every "match
canonical shape" brief because the impulse is to import what you
need, not what the canonical file imports.

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

**eslint partial install — `formatters/stylish.js` missing mid-verify.** Sister
trap to the TypeScript partial-install case, but for eslint. Symptom: `npm run
verify` reaches the eslint step and fails with `There was a problem loading
formatter: .../node_modules/eslint/lib/cli-engine/formatters/stylish.js — Error:
Cannot find module ...`. `tsc` and `prettier` already passed; eslint itself runs
(its bin is present) but its default `stylish` formatter file is absent because
a prior `--ignore-scripts` install or interrupted reinstall left the eslint
package partial — `ls node_modules/eslint/lib/cli-engine/formatters/` shows
`html.js / json.js / json-with-metadata.js` but no `stylish.js`. Fix is the same
as the typescript case: `cd /home/claudedev/aeqi/apps/ui && npm install --silent`
(no `--ignore-scripts`) — fills in the missing formatter file in place. Step 0
pre-flight only checks the typescript package today; eslint can slip through
into Step 1 verify. Cost (2026-05-07): ~60s on avatar-shape-by-kind ship.

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

**`--ignore-scripts` does NOT restore @types/\* — second pass with full `npm install` required.**
After an ELOOP recovery via `npm install --ignore-scripts`, `node_modules/typescript/`
is present and `.bin/tsc` runs, but the `@types/react`, `@types/react-dom`, etc.
packages are absent or partial. Symptom: tsc explodes with hundreds of `Cannot find
module 'react'` / `Cannot find namespace 'React'` / `JSX element implicitly has type 'any'`
errors across every `.tsx` file in the tree (worktree AND main). Errors look like
your diff broke the type system, but they're really upstream — a one-liner sanity
check confirms: `cd /home/claudedev/aeqi/apps/ui && node node_modules/typescript/bin/tsc
--noEmit 2>&1 | head -3`. If main itself is broken, your worktree is fine — the
parent state is degraded.

Recovery: run `npm install --silent` (no `--ignore-scripts`) once. The native-addon
ELOOP only fires when sibling worktrees hold symlinks open at install time — in the
post-rebase phase of /ship the worktree's symlink is already resolved cleanly, so a
plain `npm install` proceeds without ELOOP and fully populates `@types/*`. Skip the
detective work; the recipe is two installs, in order.

Cost (2026-05-07): mid-ship rebase verify on multi-participant ship cycle hit this —
~60s confusion reading the tsc error wall before realising main also showed the
same errors. Pattern: any `--ignore-scripts` install used as ELOOP recovery MUST be
followed by a plain `npm install` before declaring node_modules healthy.

**Plain `npm install --silent` returning 0 does NOT prove `.bin/` is populated.**
A separate failure mode from the partial-install / ELOOP cases above: the parent
can have every package directory present and `npm install --silent` exit 0 with
no output, yet `.bin/` is empty (zero bin symlinks). Subsequent `npm run verify`
fails with `prettier: not found` / `tsc: not found`. Repeating `npm install`
doesn't repair it; only `npm install --ignore-scripts` consistently rebuilds the
bin links. Likely sibling-worktree contention on lifecycle scripts during the
postinstall step — `--ignore-scripts` skips that phase and lets npm finish
wiring `.bin/` symlinks. Diagnostic: count entries in `.bin/`:

```bash
ls /home/claudedev/aeqi/apps/ui/node_modules/.bin/ | wc -l   # should be 600+
ls /home/claudedev/aeqi/apps/ui/node_modules/.bin/prettier   # canary file
```

If `.bin/` has <50 entries OR `.bin/prettier` is absent while `node_modules/`
has 600+ packages, the bin-link state is degraded. Recovery:
`cd /home/claudedev/aeqi/apps/ui && npm install --ignore-scripts`. The /ship
Step 0 pre-flight now checks `.bin/prettier` (not just the typescript package
file) for this reason — typescript's `bin/tsc` is the package's own file, NOT
a `.bin/` symlink, so checking it alone doesn't tell you whether `.bin/` is
populated. Cost (2026-05-07): 3 install passes on event-detail-canvas-bigger
ship before `--ignore-scripts` repaired bins.

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

**`SessionRedirect.tsx` `react-hooks/exhaustive-deps` warning is pre-existing — not your regression.**
`src/components/SessionRedirect.tsx:29` triggers `react-hooks/exhaustive-deps`: "the
'inboxResolved' conditional could make the dependencies of useEffect Hook (at line 81)
change on every render. To fix this, wrap the initialization of 'inboxResolved' in its
own useMemo() Hook." When `npm run verify` reports `✖ 1 problem (0 errors, 1 warning)`
and the only warning points at `SessionRedirect.tsx`, it is pre-existing drift on
main — verify is still green (warnings don't fail the gauntlet). Don't chase unless
your change touches `SessionRedirect.tsx`. The proper fix is wrapping `inboxResolved`
in `useMemo`, but the file is a legacy redirect shim slated for removal once the
sessions→inbox rename canonicalises in shipped bookmarks. Cost (2026-05-07): ~30s
triage per session that sees it.

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

**Symptom fingerprint: "wagmi/chains has no exported member 'anvil'" + "viem
cannot find module" on a fresh worktree.** When `tsc` reports a flurry of
TS2305 / TS2307 errors against `wagmi/chains`, `viem`, or other recently-added
deps on first verify in a worktree, AND `node node_modules/typescript/bin/tsc
--noEmit` from the parent (`/home/claudedev/aeqi/apps/ui/`) exits 0 — it's
ALWAYS a stale `.tsbuildinfo`, never a missing package. The symbol-not-exported
shape mimics a real install regression and can sidetrack into npm install
debugging. Recipe: confirm parent is clean first (one tsc run from main),
then `rm <worktree>/apps/ui/.tsbuildinfo` (and `/home/claudedev/aeqi/apps/ui/
.tsbuildinfo` if present) and re-run verify. Cost (2026-05-07): one extra tsc
pass on roles-dispatch-hole ship before reaching for the rm.

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

## Popover trigger wraps in `onClick={toggle}` — Link-as-trigger fights itself

`Popover.tsx` mounts its `trigger` prop inside a `<div className={styles.triggerSlot}
onClick={toggle}>` wrapper. The wrapper's click handler always toggles the popover,
regardless of what the trigger element does. Two consequences:

1. **Don't put a `<Link>` (or any element that needs to handle its own click as the
   primary affordance) INSIDE a Popover trigger.** Clicking the Link both navigates
   AND toggles the popover — the popover blinks open while React Router transitions,
   and the result is incoherent. If a row needs both "primary navigate" and
   "secondary menu" affordances, make them SIBLINGS, not parent/child:

   ```tsx
   <div className="row">
     <Link to="/me" className="row-primary">
       …
     </Link>
     <Popover trigger={<button className="row-chevron">⋯</button>} portal>
       …
     </Popover>
   </div>
   ```

   Pattern shipped 2026-05-07 in `AccountDropdown.tsx` (sidebar bottom user row).

2. **The Popover root is `display: inline-block`.** When the row wrapper uses flex
   (`.account-dropdown-row { display: flex }`), the Popover sits as a content-sized
   sibling — its inline-block doesn't break the flex distribution. But if you ever
   want the chevron-popover to grow, you need to wrap it in a flex item or override
   the root's display. Don't try to set `flex: 1` on the Popover element directly —
   that's what `triggerSlot { display: contents }` is hiding from you.

   `triggerSlot { display: contents }` means the trigger ELEMENT (your button)
   participates in the parent's flex/grid context as if the trigger wrapper weren't
   there. Layout looks normal; click handling is still on the wrapper. This is what
   lets a button with hover styles work cleanly inside a Popover.

3. **When the row IS a Popover (single trigger, no sibling Link), the row's children
   need `flex: 1`.** Pattern: collapsing the AccountDropdown chevron-pattern into
   "click the row → opens menu" makes Popover the only child of the flex row. The
   Popover root is still `display: inline-block` (collapses to button width). The
   `triggerSlot { display: contents }` lets the inner button receive flex sizing,
   but only if the Popover ROOT itself stretches. Canonical fix is one CSS rule on
   the row: `.row > * { flex: 1; min-width: 0; }`. The button inside the trigger
   (with its own `flex: 1`) then fills correctly. Don't reach for `display: contents`
   on the root, or for a wrapper `<div className="grow">`; the universal-child
   selector is the cheapest and most explicit. Pattern shipped 2026-05-07 in
   `AccountDropdown.tsx` (founder revert of `cb100f4f` chevron + Personal Inbox).

## Stale "already does X" comments — verify behaviour before trusting them

Inline comments that describe component behaviour (especially "already routes" /
"already handles" / "already gates X") are NOT proof of behaviour. They go stale
when the underlying code changes and nobody updates the comment. In `LeftSidebar.tsx`
on 2026-05-07, the comment above `<AccountDropdown />` said "the AccountDropdown
trigger below already routes to /me on click, and a duplicate row is redundant" —
but the underlying component opened a popover and never navigated.

Rule: when a comment claims behaviour that's load-bearing for the surrounding code
(i.e. it justifies removing or skipping something), verify the claim against the
actual implementation before relying on it. If the comment is right, leave it. If
it's wrong, fix EITHER the comment OR the code in the same commit — pick whichever
matches the founder's intent. Don't let a misleading comment compound: the next
reader will trust it the same way you almost did.

Sister rule to the "Brief asserts UI duplication — grep + read transports" rule —
inline comments are briefs from past selves. Same skepticism applies.

**JSDoc dispatch tables go stale the same way.** A page-level JSDoc that
documents "Routes:" or "Tab dispatch:" with arrows like `/c/:entityId/agents
→ AgentPage(rootAgent, tab="agents")` is also a load-bearing comment. When
the dispatch target's prop semantics change (`AgentPage` dropping its `tab`
prop in `e8305fc6`), the JSDoc still claims the prop is honored and the
fall-through code still passes it — silently rendering the wrong surface.
Treat JSDoc dispatch tables as code: when the target component changes
shape, every dispatch-table line that references it needs review in the
same commit. Cost (2026-05-09): `CompanyPage.tsx`'s JSDoc said "Every
other tab name (agents, events, quests, ideas) falls through to AgentPage,
which is the canonical primitive surface" — false since 2026-05-08, caused
the dispatch-hole bug.

## Dropping a prop creates dispatch holes at fall-through call sites

When a component is rewritten to drop a prop it used to honor (e.g.
`AgentPage` removing its `tab` switch in `e8305fc6` 2026-05-08), every
upstream dispatcher that still passes the prop becomes a silent no-op.
TypeScript doesn't catch this — the prop is still typed as optional, so
the call sites compile clean. The runtime symptom is an entire surface
rendering the component's _default_ shape instead of the
prop-discriminated branch, which can be subtle (default = chat header
with no body for AgentPage; the user sees "Agents" in the URL and gets
a chat surface labelled with the root agent's name).

Audit recipe whenever a prop is dropped from a component:

```bash
# Find every site that passes the dropped prop. Most will be the call
# sites you intentionally rewrote; the orphans are the dispatch holes.
DROPPED_COMPONENT="AgentPage"
DROPPED_PROP="tab"
grep -rn "<$DROPPED_COMPONENT" apps/ui/src/ | grep -E "$DROPPED_PROP=|tab=\{"
```

Each hit is either: (a) intentionally rewritten — confirm the call site
no longer relies on the prop, ideally remove the now-dead prop from the
JSX; or (b) a dispatch hole — the call site assumes the prop still
discriminates and is now silently broken. Fix by adding explicit branches
upstream of the rewritten component.

Sister pattern: when a child component drops a prop, the parent's
JSDoc dispatch table is almost certainly stale too — see "JSDoc
dispatch tables go stale the same way" above.

Cost (2026-05-09): `/c/<id>/agents`, `/me/agents`, `/c/<id>/events`,
`/c/<id>/quests`, `/c/<id>/ideas` (and the trust-route equivalents)
all fell through to `<AgentPage tab={tab}>` and rendered the root
agent's chat surface instead of their entity-scope LIST. Latent for
~24h after the AgentPage rewrite. The fix added explicit branches in
`CompanyPage.tsx` (mirroring `MePage.tsx`'s already-correct shape:
explicit per-primitive dispatch on rootAgentId).

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

## Renaming a tab / primitive — rename it in user-facing prose too

When renaming a tab label, primitive name, or any user-facing word
("Sessions" → "Inbox", "Position" → "Role", "Task" → "Quest"), the
brief usually names the obvious surfaces (the tab label array, the
search placeholder, the empty-state title). Always grep for the OLD
word in user-facing prose at the same time — empty-state hint copy,
banner messages, onboarding steps, error toasts, and any `<p>` /
`<span>` body content that mentions the renamed thing by name.

Recipe before declaring a rename done:

```bash
# Capital-S exact match catches user-facing copy; case-insensitive
# variant catches the lowercase prose that the brief also probably
# wants renamed.
OLD="Sessions"
grep -rn "\"$OLD\"" apps/ui/src/        # tab labels, button text
grep -rn "$OLD\b" apps/ui/src/components/ apps/ui/src/pages/  # prose
```

Filter the grep output: keep matches inside JSX text nodes, button
labels, placeholders, aria-labels, prose strings; skip type names,
ids, route paths, store keys, internal component names, code
comments, and Storybook story args (those are dev-only).

The fifth occurrence is the one you'll miss. Cost (2026-05-07):
sessions→inbox rename brief named four surfaces; audit grep surfaced
a fifth in `EmptyState.tsx` ("Sessions stay on Home") — extending the
scope was the right call but had to be made consciously rather than
caught by the brief. The grep takes 2 seconds; do it before commit.

**Tab `id` and `label` must rename together — half-renames ship a
misleading URL.** When a tab is renamed in user-facing copy (Sessions →
Inbox), the canonical move is to rename BOTH the `id` (which becomes
the URL segment) and the `label` (which renders in the rail). A common
shortcut is to rename only the label and leave the id stale — the rail
reads "Inbox" but clicking it navigates to `/c/<eid>/agents/<aid>/sessions`
and `tab === "sessions"` checks across the codebase keep working
unchanged. Looks fine in code review; ships a URL the user can't
explain. Caught by founder twice now (Position→Role 2026-05-02,
Sessions→Inbox 2026-05-07).

Rule: when renaming a tab, rename id AND label in the same commit, and
update every URL builder, redirect, document.title fallback, and the
specific routes test that mounts the path. The full sweep:

```bash
OLD_ID="sessions"
NEW_ID="inbox"
# tab definitions
grep -rn "id: \"$OLD_ID\"\|id:\"$OLD_ID\"" apps/ui/src/components/
# tab branching
grep -rn "tab === \"$OLD_ID\"\|=== \"$OLD_ID\"" apps/ui/src/
# URL builders + redirects
grep -rn "/$OLD_ID\b" apps/ui/src/lib/ apps/ui/src/components/
# default-tab fallbacks
grep -rn "|| \"$OLD_ID\"\|tab || \"$OLD_ID\"" apps/ui/src/
# tests pinning the path
grep -rn "/$OLD_ID" apps/ui/src/test/
```

Backward-compat: register a SPA replace-navigate from the OLD URL
shape to the new one (the closest thing to a 308 in a SPA) so any
existing bookmarks / shared links survive. Sessions→inbox kept
`tab === "sessions"` as a redirect handler in AppLayout that builds
the new URL and `<Navigate replace>`s to it.

## Deleting a route family — sweep doc comments + JSDoc in the same pass

When deleting a top-level route family (e.g. `/me/*` retired 2026-05-07),
the obvious work is the route definitions, page files, and direct
references. The non-obvious work is the doc comments scattered across
sibling primitive components ("`/me/inbox` mounts the same primitive…"),
JSDoc dispatch tables ("`/me/inbox → MePage`"), CSS section headers
(`/* /me/inbox and stub pages */`), and component-prop comments
("Override for `/me/inbox` where useNav doesn't yield…"). None of these
break the build or fail verify; all of them mislead the next reader.

Rule: before declaring the route deletion done, grep for the OLD URL
shape in comments AND prose AND CSS:

```bash
OLD_PREFIX="/me"
# JSDoc + inline comments + CSS section headers + prose strings
grep -rn "$OLD_PREFIX\b\|$OLD_PREFIX/" apps/ui/src/ | \
  grep -vE '\.test\.tsx|\.test\.ts'
```

Filter the grep output: keep matches in (a) JSDoc/inline comments, (b)
CSS section headers (`/* — /me/* — */`), (c) prose strings inside JSX
(any `<p>` / `<span>` body, banner copy, empty-state hints). Drop API
endpoint paths (`apiRequest("/me/passkeys/...")` are backend routes
under `/api/me/...` and stay until the backend rename). The fifth
occurrence is the one you'll miss.

Same shape as the "renaming" sweep above, but the discriminator is
deletion vs rename: deletion has no NEW URL to substitute — the right
edit is to either rewrite the comment to describe the new shape, or
delete the comment entirely if it was specific to the old URL family.

Cost (2026-05-07): drop-/me-routes ship — initial pass shipped clean
tsc + verify but left 8 stale doc-comment references across
AppLayout.tsx, AgentSessionView.tsx, ParticipantStrip.tsx,
AddParticipantModal.tsx, SessionsRail.tsx, CompanySwitcher.tsx,
Composer.tsx, pages.css, main.tsx. Caught the same ship cycle by
grep audit; ~3 min to sweep. Folding the audit into the deletion pass
costs zero extra time.

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

## Storybook stories with state — extract `render: () =>` into a real component

**Calling `useState` (or any hook) directly inside a Storybook
`render: () => { ... }` arrow fails eslint `react-hooks/rules-of-hooks`.**
The arrow is treated as a plain function, not a React component, so
the rule (correctly) flags every `useState` / `useEffect` / `useRef`
call inside it. Symptom during `npm run verify`:

```
React Hook "useState" is called in function "render" that is neither a
React function component nor a custom React Hook function.
```

Fix: lift each interactive story body into a named PascalCase component
declared at module scope, then call it from `render`. The component
gets a real React identity and the lint rule is satisfied:

```tsx
function ActiveQueryDemo() {
  const [q, setQ] = useState("aeiq");
  return <SessionsToolbar query={q} onQuery={setQ} searchPlaceholder="Search inbox" />;
}

export const ActiveQuery: Story = {
  name: "Active query",
  render: () => <ActiveQueryDemo />,
};
```

This is the canonical shape for any story that needs `useState` (controlled
inputs, popover-open demos, hover-state stubs). Anonymous arrow `render`
is fine ONLY for stories with no hooks. Cost (2026-05-07): one verify
loop on `SessionsToolbar.stories.tsx` before extracting the three demo
components.

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

**`--font-size-md` is a ghost token — not in the canonical scale.**
The `--font-size-*` scale runs `3xs / 2xs / xs / sm / base / lg / xl / 2xl / 3xl / 4xl
/ 5xl` (see `packages/tokens/src/tokens.css`). There is no `md` step. Pages that
reference `var(--font-size-md)` silently inherit the parent's computed size — no
warning, no compile error, the value just doesn't apply. Fix: pick the closest scale
neighbour by visual intent — body/lede copy → `--font-size-base` (14px); body slightly
larger → `--font-size-lg` (16px). Cost (2026-05-07): discovered in `economy-hero-lede`
during route audit; one substitution, no production miss because parent inheritance
landed on a similar size. Grep: `grep -rn 'var(--font-size-md)' src/` should return
zero. Add to the same v3-sweep grep family.

**Parallel-authored sibling pages share token drift — sweep both at once.**
When two pages are co-authored as visual siblings (`StudioPage` + `EconomyPage`,
both rendering the same hero strip pattern with eyebrow + display title + lede), they
tend to carry identical hardcoded literals (10px eyebrow, 40px display title, 11px
section-title) bypassing the token scale on the same authoring pass. A token sweep
that targets one file should grep the sibling file too — same class-prefix family
(`.studio-*` / `.economy-*`) with the same shape signals parallel authoring. Cost
(2026-05-07): studio.css carried 5 hardcoded font-size literals; economy.css carried
the same parallel set (10px / 40px / 11px). Future sweep should hit both.

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

**Token-existence audit — verify EVERY new `var(--*)` resolves before commit.**
Sister rule to the broken-aliases findings above. When authoring new CSS,
the natural failure mode is using a token name that "should exist by symmetry"
but doesn't. Three classes of trap, all silent:

1. **Sibling-of-an-alias hallucination.** `--bg-subtle` exists in `primitives.css`
   line 59; `--bg-hover` does NOT. Other dashboard CSS uses `var(--bg-hover)`
   already — but that's a long-standing silent no-op, not a license to repeat
   it. Canonical hover-background token is `--state-hover` (line 72) or
   `--color-hover` (tokens.css line 147).
2. **Canonical-name mismatch.** `--color-error` exists; `--color-danger` does
   NOT, even though "danger" is the more common React-ecosystem name. Always
   grep before reaching for an intuitive name.
3. **Namespace overlap.** Background aliases use `--bg-*` (`--bg-subtle`,
   `--bg-row`, `--bg-surface`); the `--color-bg-*` namespace does NOT exist.
   This is in the MVP charter at the top of this file but recurs anyway —
   the unprefixed `--bg-*` is the canonical form for backgrounds.

Recipe before commit: extract every `var(--*)` reference from the new CSS,
then confirm each is defined somewhere:

```bash
TOKENS=$(grep -oE 'var\(--[a-z0-9-]+' apps/ui/src/styles/<new-file>.css | sed 's/var(//' | sort -u)
for t in $TOKENS; do
  if ! grep -qE "^\s*${t}:" apps/ui/src/styles/primitives.css packages/tokens/src/tokens.css; then
    echo "MISSING: $t"
  fi
done
```

Any line printing `MISSING:` is either a typo, a hallucinated sibling
(`--color-danger` instead of `--color-error`), or a namespace mistake
(`--color-bg-subtle` instead of `--bg-subtle`). Fix BEFORE running tsc —
prettier, tsc, eslint, and the vite build all pass on undefined tokens
because CSS is not type-checked. Cost (2026-05-07): three edit passes
on company-overview-redesign before catching `--bg-hover`,
`--color-danger`, and `--color-bg-subtle` were all hallucinated.

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

**Roles + Agents list views — both FLAT. No depth indent, no DFS, no section headers.**
`RolesList` and `AgentsList` (Roles / Agents tab list views) are flat
tables. No `paddingLeft: depth * N` on the title cell, no pre-order DFS,
no `ROLE_TYPE_ORDER` section-header loop, no `buildAgentTreeData` /
`preorderByType`. The depth-indent shipped on RolesList (2026-05-06) and
AgentsList (2026-05-06 task #164) were both reverted by founder direction:
hierarchy is a chart concern; the list view is a normal table. Sort order
comes from the toolbar selector (recent / alpha / activity / spend) or a
default bucket-by-type sort (`director` → `operational` → `advisor`).
Do not reintroduce indent or DFS.

Both list views render through the canonical `<Table>` primitive
(`components/ui/Table.tsx`) — real `<table>` semantics, columns drive
both header and cells via `<col>` widths so alignment is browser-enforced.
Don't fork; extend Table via columns/density. Cost (2026-05-08): roles
list shipped without column-aligned cells (grid-template-columns drift
between head + row); fixed by migrating to the Table primitive.

CSS classes that are gone and must NOT be added back:
`.roles-chart-dept-cluster`, `.roles-chart-dept-root`, `.roles-chart-ceo-row`,
`.roles-chart-dept-row`, `.roles-chart-dept-label`.

## Channels are an agent-rail primitive only — never a Company-tier surface

**`AgentChannelsTab` (transport channels per agent — Telegram / WhatsApp /
Slack-app / etc.) is the only channels surface in the product.** A
Company-scoped Slack-style channels surface (`/c/<id>/channels` /
`/trust/<addr>/channels`, Multi-participant scope-bound sessions) was
shipped briefly 2026-05-07 (commit `e2ce3cb0`) and reverted same day by
founder direction ("channels are just on an agent itself like we already
got prior"). The reverted set:

- `pages/ChannelsListPage.tsx`, `pages/ChannelDetailPage.tsx`
- `components/channels/ChannelComposer.tsx`, `components/channels/NewChannelModal.tsx`
- `api/conversation-channels.ts`
- `conversationChannelKeys` in `queries/keys.ts`
- `.channels-list*` rules tied to the company surface (kept the AgentChannelsTab variants)
- the `Channels` tab in the Company rail (LeftSidebar Organization zone)
- the `channels` entry in `COMPANY_PAGE_TABS` and the CompanyPage dispatch branch

Do not reintroduce any of these. Multi-participant Sessions are a primitive
already (`architecture_session_primitive.md`) — they're not "channels," and
they don't deserve a rail tab. If a future ship asks for "company channels,"
the answer is no: the founder already considered and rejected that surface.

## New view component — every className must have CSS, not just compile

**A new view component (Table view, Kanban view, Graph view, etc.) is not
"done" when tsc passes — it's done when every className it references has a
matching rule in `src/styles/`.** TypeScript and prettier do not catch
missing CSS: a `<table className="ideas-table">` with no `.ideas-table { … }`
rule renders as a bare HTML table that collapses to its content's natural
height (~250px), even though the surrounding container is full-bleed. The
component compiles, the build is green, the surface ships looking broken.

Cost (2026-05-08): Tables-in-Ideas Phase 2 (`140c1357`) shipped 14
`.ideas-table-*` selectors with zero CSS. UX walk v24 caught it; one extra
ship cycle to add the wrap + table + header + cell + row rules.

Rule: after writing any new view component, grep every className it
references against `src/styles/`:

```bash
# Extract classNames from the new component
grep -oE 'className="[^"]+"' src/components/<NewView>.tsx \
  | sed 's/className="//; s/"$//' | tr ' ' '\n' | sort -u > /tmp/new-classes.txt

# Confirm each one resolves to a CSS rule somewhere
for c in $(cat /tmp/new-classes.txt); do
  count=$(grep -c "\\.$c" src/styles/*.css | awk -F: '{s+=$2} END {print s}')
  [ "$count" = "0" ] && echo "MISSING: .$c"
done
```

Any line printing `MISSING:` means the rule is absent and the surface
will render broken. Fix BEFORE tsc — not after a UX walk catches it.

## Public routes mount `<GatedAppShell />` directly — never `<Navigate>` to `/`

**Routes that should resolve as the in-shell app for both unauth AND authed
users (e.g. `/economy`, `/blueprints`, future public surfaces) must mount
`<GatedAppShell />` directly. Do NOT redirect them to `/` via `<Navigate>`
expecting AppLayout to dispatch the right surface.** The `/` root is also
the auth-mode dispatch point: `RootRouteSwitch` redirects authed users to
`/me/inbox` (their daily-action surface). A `<Navigate from="/economy"
to="/" />` collapses through that dispatch and lands authed users on the
inbox — the public surface they asked for never renders.

Cost (2026-05-08): UX walk v24 — `/economy` was wired with `<Navigate to="/"
replace />` "to keep one canonical URL". Authed visitors hit `/economy`,
got bounced to `/`, then bounced again to `/me/inbox`. Fixed by mounting
`/economy` and `/economy/*` as `<GatedAppShell />` (same pattern as
`/blueprints`); AppLayout's `useShellSurface` already treats `/` and
`/economy` as the same `isEconomy` flag, so EconomyPage renders in both
auth states.

Rule: if a route is meant to be a public-surface alias of `/`, mount it
through `<GatedAppShell />` (or `<RootRouteSwitch />` if it should also
honor the authed inbox-redirect). Never via `<Navigate to="/" />` — that
short-circuits the auth dispatch.

## Probe scripts on inbox surfaces — scope to a populated inbox, not `/me/inbox`

When writing a playwright probe to verify the inbox composer / detail
shape, do NOT default to `/me/inbox`. The personal entity's inbox is
empty in dev for most users (no agent has seeded it), so `SessionRail`
renders the empty state, no row exists to click, no detail mounts, no
composer enters the DOM, and every probe returning `hasComposer: false`
looks like a regression when it's just "nothing to verify against."

The canonical "populated" inbox in dev is the AEIQ company's trust inbox,
where the EA has seeded a "AEIQ is live on aeqi" decision-request:

```js
const AEIQ_TRUST = "0x4a9221095d6863f068d1543fc7995c25347b4edc";
// Probe URL: `/trust/${AEIQ_TRUST}/inbox`
```

Same primitive (`MeInboxPage`/`InboxComposer`/`SessionRail`), different
scope. Use this URL for any chat-shape / composer / row-shape verification
probe until /me/inbox has a default seeded message. Cost (2026-05-07):
one probe iteration on inbox-visual-parity ship returned all-null because
/me/inbox was empty — wasted ~30s before re-scoping to `/trust/<aeiq>/inbox`.

**Same rule for verifying message-bubble shape: target a session known to
contain the bubble kind you're verifying.** When a probe needs to confirm
user-bubble layout (avatar + name on right) OR agent-bubble layout
(avatar + name on left), opening any agent's first session is not enough —
many AEIQ sessions are agent-only (`schedule:daily-digest`, `Permanent
Session`, fresh-spawn DM with no user reply yet). The probe will report
`userBubble=0` or `agentBubble=0` even though the surface is rendering
correctly; the data simply isn't there.

Recipe to find a session with both bubble kinds:

```bash
sudo -n sqlite3 /var/lib/aeqi/containers/<entity_id>/sessions.db \
  "SELECT s.id, s.name, COUNT(m.id) as msgs
   FROM sessions s JOIN session_messages m ON m.session_id=s.id
   WHERE m.role='user' OR m.from_kind='user'
   GROUP BY s.id ORDER BY msgs DESC LIMIT 5;"
```

Pick a session with `msgs >= 1`. Known-good seed for the AEIQ EA agent on
the platform host (entity `59bc9fd3-956a-4104-aaf8-83253fde840c`):
session `cedd5876-ba0e-4d94-b720-6b8f608aa5ba` ("aeiq EA") had 4 user
messages as of 2026-05-07. Cost (2026-05-07): first verify run for the
multi-participant ship picked `Permanent Session` (zero user messages);
detector reported `userBubble=0` and the verify looked broken — required
a second probe scoped to `cedd5876…` to capture the user bubble.

## Probe scripts at narrow viewports — `force: true` on offscreen master rows

At <=1024px the inbox + agent surfaces collapse from master/detail to
single-pane: the rail is laid out under the detail pane and is technically
in the DOM but `getBoundingClientRect` reports it offscreen. Plain
`page.locator(".sessions-rail-row").click()` waits 30s for visibility,
then throws `TimeoutError: element is not visible`. Use `{ force: true,
timeout: 5000 }` on probe scripts that need to traverse the rail at
narrow viewports — the probe is verifying DOM shape, not user-driven
visibility.

```js
await firstRow.click({ force: true, timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);
```

Wraps in `.catch(() => {})` so the probe continues even if the click
fails for a reason that's irrelevant to the verification (e.g. rail
empty, layout race). Cost (2026-05-07): one 30s timeout pass on
inbox-visual-parity probe before switching to force-click.

## Probe scripts can't reach drilled-agent surfaces — verify via /me/inbox + bundle scan

The drilled-agent route `/c/<entity>/agents/<agent>/sessions/<session>/`
does not render reliably in headless playwright probes. Symptom: page
sticks on the AEIQ logo splash; `.sessions-rail` / `.page-rail-link`
selectors never appear; daemon-store fetch chain emits HTTP 400s in the
console. Same trap hit on `/trust/<address>/inbox` — both routes need
the daemon-store entity-scoped fetchAll to settle, which doesn't in
mock-JWT contexts. The prior `_rail-search-verify.mjs` (v28 walk) and
the fresh `_sessions-to-inbox-verify.mjs` (sessions→inbox rename ship)
both exhibit this — it's a route-level limitation, not a probe bug.

Verification recipe for any rail / inbox / SessionRail copy change:

1. **`/me/inbox` headless screenshot** — DOES render reliably. The
   personal-entity rail mounts on the user-scope endpoint set, no
   X-Entity gate, no 400 chain. Use this as the canonical visual
   capture for SessionRail placeholder / aria-label / empty-state
   copy.
2. **Live bundle source-string scan** — for the agent-surface copy
   (tab labels, drilled-agent emptyTitle, etc.) that doesn't render
   in headless, scan the shipped JS chunk directly:

   ```bash
   curl -sL https://app.aeqi.ai/ -o /tmp/live.html
   for f in $(grep -oE 'assets/[A-Za-z][A-Za-z0-9_-]+\.js' /tmp/live.html | sort -u); do
     RES=$(curl -sL "https://app.aeqi.ai/$f" | grep -oE '<expected-string>|<old-string>' | sort | uniq -c)
     [ -n "$RES" ] && echo "$f: $RES"
   done
   ```

   Source-side proof that the new strings are in the live bundle and
   the old strings are absent is a stronger signal than a stuck headless
   render. Combine with the `/me/inbox` screenshot for the visual.

   **`index.html` only enumerates the eager chunks. Lazy route chunks
   (`MeInboxPage-XXX.js`, `AgentSessionView-XXX.js`, every dynamic
   import) are referenced from INSIDE `assets/index-XXX.js`, not from
   the HTML.** A grep that scans only top-level chunks returns 0
   matches for any string that lives in a lazy-loaded route component
   — which looks identical to "the ship didn't take" but is actually
   "you didn't search the chunk that holds the string". Recipe to
   walk dynamic imports too:

   ```bash
   INDEX_JS=$(grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' /tmp/live.html | head -1)
   curl -sL "https://app.aeqi.ai/$INDEX_JS" -o /tmp/index.js
   for f in $(grep -oE 'assets/[A-Za-z][A-Za-z0-9_-]+\.js' /tmp/index.js | sort -u); do
     C=$(curl -sL "https://app.aeqi.ai/$f" | grep -c "<expected-string>")
     [ "$C" -gt "0" ] && echo "$f: $C"
   done
   ```

   Combine both passes — top-level chunks from `index.html` AND
   lazy chunks from `index.js` — for full coverage. Cost (2026-05-07):
   `Search inbox` placeholder shipped in `MeInboxPage-DZjC7hLr.js`;
   the top-level scan returned 0 matches and looked like a regression
   until the dynamic-import descent surfaced it.

Don't burn time iterating wait strategies / route alternatives on the
drilled-agent route. Two ship cycles have hit it now (rail-search-v28
ship, sessions-to-inbox ship); pattern is locked. Cost (2026-05-07):
~3 min on sessions-to-inbox ship trying longer waits + alternate URLs
before falling back to the bundle-scan recipe.

## SessionRail row shape — single-line everywhere (locked 2026-05-07)

`<SessionRail>` (`components/sessions/SessionRail.tsx`) still accepts
both single-line (h=32) and wrap-to-2-lines (h=51) row shapes via the
`wrapPrimary?: boolean` prop on each `SessionRailRow` — but **both
shipped adopters render single-line**. Visual parity between the inbox
and the agent surface is the locked direction; row shape is one
canonical h=32 across both.

- **`shell/SessionsRail.tsx`** (drilled-agent surface) — does NOT set
  `wrapPrimary` or `secondary`. The previous origin-driven two-line
  shape (`deriveOrigin` + `wrapPrimary: !!origin`) was removed
  2026-05-07 (parity-v2 ship). Origin (telegram / whatsapp / web) lives
  on the session detail header where it doesn't compete with the row
  primary.
- **`pages/MeInboxPage.tsx`** (inbox surface) — does NOT set `wrapPrimary`
  or `secondary`. Sender name lives in the right-pane detail header.

Rule: any future adopter (channels, mentions, etc.) gets the same
single-line row by default. Do NOT reintroduce `wrapPrimary` /
`secondary` on existing adopters without an explicit founder-locked
direction — they ship inverted of the visual parity contract. The
`wrapPrimary` prop stays on the primitive's API as escape hatch only;
new shapes must be argued for, not opted into.

## Composer + rail "visual parity" claims need variant inspection, not just primitive identity

When a brief or memo claims two surfaces are "visually identical" because
they consume the same primitive, that claim is FALSE if the variant prop
differs. `<Composer variant="card">` (light card chrome on a paper
surface, `--color-card-subtle` background) and `<Composer variant="shell">`
(dark embedded chrome with `.composer-wrap` overrides cascading
`--color-ink-card` palette) render with completely different palettes,
padding, send-button treatment, and ribbon visibility — even though both
mount the same `<Composer>` primitive.

Same trap: `<SessionRailRow>` rendered with `wrapPrimary: true` (h=51,
two-line) vs `wrapPrimary: false` (h=32, single-line) look entirely
different side-by-side, even though both are the same primitive.

Rule: when verifying visual parity, ALWAYS read the variant prop and
the `secondary` / `wrapPrimary` data flags at every adopter. A side-by-
side screenshot at 1440px is the ground truth; a "they both use Composer"
or "they both use SessionRail" comment is not. Cost (2026-05-07):
parity-v2 ship — first inbox-parity ship (8b573d86) shipped
`variant="card"` + a comment asserting parity, founder caught the
divergence, parity-v2 fixed it. Verify variant + computed
`backgroundColor` of `.composer-wrap` (or equivalent) before claiming
done.

## "Unify these surfaces" briefs — opt-out prop, not divergent render path

When a brief asks to extract a primitive that some adopters compose
differently (e.g. one adopter mounts a sub-primitive externally — like
the agent surface mounting `<Composer>` in `AppLayout`'s chrome via
event bridge, while the inbox surface mounts it inline), the seam is an
**opt-out prop on the new primitive**, NOT two render paths or a
"composer slot" abstraction. Pattern: ship `hideComposer?: boolean` (or
`hideX?: boolean` for the externally-mounted sub-primitive); the inline
adopters default `false` and get the canonical chrome; the externally-
mounted adopter sets `true` and the primitive renders everything else
identically. The migration of the externally-mounted surface (move
chrome from AppLayout into the surface, then flip `hideX` to `false`)
becomes a separate ship with explicit scope.

Why this shape and not the inverse: the canonical state is "primitive
owns the full chrome" — that's what the brief is collapsing to. Adopters
that violate it carry an opt-out, not the other way around. New adopters
get the right shape by default; legacy externally-mounted adopters carry
a marked-deprecated flag and a clear migration path. Don't ship a
`composerSlot?: ReactNode` prop that lets every adopter mount whatever
chrome they want — that re-introduces the divergent render paths the
extraction was meant to eliminate.

When the brief mandates the agent half but says "don't ship a partial,"
honor the escape clause: ship the inline-adopter half with the opt-out
prop, write the analysis the brief asks for explaining why the
externally-mounted half is a separate ship (specific risk: AppLayout
chrome touches `/start` + type-anywhere + focus/set-input event bridge,
all out of scope), and queue the migration ship with an explicit
contract (move chrome → flip prop). Cost (2026-05-07): SessionDetail
extract — ~5 min upfront figuring out the opt-out vs slot vs
divergent-path tradeoff before settling on opt-out.

**Per-message handlers extend the same way: optional callback props,
not a render-prop slot.** When the migration ship of an
externally-mounted adopter (e.g. `AgentSessionView` adopting
`SessionDetail`) needs surface-specific per-message affordances
(fork / edit / resend on chat bubbles, archive on inbox rows), the
canonical seam is OPTIONAL callback props on the primitive that get
threaded into the existing per-row component (e.g. `MessageItem`):
`onFork?: (messageId: number) => void`, `onEdit?: (messageId: number,
text: string) => void`, `onResend?: (text: string) => void`. Adopters
that need the affordance pass the handler; adopters that don't omit
the prop and the bubble silently renders without it (the inbox surface
doesn't expose fork/edit/resend, agent surface does — same `MessageItem`,
different prop set). Same pattern for "render this extra block at the
end of the thread" concerns (StreamingMessage, queued drafts):
`threadTrailingSlot?: React.ReactNode` is the canonical name. Do NOT
ship a `renderMessage?: (msg) => ReactNode` render-prop — that's the
divergent render path under a different name. The prop set should always
be data-shaped (callbacks + named slots), not behaviour-shaped (render
props). Cost (2026-05-07): AgentSessionView migration ship — initial
draft considered a `renderMessage` render-prop; the named callbacks +
trailing slot kept the primitive's contract narrow and was strictly
cheaper to verify.

## Probe scripts must seed the canonical localStorage triple — not just the JWT

Auth-seeding probe scripts (the `_<name>.mjs` family) set localStorage
in `ctx.addInitScript(...)` before the SPA boots. The canonical key
set is `aeqi_token` + `aeqi_app_mode` + `aeqi_auth_mode` — read by
`apps/ui/src/store/auth.ts` lines 84–86. Setting only `aeqi_token`
(or worse, `aeqi_jwt` — never used) leaves the auth store in
unauthenticated mode and every probe returns null DOM measurements.

Canonical probe seed (drop into every new `_*.mjs`):

```js
await ctx.addInitScript((token) => {
  window.localStorage.setItem("aeqi_token", token);
  window.localStorage.setItem("aeqi_app_mode", "runtime");
  window.localStorage.setItem("aeqi_auth_mode", "accounts");
}, TOKEN);
```

Cost (2026-05-07): one full probe re-run on parity-v2 verification when
the seed only set `aeqi_jwt`. ~30s wasted; pattern will recur every
new probe script.

## Headless playwright probes — `/api/entities` returns 400 "user_id required" even with valid JWT

`GET /api/entities` works via cli `curl -H "Authorization: Bearer <token>"`
but returns HTTP 400 `"user_id required"` when the same JWT is sent from
a headless browser context. The auth gate behaves differently for the
two transports — likely the platform reads `user_id` from a session
cookie or header that cli curl emits but headless playwright does not.
Symptom in the probe: SPA boots to the loading splash (just the `æ`
wordmark), `/api/auth/me` returns 200, `/api/entities` returns 400, the
daemon store stays in pre-loaded state, and every DOM query returns
empty. Visual verification of any in-shell route (session, inbox,
agents, etc.) is BLOCKED.

When this happens, do NOT try to debug the probe — the auth-gate gap
is platform-side and out of UI scope. Fall back to bundle-level
verification:

```bash
# 1. Confirm the new code is in the live JS bundle
curl -sL "https://app.aeqi.ai/assets/<lazy-chunk>.js" -o /tmp/live.js
grep -c "<your-new-className-or-string>" /tmp/live.js   # should be ≥1

# 2. Confirm the new CSS rules made it to the live stylesheet
curl -sL "https://app.aeqi.ai/assets/<index-hash>.css" -o /tmp/live.css
grep -oE '\.<your-new-class>[^{]*\{[^}]*\}' /tmp/live.css

# 3. Confirm the live JS hash differs from the prior ship
curl -sL https://app.aeqi.ai/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1
```

Three green signals = ship is durable, only the visual screenshot is
deferred. Save a `<feature>-VERIFIED-bundle.txt` artifact under
`.observations/<walk>/` capturing the curl outputs so the brief's
verification ask is fulfilled in lieu of the screenshot. Do NOT spend
more than ~30s diagnosing the auth-gate failure — the SAME failure
recurs on every headless probe attempt and the fix lives outside UI.

Cost (2026-05-07): msg-author-header ship — 4 probe iterations
(~5 min) before reaching the bundle-level fallback. Future ships
should skip straight to bundle verification when `/api/entities`
returns 400 in the network log.

## Entity URLs — always go through `entityPath()`, never hand-craft `/c/<id>`

**Internal links to a Company entity must resolve through
`entityPath(entity, ...)` or `entityPathFromId(entities, id, ...)`
from `@/lib/entityPath`.** The helpers return `/trust/<addr>` when the
entity has a `trust_address` (post-registerTRUST canonical) and fall
back to `/c/<id>` only when the entity is still pending. Hand-crafted
template literals (`` `/c/${entityId}/quests` ``, `"/c/" + id`) bypass
that resolution and ship the legacy URL even when the entity is
on-chain.

Same rule for sessions: use `sessionDeepUrl(entity, agentId, sessionId)`
or `sessionDeepUrlFromId(entities, entityId, agentId, sessionId)` —
never build the deep URL by string concatenation.

The hygiene-check enforces this. Allowed call sites: `lib/entityPath.ts`
(the helper itself), `lib/sessionUrl.ts`, `hooks/useNav.ts`,
`components/AppLayout.tsx` (the canonical fallback). Tests under
`src/test/` are exempted (they pin the URL shape on purpose).

The 308 redirect from `/c/<id>` → `/trust/<addr>` stays in place
server-side for old bookmarks. Pre-registerTRUST entities still land
on `/c/<id>` as the transient fallback. The rule is purely about not
GENERATING the legacy form for on-chain entities. Cost (2026-05-07):
44 literals swept across 28 files; hygiene rule prevents recurrence.

## Agent-scoped navigation needs both entity AND agent — `goEntity` only resolves entity-scope

**`goEntity(entityId, tab, itemId)` from `useNav` builds `/c/<eid>/<tab>/<itemId>`
— two URL levels, ENTITY-scope only.** It cannot express agent-scoped URLs like
`/c/<eid>/agents/<aid>/inbox/<sid>` (four levels). When a hook or component is
agent-scoped (it has `agentId` in its closure), reaching for `goEntity` to
navigate silently strips the agent from the URL.

Specifically: a `setSession(sid)` helper inside an agent-scoped session manager
that does `goEntity(entityId, "inbox", sid)` produces `/c/<eid>/inbox/<sid>` —
the COMPANY INBOX URL — not `/c/<eid>/agents/<aid>/inbox/<sid>`. Same shape on
`setSession(null)` → `goEntity(entityId)` produces `/c/<eid>` (company bare),
losing the agent context entirely. The bug compiles cleanly, type-checks, and
runs without errors; the user just lands on a different surface than intended.

Canonical helpers for agent-scoped navigation (use these, NOT `goEntity`):

- Session URL: `sessionDeepUrlFromId(entities, entityId, agentId, sessionId)` →
  `/c/<eid>/agents/<aid>/inbox/<sid>` (or `/trust/<addr>/agents/<aid>/inbox/<sid>`).
  This is what `shell/SessionsRail.tsx` uses on row click.
- Agent-bare URL (no session selected, chat-as-default empty state):
  `entityPathFromId(entities, entityId, "agents", agentId)` →
  `/c/<eid>/agents/<aid>`. The `entityPath`/`entityPathFromId` helpers accept
  N segments via rest args, so they can express any depth.

Rule: when the call site has BOTH `entityId` AND `agentId` in scope, default to
`entityPathFromId(entities, entityId, ...segments)` or the matching purpose-
specific helper (`sessionDeepUrlFromId` for session URLs). `goEntity` from
`useNav` is for ENTITY-scope tabs (inbox / agents-list / quests-list / ...) —
not for drilling INTO an agent. Cost (2026-05-07): + New button on agent
header navigated to company inbox instead of resetting the agent's chat surface
to empty — the `setSession(null)` helper inside `useSessionManager` was using
`goEntity(entityId, undefined, undefined)` which strips both tab and itemId
but ALSO has no slot for the agentId. Required reading the rail's click
handler to discover the canonical agent-scoped helper already exists.

## Adding a new sub-tree to a `:tab/:itemId` route — use a literal segment, not a third param level

When extending an existing `agents/:agentId/:tab/:itemId` route shape with
a deeper sub-surface (e.g. `agents/:agentId/settings/:settingsTab[/:itemId]`),
the route definition needs an EXPLICIT literal segment for the sub-tree —
do NOT try to overload `:tab` to mean both "regular tab" and "container
for sub-tabs":

```tsx
// In App.tsx — explicit literal "settings" branch, distinct param name
<Route path="agents/:agentId" element={null}>
  <Route index element={null} />
  <Route path="settings" element={null} />
  <Route path="settings/:settingsTab" element={null} />
  <Route path="settings/:settingsTab/:itemId" element={null} />
  <Route path=":tab" element={null} />
  <Route path=":tab/:itemId" element={null} />
</Route>
```

Two follow-on rules:

1. **Use a distinct param name** (`settingsTab`, not another `tab`). React
   Router's `useParams` returns params from the matched route only; if the
   sub-tree's param shadows the outer `:tab`, downstream redirects that
   key off `tab === "<oldname>"` silently never fire.

2. **Detect the sub-surface via path regex, not via `useParams`.** When the
   route is `agents/:agentId/settings/:settingsTab`, the OUTER `:tab` is
   undefined — `useParams.tab` returns nothing. Code that wants to know
   "are we on the settings sub-surface?" must read `location.pathname`
   directly. Pattern in `AppLayout.tsx`:

   ```ts
   const agentSettingsSegment = (() => {
     if (!routeAgentId) return false;
     const re = /\/agents\/[^/]+\/(settings)(?:\/|$)/;
     return re.test(path);
   })();
   ```

React Router resolves static segments before parameters, so the literal
`settings` branch wins over `:tab` when the URL is `/agents/<id>/settings`
— no order-dependent ambiguity. Don't try to disambiguate with route
ordering alone; use a distinct literal + a path-regex detector.

Cost (2026-05-07): ~3 min on the agent-shape-redesign ship before
settling on the path-regex detector. Without it, the chat-vs-settings
dispatch is impossible to express from `useParams` alone.
