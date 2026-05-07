# App Information Architecture & Public Surfaces

**Status:** Decided 2026-05-03.
**Companion to:** `wallet-architecture.md` (the architectural spec) and `wallet-architecture-faq.md` (the deep-dive Q&A).
**Purpose:** lock the URL structure, public surfaces, vertical nav, Economy taxonomy, Blueprints scope, and authenticated workspace IA. Companion docs cover the wallet/Entity model; this doc covers what the user navigates.

---

## Headline decisions

1. **`/` is the Economy front door.** Default view = Discover. Public, no auth required.
2. **Inbox moves from `/` to `/me/inbox`.** It's user-scoped; lives under the user's personal Company.
3. **Left vertical nav within `/`.** Surfaces all Economy verticals (Discover, Companies, Agents, Bounties, etc.) one click away.
4. **Blueprints reserved for full Company templates only.** Single agents/quests/ideas are NOT Blueprints — they live in their own surfaces (`/agents`, etc.) with appropriate naming (personas, templates, recipes).
5. **Logged-in default landing = `/` (the Economy)**, not `/me`. Their Company workspace is one click from the avatar.
6. **`/me` and `/c/{slug}` are workspace surfaces.** Personal Company at `/me`, joint Companies at `/c/{slug}`.

---

## URL structure (full)

### Public Economy surfaces (no auth required)

```
/                  → Discover (Economy front door, default view)
/companies         → Companies directory (browse all opt-public Entities)
/agents            → Agent marketplace (browse + hire)
/bounties          → Bounty board (one-off tasks)
/services          → Services marketplace (recurring offers)
/roles             → Open positions across all Companies (v2)
/funding           → Companies raising capital (v2)
/data              → Data / report marketplaces (v2)
/markets           → Trading / prediction markets (v2+)
/blueprints        → Company Blueprints (full deployable templates)
/c/{slug}          → A specific public Company's page
/u/{slug}          → A public personal profile (opt-in)
/entity/0x{addr}   → Canonical address-based view (any Entity)
```

### Authenticated workspace surfaces (logged in)

```
/me                → Your personal Company dashboard (default tab: Inbox)
/me/inbox          → Aggregated inbox across all your Companies
/me/portfolio      → Your equity holdings across all Companies
/me/settings       → Account-level settings (email, passkeys, billing, profile)
/me/agents         → Your personal Company's agents
/me/treasury       → Your personal Company's treasury
/c/{slug}          → A joint Company you're a member of (member view)
/c/{slug}/inbox    → That Company's inbox (Company-scoped)
/c/{slug}/...      → Other tabs (Roles, Ownership, Treasury, Governance, Settings)
```

### Auth gates

- All `/me/*` and `/c/{slug}/*` (member view) require auth
- All public surfaces (`/`, `/companies`, `/agents`, etc.) work logged-out
- Public Entity pages (`/c/{slug}`, `/u/{slug}`, `/entity/0x...`) work logged-out for opt-public Entities
- CTAs on public surfaces gate at action time ("Sign up to hire this agent")

---

## Discover (`/`) — what's actually on it

The Economy in one curated, scrollable surface. Editorial + algorithmic.

| Section | Content |
|---|---|
| **Pulse** | Today's economy stats — $X transacted, N companies live, M agents active, etc. One-line vital signs. |
| **Featured** | Editor's pick — 3-5 standout Companies/agents/blueprints this week |
| **Just deployed** | Newest Companies (last 24h) |
| **Most active agents** | Agents with the most marketplace activity recently |
| **Hot bounties** | Top open bounties by value or visibility |
| **Trending blueprints** | Most-deployed Company templates this week (links into `/blueprints`) |
| **Live ticker** | Real-time feed of recent on-chain moments — deployments, big transactions, governance votes, new hires |
| **Categories** | Visual entry into `/companies`, `/agents`, `/bounties`, etc. |

### Logged-in personalization layer

Same `/` URL, conditionally enriched:

- "Companies you follow" strip
- "Bounties matching your skills" strip
- "Activity from your Companies" strip
- "Agents you've hired recently" strip

The base public layer remains. Personalization is additive.

---

## Left vertical nav at `/`

```
ECONOMY                          (always visible)
  Discover              ← /
  Companies             ← /companies
  Agents                ← /agents
  Bounties              ← /bounties
  Services              ← /services       (MVP fold-in: filter under /agents)
  Roles                 ← /roles          (v2 — fold under /companies for MVP)
  Funding               ← /funding        (v2)
  Data                  ← /data           (v2)
  Markets               ← /markets        (v2+)

DEPLOY                           (separate intent — full Companies)
  Blueprints            ← /blueprints

YOUR STUFF                       (logged in only)
  [avatar] You          ← /me
  ⬡ Companies          (list of joint Companies)
    ⬡ ACME Corp        ← /c/acme
    ⬡ Side Project     ← /c/side-project
  + New Company
```

### MVP vertical set (lean)

Ship at MVP:
- Discover
- Companies
- Agents
- Bounties
- Blueprints
- Your Stuff

Defer to v2:
- Services (fold into Agents as a filter for MVP)
- Roles (fold into Companies as a filter for MVP)
- Funding
- Data
- Markets

Six items in left nav at MVP. Easy to navigate, room to grow.

### Why vertical, not top

- More categories visible at once (8-10 vs 5-6 horizontal)
- Easier to add/remove without redesigning the bar
- Persistent during scroll
- Matches user expectation for an "economy" surface (Reddit, Discord, Bloomberg)
- Leaves the top bar for: search, notifications, avatar, global controls

Top nav still exists for global controls (logo, search, inbox bell, avatar dropdown). Left nav handles category navigation.

---

## Top bar (global, on every page)

```
[aeqi logo]   [search...]                          [🔔 inbox]  [avatar ▼]
```

- **Logo:** clicks back to `/` (Discover)
- **Search:** searches across Companies, agents, bounties (full-text + filters)
- **Inbox bell:** badge for unread; clicks to `/me/inbox`
- **Avatar:** dropdown — Your account (`/me`), Settings (`/me/settings`), Sign out

---

## Each vertical's sub-nav (within deep view)

Example for `/agents`:

```
LEFT NAV (replaces Economy nav when in deep view):
  All agents              [agent listings — content area]
  Trending
  By category:
    Research
    Code
    Marketing
    Ops
    Design
    Other
  By price
  By reputation
  
  ─────
  My hires (logged in)
  Saved agents
  
  ← Back to Economy
```

Same pattern for Companies, Bounties, Blueprints — left nav switches to vertical-specific filters/views, with a "Back to Economy" link to return to the main left nav.

---

## Personal Company workspace (`/me`)

When logged-in user clicks their avatar → "Your account," they land at `/me`. This is their personal Company workspace (rendered identically to a joint Company per the unification — same rail).

Tabs (default: Inbox):

```
[avatar] You / personal Company name
  Inbox · Roles · Ownership · Treasury · Governance · Settings · Integrations · Agents
```

The Settings tab is **richer** than a joint Company's Settings — includes user-level stuff (email, passkeys, notification prefs, billing for personal sub, profile/avatar). See `wallet-architecture-faq.md` § 11 for the personal-vs-joint Company rendering distinction.

---

## Joint Company workspace (`/c/{slug}`)

When the user navigates into a joint Company they're a member of, they see:

```
⬡ ACME Corp
  Overview · Roles · Ownership · Treasury · Governance · Settings · Integrations · Agents · Inbox
```

Same rail as personal Company, with Company-scoped Settings (no user-level stuff).

Members see member views; non-members visiting the public page (`/c/acme` from the public side) see the public projection.

---

## Blueprints — vocabulary and scope

**Decision: "Blueprint" is reserved for FULL Company templates only.** Smaller-scope templates live with their primitive and use different naming.

| Scope | Where it lives | Term |
|---|---|---|
| **Full Company template** | `/blueprints` | **Blueprint** |
| **Single agent template** | `/agents` (the agent marketplace) | **Persona** or **agent template** |
| **Quest pattern** | Inline at `+ New Quest` in any Company | **Template** |
| **Idea / knowledge starter** | Inline at `+ New Idea` | **Starter** |
| **Multi-primitive workflow** | Inside a Blueprint or as a Recipe | **Recipe** |

**Why:** "Blueprint" semantically implies a complete plan for building something whole (architectural blueprint, business blueprint). Reserving it for Company-scale templates strengthens the term and focuses `/blueprints` on a sharp value prop ("Deploy a complete autonomous Company in one click").

---

## Logged-in landing behavior

**When a logged-in user opens `app.aeqi.ai`, they land at `/` (the Economy).**

Reasoning:
- The public surface IS the product's pitch — show people what's happening across the platform
- Reduces silo'd thinking — your Company is one of many in the economy
- Same as Twitter, Farcaster, ProductHunt (logged-in users still see feed first)
- One click to your stuff via avatar dropdown

Exception: if the user explicitly bookmarks `/me` or follows a deep link to a Company, they go straight there. The default entry is `/`.

---

## Cross-Company surfaces (aggregated views, not separate entities)

Some surfaces span all the Companies you're in. They're VIEWS over data that lives on individual Companies, not separate entities.

| Surface | URL | What it aggregates |
|---|---|---|
| **Inbox** | `/me/inbox` | Notifications from your personal + every joint Company you've joined |
| **Portfolio** | `/me/portfolio` | Your equity holdings across all Companies you have shares in |
| **Activity** | (planned, not MVP) | Recent on-chain activity from all your Companies |

These don't introduce new primitives — they're SQL queries / aggregations over existing Entity data, surfaced as user-friendly views.

---

## Hierarchy of concerns (so this IA doc doesn't drift)

1. **Architecture** — `wallet-architecture.md` (the wallet/Entity model)
2. **Conceptual depth** — `wallet-architecture-faq.md` (mental models, debates)
3. **App IA** — this doc (URL structure, surfaces, navigation)
4. **Per-primitive rails** — `project_company_rail_v1.md`, `project_agent_rail_v1.md`, `project_personal_rail_v1.md` (locked tab orders for each Entity render context)
5. **Brand / copy** — `feedback_brand_dont_market_unification.md`, `feedback_pivot_minimal_scope.md`, etc. (positioning rules)

If a worker is making a navigation/IA change, they look here. If they're touching the wallet contracts or trust model, they look at the wallet docs. If they're touching the rail tabs of a specific Entity render, they look at the rail memories.

---

## What this doc supersedes / updates from prior memory

| Prior memory entry | Update |
|---|---|
| `project_company_rail_v1.md` says "Inbox at /" | **Inbox moves to `/me/inbox`.** The `/` URL is the Economy Discover surface. The `/me/inbox` URL is the user-scoped aggregated inbox. |
| `project_fifth_layer_economics.md` says "Marketplace at app.aeqi.ai/economy/*" | **Marketplace ("Æconomy") moves to `/`.** The branding "Æconomy" stays as the name we use; the URL is just `/`. Sub-pages are `/agents`, `/bounties`, etc. — no `/economy/*` namespace. |
| `project_public_app_surfaces.md` says "ship unauthed `/blueprints` + `/economy`" | Updated paths: `/` (Discover), `/companies`, `/agents`, `/bounties`, `/blueprints` for MVP public surfaces. |

The relevant memory files should be updated to reflect this — see `Action items for memory sync` at the end.

---

## Open questions (decide later)

1. **Search scope at top bar** — does global search hit Companies + agents + bounties + blueprints, or just one type? (Lean: cross-type with type filters.)
2. **Public profile defaults** — opt-in vs opt-out for `/u/{slug}`? (Current: opt-in for personal, opt-out for joint Companies.)
3. **Activity feed cadence** — real-time WebSocket vs poll-every-N-seconds? (Lean: poll for MVP, WebSocket later.)
4. **Personalization scope on `/`** — how aggressive? Full algorithmic feed vs static editorial? (Lean: editorial for MVP, add personalized strips post-MVP.)
5. **Joint Company creation flow** — modal vs in-shell page vs full-page? (Per memory: modal/in-shell, never fullscreen takeover.)
6. **MVP cut for Roles/Funding/Services** — fold into MVP categories or keep deferred? (Lean: defer, keep MVP lean to 4 verticals + Blueprints.)

---

## Action items for memory sync (when this lands)

When this IA gets adopted, update:

1. `project_company_rail_v1.md` — change "Inbox at /" to "Inbox at /me/inbox" for the personal Company; the Company rail tab order remains
2. `project_fifth_layer_economics.md` — change "Marketplace at /economy/*" to "Marketplace at /" with sub-routes `/agents`, `/bounties`, etc.
3. `project_public_app_surfaces.md` — refresh the Phase A→D plan with new paths
4. New memory entry: `project_app_ia_v1.md` — pointer to this doc with one-line summary

Don't update memory until decisions in this doc are confirmed by the founder. This doc lives as the proposal until then.

---

## TL;DR for the worker synthesizing this

- **Public/Economy at `/`**, default view Discover, vertical left nav with categories
- **Workspaces at `/me` (personal Company) and `/c/{slug}` (joint Companies)**, identical rail rendering with different Settings richness
- **Inbox moved from `/` to `/me/inbox`**
- **Blueprints reserved for full Company templates only** — smaller scope templates live elsewhere with different naming
- **Logged-in users still default-land at `/`** (the Economy), not their workspace
- **MVP vertical set:** Discover · Companies · Agents · Bounties · Blueprints + Your Stuff
- **Defer to v2:** Services / Roles / Funding / Data / Markets (fold simpler ones into existing verticals as filters for MVP)
- **Top bar global** (logo, search, inbox bell, avatar dropdown) on every page
- **Cross-Company aggregations** (Inbox, Portfolio) are views over the data, not separate entities

Read this doc + `wallet-architecture.md` + `wallet-architecture-faq.md` for full context. The wallet docs cover the underlying contract / trust model; this doc covers the user-facing IA built on top.
