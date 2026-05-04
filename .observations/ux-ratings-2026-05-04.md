# UX Rating — 2026-05-04

Crawl: 17 routes, headless Chromium 147, JWT-authenticated.
Entity: `9f8d30b9-abed-408e-9eae-91c48bb360ff` (Luca Eich personal entity)
Screenshots: `/tmp/ux-rating-screenshots/`

---

## Critical findings summary

| # | Severity | Finding | Routes affected |
|---|----------|---------|-----------------|
| 1 | P0 | `/me/*` routes all render the Settings profile page — routing is broken | me-agents, me-quests, me-ideas, me-treasury |
| 2 | P0 | `aeqi.ai/economy` 404s — nav link points at an unbuilt landing page | landing-economy |
| 3 | P0 | App root (`/`) fires 10× API calls that return 502 before X-Entity context is set | app-root |
| 4 | P1 | "AEQI" uppercase in agent mission text rendered on company overview | company-shell |
| 5 | P1 | Pill buttons everywhere violate the no-rounded-square rule | system-wide |
| 6 | P1 | Avatar on /me/inbox is a fuchsia/magenta dot — wrong color, violates Graphite+Ink palette | me-inbox |
| 7 | P2 | Landing hero loads a large grey architectural image that renders at ~90% opacity; adds weight without adding meaning | landing-home |
| 8 | P2 | Blueprint cards on /start have border-radius 12px — rounded-square feel | start-blueprints |
| 9 | P2 | "Change" and "Save" buttons on /me/settings are pill-radius (999px) | me-settings |
| 10 | P2 | Governance page role pills ("Director · founder") are all 999px radius | company-governance |
| 11 | P3 | Docs render at very small body text, left sidebar is tiny; hard to scan | landing-docs |
| 12 | P3 | Treasury (company) page bottom half is white desert — no on-chain wallet data shown | company-treasury |
| 13 | P3 | Cookie banner on landing is styled with `border-radius: 999px` on both buttons | landing-home |

---

## Per-route ratings

### landing-home — `https://aeqi.ai/`
Screenshot: `landing-home.png`
FCP: 384ms | Status: 200

**Scores (1-10)**
- Visual polish: 7 — hero typography is clean, weight is right, ratio rule mostly holds
- Information architecture: 8 — clear nav, CTA reads well
- Copy: 8 — "The company OS for the agent economy." is on-brand, tight
- Microcopy: 7 — "Start something that can work without you." landing below CTA is good
- Perf: 8 — 384ms FCP acceptable
- Error states: n/a
- Design-system coherence: 7 — mostly clean but see issues

**Issues**
- [P3] Cookie consent banner buttons ("Essential only", "Accept all") have `border-radius: 999px`. The accept button is styled as a black pill, inconsistent with system primary button shape. Fix: apply `.btn` token class with correct radius.
- [P3] Hero background image (architectural photo, grey-washed, ~40% opacity) is decorative noise. It communicates nothing about the product and softens the authority of the hero text. Remove or replace with something product-specific.
- No uppercase AEQI. No gradient text. No JetBrains Mono. No hairlines detected.

---

### landing-docs — `https://aeqi.ai/docs`
Screenshot: `landing-docs.png`
FCP: 140ms | Status: 200

**Scores**
- Visual polish: 6 — content is very dense at small scale; left sidebar text is tiny
- Information architecture: 7 — structure is sound (Getting Started / Core Concepts / Guides)
- Copy: 7 — primitive table on intro is useful
- Microcopy: 6 — runtime topology section mentions "REST API" but the actual label is "API & MCP"
- Perf: 9 — 140ms FCP
- Error states: n/a
- Design-system coherence: 6 — looks like a separate render target from the app

**Issues**
- [P3] Body text in docs renders smaller than comfortable for dense technical content. Inter body size appears to be ~13-14px at 1440px width. Should be 15-16px.
- [P3] Docs sidebar section headers ("GETTING STARTED", "CORE CONCEPTS") are all-caps — this is fine for nav section headers, but check if it conflicts with brand lowercase style in any way.

---

### landing-economy — `https://aeqi.ai/economy`
Screenshot: `landing-economy.png`
FCP: 176ms | Status: 200 (but renders a 404 page)

**Scores**
- Visual polish: 5 — clean 404 page, but the page should not be 404
- Information architecture: 1 — the route is dead; the nav bar links to it
- Copy: n/a
- Microcopy: 6 — 404 page copy is acceptable ("Page not found")
- Perf: 9
- Error states: 4 — 404 page renders, but having a nav link to a dead page is a serious user-facing error

**Issues**
- [P0] `aeqi.ai/economy` is 404 but is listed prominently in the navigation. Any visitor clicking it hits a dead end. Either build the page or change "Economy" in the landing nav to point to `app.aeqi.ai/` or remove the link.

---

### app-root — `https://app.aeqi.ai/`
Screenshot: `app-root.png`
FCP: 384ms | Status: 200

**Scores**
- Visual polish: 7 — Economy placeholder page renders cleanly, layout is well-structured
- Information architecture: 7 — sidebar visible, "COMING SOON" badge is honest
- Copy: 8 — "The economic substrate of your agents. Wallets, cap tables..." is good
- Microcopy: 7
- Perf: 6 — 10 × 502 errors on initial load (APIs called before entity context is set)
- Error states: 3 — 10 network failures on every page load; should not appear in prod
- Design-system coherence: 7

**Issues**
- [P0] App root fires 10 simultaneous requests to `/api/activity`, `/api/agents`, `/api/status`, `/api/cost`, `/api/quests` that all return 502. Root cause: these endpoints require `X-Entity` header which is not set at the `/` route because no entity is selected. The app is calling entity-scoped endpoints from a non-entity context. Confirm whether `/` is the "Economy" view or a redirect target; if it's a global view, these endpoints should not be called here. The 502s show as console errors and inflate error telemetry.
- [P1] Sidebar pills (circular avatar buttons at 50px border-radius) are everywhere in the chrome. The "Luca Eich" sidebar item and other icon buttons use border-radius ≥ 50px. Violates no-rounded-square rule for non-avatar interactive controls.

---

### me-inbox — `https://app.aeqi.ai/me/inbox`
Screenshot: `me-inbox.png`
FCP: 208ms | Status: 200

**Scores**
- Visual polish: 5 — renders the Settings/Profile page, not inbox
- Information architecture: 1 — BROKEN: route renders wrong content
- Copy: n/a
- Microcopy: n/a
- Perf: 8
- Error states: 1 — no error state shown, silently wrong
- Design-system coherence: 5

**Issues**
- [P0] `/me/inbox` renders the profile settings view (Identity section, First name / Last name fields, email change, Save button). This is the same view as `/me/settings`. The inbox route is broken — either the router is catching `/me/*` and sending everything to the settings component, or `localStorage.setItem("aeqi_token")` during setup redirected the session into settings. Reproduced consistently across `/me/agents`, `/me/quests`, `/me/ideas`, `/me/treasury` — all five routes show identical profile settings content.
- [P1] Avatar on the profile page is a fuchsia/magenta red (hot pink `#e04080` range). This violates the Graphite+Ink palette. Avatar initials should use a muted grey or the near-black accent, not a saturated color.

---

### me-agents — `https://app.aeqi.ai/me/agents`
Screenshot: `me-agents.png`
FCP: 140ms | Status: 200

Same broken state as me-inbox. Renders profile settings page.

**Issues**
- [P0] See me-inbox above — all `/me/*` routes broken.

---

### me-quests — `https://app.aeqi.ai/me/quests`
FCP: 208ms | Status: 200
Same broken state. See me-inbox.

---

### me-ideas — `https://app.aeqi.ai/me/ideas`
FCP: 204ms | Status: 200
Same broken state. See me-inbox.

---

### me-treasury — `https://app.aeqi.ai/me/treasury`
FCP: 192ms | Status: 200
Same broken state. See me-inbox.

---

### me-settings — `https://app.aeqi.ai/me/settings`
Screenshot: `me-inbox.png` (identical to all me/* routes above — confirms this is the landing page for all me/* paths)
FCP: 136ms | Status: 200

**Scores**
- Visual polish: 7 — layout is clean, two-column settings with left nav
- Information architecture: 7 — logical groupings (Profile, Billing, Security, Wallets, Devices, Integrations, API keys, Preferences, Invites)
- Copy: 7 — "Required for incorporation, equity issuance, and marketplace access" on identity verification is specific and useful
- Microcopy: 6 — "Click or drop · max 2 MB · png, jpg, webp, gif" is good
- Perf: 9 — 136ms FCP (fastest authed page)
- Error states: 6
- Design-system coherence: 5

**Issues**
- [P1] "Change" and "Save" buttons have `border-radius: 999px` (pill shape). The primary Save button at bottom right is a black pill — should be the standard rectangular-with-small-radius button per design system.
- [P1] Avatar image/initial is fuchsia-pink. Wrong palette.
- [P2] "Coming Soon" badge for identity verification uses a different badge style than the "COMING SOON" badge on the economy landing page. Inconsistency in badge text case and styling.

---

### start-blueprints — `https://app.aeqi.ai/start`
Screenshot: `start-blueprints.png`
FCP: 120ms | Status: 200

**Scores**
- Visual polish: 7 — clean three-up card layout, clear hierarchy
- Information architecture: 8 — "RECOMMENDED" section label, card names + taglines + agent count
- Copy: 8 — "A flexible company that becomes whatever you need", "One builder. One breathing company." — tight
- Microcopy: 7 — "Browse all Blueprints →" as ghost link is good
- Perf: 9 — 120ms FCP
- Error states: n/a
- Design-system coherence: 6

**Issues**
- [P2] Blueprint cards have `border-radius: 12px` — noticeably rounded corners that read "Notion card" rather than "precision instrument". Per impeccable.md anti-references: "Rounded bubbly interfaces" are explicitly listed. Reduce to 4-6px.
- [P2] "Start a company" as the page h1 is the correct CTA copy per brand rules. Good. But the subtitle "Pick a Blueprint to begin. You'll confirm a name, your team, and your plan on the next screen." is functional but unambitious — could be shorter.

---

### start-solo-founder — `https://app.aeqi.ai/start/solo-founder`
Screenshot: `start-solo-founder.png`
FCP: 156ms | Status: 200

**Scores**
- Visual polish: 8 — accordion review layout is clean, good visual hierarchy
- Information architecture: 8 — breadcrumb "SET UP · SOLO FOUNDER", accordion sections (Identity, Roles, Token, Vesting, Governance, Review) ordered logically
- Copy: 8 — "Configure your company. One builder. One breathing company." matches blueprint tagline
- Microcopy: 7 — section summaries ("2 seats", "FOUN · 100,000,000", "Founder 4yr/12mo...") are informative
- Perf: 9
- Error states: 6 — "Create company" CTA is active on first load with no input — unclear if this creates a company immediately or opens the accordion
- Design-system coherence: 6

**Issues**
- [P1] "Create company" and "Back to blueprint" buttons are both pills (999px radius). The primary CTA especially should use the standard button shape.
- [P2] The two tabs "Create company" and "Configure" at the top of the accordion are using the same styling as pills. Tab state ("Create company" is bold/selected, "Configure" is grey) is ambiguous — looks like there's a tab switcher but the semantics are unclear.
- [P2] "Back to blueprint" being a pill button at the bottom creates visual confusion with "Create company" — two prominent pill shapes. Per button variant rules, "Back" is always secondary. It looks secondary in weight (grey/outline) but wrong in shape.

---

### start-personal-os — `https://app.aeqi.ai/start/personal-os`
Screenshot: `start-personal-os.png`
FCP: 120ms | Status: 200

**Scores**
- Visual polish: 8 — same clean accordion layout
- Information architecture: 7 — fewer sections than solo-founder (Identity, Roles, Review only — no Token/Vesting/Governance); appropriate for personal OS
- Copy: 8 — "One agent that runs your life like a chief of staff who actually knows you." — good
- Microcopy: 7
- Perf: 9
- Error states: 6
- Design-system coherence: 6

**Issues**
- Same button pill issue as solo-founder.
- "1 roles" — should be "1 role" (grammar bug in Review summary microcopy). `screenshot: start-personal-os.png`

---

### company-shell — `https://app.aeqi.ai/c/<entity_id>`
Screenshot: `company-shell.png`
FCP: 120ms | Status: 200

**Scores**
- Visual polish: 7 — overview grid is clear, sections have correct weight
- Information architecture: 8 — mission / ideas → / roles / org chart → / in flight / awaiting you / momentum — all meaningful
- Copy: 5 — **"You are an AEQI agent named 'Luca Eich'"** is visible in the "mission" section. This is agent identity text leaking into the product UI. "AEQI" uppercase violates brand rules, and the raw system identity format ("# Current Agent Identity...") should not be user-visible.
- Microcopy: 7
- Perf: 9
- Error states: 7 — "Nothing in progress right now.", "Nothing waiting from this agent." are clean empty states
- Design-system coherence: 7

**Issues**
- [P1] Agent mission field on company overview shows raw system identity markdown: `# Current Agent Identity: Luca Eich ## Core Identity You are an AEQI agent named "Luca Eich".` — two problems: (a) "AEQI" is uppercase in the system identity text, violating brand rules in a user-visible surface; (b) the raw mission text (a system instruction, not a user-written description) is being rendered in the overview. This should either be a user-written mission field, or the mission field should show an empty state with a CTA to write one.
- [P3] "0 open quests" subtitle is correct but combined with "Nothing in progress right now." it reads double-empty. Consider showing one or the other.

---

### company-treasury — `https://app.aeqi.ai/c/<entity_id>/treasury`
Screenshot: `company-treasury.png`
FCP: 120ms | Status: 200

**Scores**
- Visual polish: 7 — page renders correctly, resource pack stats are legible
- Information architecture: 6 — "No subscription on this Company" appears to be the primary state, yet the resource pack shows real data (4 vCPU, 8 GB, 80 GB). Confusing.
- Copy: 6 — "This Company isn't billed through Stripe yet. Personal Companies on the founder account are exempt; joint Companies bill the creator." — accurate but awkward. "founder account are exempt" should be "founder accounts are exempt" or rewrite.
- Microcopy: 5 — no action for the user to take from this state. No CTA to add billing.
- Perf: 9
- Error states: 5 — showing resource data without a billing subscription is an undefined state
- Design-system coherence: 7

**Issues**
- [P2] Resource pack section at bottom has four stat columns (Inference/month $25, Compute 4 vCPU, Memory 8 GB, Storage 80 GB) but no context on what these mean or how they're consumed. No progress bars, no usage telemetry. The section header "RESOURCE PACK" is orphaned.
- [P3] Grammar: "founder account are exempt" → "founder accounts are exempt".
- [P3] On-chain treasury / wallet data is not shown. Page spec says "the on-chain mirror surface" but no ETH/Base balance, no transactions. Either the wallet data is correctly deferred or it's failing silently.

---

### company-ownership — `https://app.aeqi.ai/c/<entity_id>/ownership`
Screenshot: `company-ownership.png`
FCP: 120ms | Status: 200

**Scores**
- Visual polish: 6 — data is sparse (one founder, one operational role), rendering is clear
- Information architecture: 7 — FOUNDERS · 1 / OPERATIONAL · 1 hierarchy is readable
- Copy: 6 — "FOUNDER 6 GRANTS" / "0 GRANTS" labels are terse and clear; but what "grants" means is not explained anywhere on the page
- Microcopy: 5 — no empty state guidance; "0 GRANTS" on the Luca Eich operational role has no action
- Perf: 9
- Error states: 5 — "0 GRANTS" is displayed but without explanation or action
- Design-system coherence: 7

**Issues**
- [P2] "FOUNDERS · 1" header has a space before the middle dot (`FOUNDERS· 1` renders tight). Typography inconsistency.
- [P2] "FOUNDER" badge on Director row is all-caps small label in a bright teal/jade color that reads too much like a "success" badge. Role type labels should use neutral color per palette (jade = success semantic only).
- [P3] No way to add ownership grantees visible on the page. Empty CTA is missing.

---

### company-governance — `https://app.aeqi.ai/c/<entity_id>/governance`
Screenshot: `company-governance.png`
FCP: 120ms | Status: 200

**Scores**
- Visual polish: 6 — layout is flat, all permissions listed in a single column
- Information architecture: 7 — permissions are correctly named ("Manage roles", "Spawn agents", etc.) with descriptions
- Copy: 7 — permission descriptions are precise and useful
- Microcopy: 6 — "See proposals (full tab in Phase 2)" is internal build language; should not be user-visible
- Perf: 9
- Error states: 6
- Design-system coherence: 4

**Issues**
- [P1] Six "Director · founder" role pills are all `border-radius: 999px`. These are rendered as interactive-looking pills but appear to be read-only labels. Should be flat text labels or non-pill chips.
- [P1] "1 ROLE" badges on the right side of each permission row are jade/teal. Jade is reserved for success semantic. Use neutral grey or the standard label color.
- [P2] "See proposals (full tab in Phase 2)" — internal development note leaking into the UI. Users should see an empty state or the text should be removed. This is currently visible in the "View governance" permission description.
- [P2] No visual grouping between permission rows. The list needs either light spacing or a subtle divider (not a hairline — a tint shift or generous gap) to separate grant sections.

---

## System-wide issues

### P1 — Pill buttons everywhere
Every action button in the authed app uses `border-radius: 50px` (circular avatar controls) or `border-radius: 999px` (action buttons). This is the "rounded-square" anti-pattern. Specifically:
- All sidebar icon buttons: 50px radius
- "Save", "Change", "Create company", "Back to blueprint" action buttons: 999px radius
- Cookie consent buttons on landing: 999px radius
- Role pills on Governance: 999px radius

The design system specifies small radii for buttons (4-6px as implied by the grid and impeccable anti-references). This is a system-wide regression. The sidebar circular controls may be intentional for icon buttons but need verification.

### P2 — Avatar color is fuchsia
The user avatar (letter "L" initial) renders in a bright fuchsia/pink tone (`#cc3366` approximation). This is not in the Graphite+Ink palette. Per `.impeccable.md`: "Heraldic gold, warm parchment, royal blue, saturated cyan, steel-blue accent — retired palettes, do not reintroduce." Saturated pink is equally off-brand. Should be `#0a0a0b` fill with white letter, or a muted grey.

### P3 — /me/* personal rail broken
All five personal rail tabs (Inbox, Agents, Quests, Ideas, Treasury) render the Settings profile view. This means the entire personal-entity experience is inaccessible. The me-settings route (`/me/settings`) is the first tab that renders correctly because it IS the settings page — confirming that the router is routing everything under `/me/` to the settings component. The personal rail as specified in `project_personal_rail_v1.md` (Inbox · Agents · Events · Quests · Ideas · Treasury · Settings) is not functional.

---

## Overall ratings

| Route | Score |
|-------|-------|
| landing-home | 7.0 |
| landing-docs | 6.5 |
| landing-economy | 1.0 (dead) |
| app-root | 5.5 |
| me-inbox | 1.5 (broken) |
| me-agents | 1.5 (broken) |
| me-quests | 1.5 (broken) |
| me-ideas | 1.5 (broken) |
| me-treasury | 1.5 (broken) |
| me-settings | 6.5 |
| start-blueprints | 7.0 |
| start-solo-founder | 7.0 |
| start-personal-os | 7.0 |
| company-shell | 6.5 |
| company-treasury | 6.0 |
| company-ownership | 6.0 |
| company-governance | 5.5 |

**Overall: 5.0 / 10**

The company shell and /start wizard are solid. The personal rail is completely broken (5 routes dead). The public landing economy link is dead. The app fires 10×502 on load. These three P0s drag the score down hard.

---

## Top 5 fixes for tomorrow morning

**1. Fix /me/* routing (P0)**
All `/me/inbox`, `/me/agents`, `/me/quests`, `/me/ideas`, `/me/treasury` render the profile settings view. The personal rail is fully broken. Locate the React Router config for the `/me/*` tree — likely a missing route registration or a catch-all that sends everything to the settings component. This is the highest-priority fix because it blocks the entire personal entity experience.

**2. Fix `aeqi.ai/economy` 404 (P0)**
The landing navigation has a prominent "Economy" link that 404s. Either build a minimal landing page at that path (even a "coming soon" with app deep link) or remove/redirect the nav item to `app.aeqi.ai/`. As-is, every landing visitor who clicks Economy hits a dead end.

**3. Fix app root 502 spray (P0)**
`https://app.aeqi.ai/` fires 10 API requests without X-Entity context, all returning 502. The root view is the Economy landing which is an entity-agnostic page — it should not be calling entity-scoped endpoints. Audit what's triggering these calls on mount and guard them behind entity context being set.

**4. Fix button radius system-wide (P1)**
Action buttons (`Save`, `Change`, `Create company`, `Back to blueprint`) all have `border-radius: 999px`. This is a widespread design regression. Apply the correct radius token (likely `--radius-sm` or `border-radius: 4px`) to `.btn`, `.btn-primary`, `.btn-secondary` in the design system. One CSS change fixes ~20 surfaces.

**5. Fix "AEQI" in agent mission + fuchsia avatar (P1)**
Two brand violations that a user sees immediately on the company overview: (a) the agent's system identity text contains "AEQI" uppercase and renders raw in the mission field — fix the default agent identity text to use lowercase "aeqi", and consider whether raw system identity should be shown in the overview at all; (b) the avatar initial color is fuchsia — set it to graphite (`#0a0a0b`) or neutral grey.
