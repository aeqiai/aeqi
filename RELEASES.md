# Release Notes

## v0.43.0 — 2026-05-08

**Headline:** Quests get a due date, Ideas get tables, Companies go public.

- **Linear-Quests Phase 2 — `due_at` + `D` shortcut + DueDatePopover + Due column + overdue chip** (`apps/ui/src/pages/quest/QuestDetailPage.tsx` + `QuestsPage.tsx` + `crates/aeqi-orchestrator/src/quests/`): quests now carry an optional `due_at` timestamp. `D` keyboard shortcut on the Quest detail page opens the DueDatePopover (Today / Tomorrow / Next week / pick a date). The Quests list view gains a `Due` column; rows past due render an `overdue` chip in the danger tint. Phase 1 of Linear-Quests shipped the detail page in v0.41.0; Phase 2 closes the loop on time-bounded execution. `422491d6`.
- **BlockNote tables in Ideas** (`apps/ui/src/components/editor/BlockEditor.tsx`): the BlockNote default schema includes the table block — enabling it is one config flag plus design-token border styling for grid lines. Slash-menu hint added so the affordance is discoverable. Ideas now compose like a Notion doc with structured data inline. `087953d0`, `2058ec50`.
- **Public Company profile at `/<slug>`** (`apps/ui/src/pages/PublicCompanyPage.tsx` + `crates/aeqi-web/src/handlers/public.rs`): read-only EntityHeroStrip + public roles + public ideas rendered at the bare `/<slug>` route — no auth required. The `public` toggle on the EntityHeroStrip (shipped v0.42.0) flips the Company between private and link-shareable. Pairs with platform `90e26c6` (`GET /api/public/entities/<slug>` public-read endpoint). First step of the public-app-surfaces plan. `b974b220`.
- **EntityHeroStrip renders on `/c/<id>/` again** (`apps/ui/src/pages/company/CompanyOverviewPage.tsx`): the `isDrilledAgent` intercept added during the agent rail unification was over-broad — it suppressed the hero strip on the canonical `/c/<id>/` Company Overview route too. Dropped the intercept; the strip is back where it belongs. Notes captured in CLAUDE.md on isDrilledAgent semantic drift + grep-before-fix-string-asserts so the next pass doesn't repeat the call. `315aab64`, `2211857f`.

## v0.42.0 — 2026-05-08

**Headline:** Agents touch the world — Architect spawns Companies from a brief, W33B wires real cross-Company role grants on-chain, Drive read+write completes the OAuth loop.

- **Architect — Wave 34 Phase 1** (`crates/aeqi-architect` + `apps/ui/src/pages/StudioPage.tsx`): new crate scaffold + brief→blueprint IPC + `/studio` page with LLM stub. The natural-language org-design front door starts here — type a brief, get a stack blueprint, spawn the Company. First wedge of the architect-agent vision (`architecture_architect_agent_vision.md`); Phases 2-6 follow in Waves 31-35. `eae10243`.
- **Google Drive pack — `drive.list_files` + `drive.read_file` + `drive.create_doc`** (`crates/aeqi-pack-google-workspace`): three new agent tools — list files (filtered + paginated), read file content, create new Google Doc. Closes the OAuth loop shipped v0.40.0: Connect Google → agent now reads and writes Drive in addition to Gmail/Calendar. Companion platform commit (`010ca2b`) adds Drive scopes to the agent OAuth Path B authorize URL. `2063fbd6`.
- **Company Settings tab killed; EntityHeroStrip on Overview** (`apps/ui/src/pages/company/EntityHeroStrip.tsx` + tab refactor): the Company rail loses its Settings tab; identity edits (name, tagline, public toggle, plan link) are now click-to-edit affordances on the Overview hero strip. Settings was a dead seventh tab — name/plan changes belong on the page that shows them. Companion platform commit (`32e8edf`) adds `tagline` + `public` columns + `PUT /api/entities/{id}` handler. `a57f97d3`.
- **react-vendor chunk split — 1.44MB → 232KB raw / 74KB gz (-83%)** (`apps/ui/vite.config.ts`): the manual `react-vendor` chunk regex was over-broad — anything mentioning React anywhere in its dependency graph (editor stack, wallet stack, BlockNote, viem) was being absorbed into one mega-bundle. Anchored the match to `/node_modules/react/` proper so editor + wallet stacks ship in their own lazy chunks. First-paint payload drops accordingly. `35a1bc6f`.
- **Bare-/ post-login lands on /me/inbox; inbox probe cached per deploy-hash** (`apps/ui/src/pages/Index.tsx` + bootstrapper): authed visitors hitting bare `/` now redirect to `/me/inbox`, with the inbox probe outcome cached in localStorage keyed on the deploy-hash so we don't re-fire it on every navigation. The "first 90 seconds after sign-in" path stays clean across SPA navigations. `d76bf43a`.
- **Dead-code drop — `invoke_pattern` + legacy event columns** (`crates/aeqi-orchestrator/src/events/`): retired the pre-tool-calls invocation surface (`invoke_pattern`) and the legacy event columns it depended on. Tool-calls unification (`architecture_tool_calls_unification.md`) shipped 2026-04-19 made these dead; this release drops them from the schema. `755bc84e`.

## v0.41.0 — 2026-05-08

**Headline:** Co-creation surface lands — BlockNote ideas, Slack-shaped channels, Linear-shaped quests, agent personality tab, inference spend visibility, and a UX P0 sweep.

- **BlockNote editor primitive** (`apps/ui/src/components/editor/BlockEditor.tsx`): reusable Notion-style block editor — slash menu, drag handles, inline markdown — wired into the Ideas surface as the canonical write affordance. First Notion-Ideas Phase 1 ship; the editor itself is a primitive, not Idea-specific, and gets reused by the Personality tab. `e68a682d`.
- **Slack-shaped channels surface** (`apps/ui/src/pages/Channels*` + session primitive wiring): list, detail, composer, send/receive — all over the existing Session primitive, no new transport. `@`-mentions in in-app channels now trigger agent spawn (closes the loop: type at the agent in a channel → it picks up the turn). `c86529f9`, `26c79d7c`.
- **Linear-shaped Quest detail page** with S/P/A keyboard shortcuts (Status / Priority / Assignee). Quest now wraps an Idea body so the Quest description is a first-class block document, not a flat text field. Phase 1 of Linear-Quests. `dac5d449`.
- **Personality tab on agent rail** (`apps/ui/src/pages/agent/PersonalityTab.tsx`): block editor binds to a `personality:<agent_id>` Idea; `system_prompt` field sunset on the agent shape. The agent's character is now editable and queryable like any other Idea — same affordances, same inbox, same tags. Memory `feedback_no_prompt_vocabulary.md` made canonical at the data layer, not just in copy. `85cbf0a9`.
- **Per-agent inference accounting** wired at the `agent-completed` emission point in `crates/aeqi-orchestrator`: every LLM call records prompt/completion tokens + USD cost against the agent. Surfaced as a "Lifetime Spend" stat + recent-calls table on the Agent Treasury tab and a "Spend" column on the agents list. The dollar cost of an agent is now visible at the row level, not buried in upstream provider logs. `d4ebfcbe`, `bcc4281e`.
- **UX P0 hotfix bundle** (`01aae710`, `59df8009`): drop double `/api` prefix that was 404'ing the JWT-mint path; fix Personal Entity rendering (was crashing on null `roles[]`); console-clean sweep across the app shell; post-login lands on `/me/inbox` instead of root; inbox dismiss-probe 400 fixed; `/c/<personal>/` resilient to 502s during host respawn. The "first 90 seconds after sign-in" path is clean again.
- **Inbox round-trip + proactive multi-agent greeting** (`05656f8a`): user-reply round-trip now fires correctly through the agent-bound DM session pattern (`create_session` + `add_session_participant`, not `find_or_create_dm_session` which leaves `agent_id` NULL); a freshly-blueprinted Company auto-seeds a greeting from each bound agent on first inbox load. New companies feel populated immediately instead of empty.
- **Routing fix on event + idea row clicks** (`88b77492`): list-row click handlers now navigate to the detail page instead of no-op'ing on stopPropagation collisions with the row's hover-+ button.

## v0.40.0 — 2026-05-07

**Headline:** AEIQ Executive Assistant goes live — Telegram bot answering, mention-gate live, Google OAuth Path B end-to-end, session-streaming P0 fix.

- **Session-streaming P0+P1 fix** (`crates/aeqi-orchestrator/src/ipc/session_stream.rs` + `apps/ui/src/components/session/useSessionManager.ts`): the daemon's `session_subscribe` was short-circuiting subscribes-before-executor with a synthetic `Complete{no_active_run:true}` — UI's "subscribe-then-send" pattern guaranteed the race. WS tore down before any real events fired; refresh worked because messages persist to DB. Removed the `is_active` early-return; subscribers now wait on `rx.recv()` regardless of executor state. Plus polling no longer repaints messages mid-turn (gates on `streamingSessions[id]`), eliminating duplicate thinking-bar trails. `7aae78c7`.
- **Per-agent Google OAuth Path B** — three commits across three repos shipping the canonical agent-scoped Google integration:
  - `aeqi 5c2900ee` — `credentials_ingest` IPC verb + `POST /api/integrations/credentials/ingest` HTTP endpoint. The persist side: takes plaintext OAuth tokens from the platform, writes them encrypted into the per-tenant credentials substrate scoped `(scope_kind=Agent, scope_id=<agent_id>, provider="google", name="oauth_token")`. The same key the existing `aeqi-pack-google-workspace` reads.
  - `aeqi-platform 0b5676e` — `GET /api/agents/{id}/integrations/google/start` (mints HMAC-signed state token, builds Google authorize URL with offline access + force consent), wired callback exchange (decodes state, POSTs to `https://oauth2.googleapis.com/token`, calls `credentials_ingest` over IPC), and `/api/agents/{id}/integrations/google/status` for UI to render Connect/Connected toggle. Caught and fixed a bug in the original 501 stub: callback was registered behind auth (would have 401'd Google's redirect); now public-routed.
  - `aeqi/apps/ui f64c7b77` — `Connect Google` button on agent settings. Calls `/start`, redirects via `window.location.href`, refetches status on `?connected=google` return.
  - **Activation:** paste `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AEQI_OAUTH_STATE_SECRET=$(openssl rand -hex 32)` into `/etc/aeqi/secrets.env`; restart `aeqi-platform.service`. Routes flip from 503 setup-required to live. Pattern memorialized in `architecture_agent_scoped_oauth_path_b.md`.

## v0.39.0 — 2026-05-07

**Headline:** Telegram mention-gate + meeting-orchestration tools (`calendar.find_busy` / `calendar.propose_slots`) + æqi → æiq brand rebrand + role-tile shape semantics.

- **Telegram mention-gate** (`crates/aeqi-gates/src/telegram.rs`): in groups, only `@<bot>` mentions trigger an agent execution turn — DMs always act, non-mention group messages are silently skipped at the channel layer (no eye-react, no typing indicator, no orchestrator dispatch). Resolves the bot's identity at start via `getMe`; degrades open if that call fails. Founder use case: `@aeiq_ea_bot organize a meeting` in a CEO+COO+CTO group should fire only when tagged, never on background traffic. `3116ab38`.
- **`calendar.find_busy` + `calendar.propose_slots` tools** (`crates/aeqi-pack-google-workspace/`): the two missing pieces of a meeting-orchestration flow on top of the existing Gmail/Calendar pack. `find_busy` queries Google's `/freeBusy` endpoint for any list of calendar IDs and returns busy intervals + per-email errors. `propose_slots` is a pure-Rust intersection helper — given the busy map, a duration, working hours/days, and a target timezone, it returns up to N candidate slots that fit. Together they unblock `@ea organize a meeting with the three of us`. `14f92fda`.
- **Role tile shape by occupant kind** (`apps/ui/src/components/roles/RoleNode.tsx`): humans render with a circular avatar (Google profile photo, conventional crop), agents render as a square block (matches BlockAvatar fallback and the AgentAvatar primitive's `borderRadius: 4` elsewhere). Per founder: "humans are round, agents are the other shape." Stops the chart and list views from looking like every node is the same kind of entity. `26d10ae9`.
- **æqi → æiq wordmark + tab title rebrand** (`apps/ui/src/components/Wordmark.tsx`, document.title across page components): the in-product wordmark in the top-left of `AppLayout` and every browser tab title flipped from `æqi` to `æiq` to match the company brand. Storybook docs and CSS comments left alone for a follow-up sweep — those aren't user-facing. `26d10ae9`.
- **Role-tile BlockAvatar fallback** (`apps/ui/src/components/roles/RoleNode.tsx`): when an agent occupant has no profile image (and previously fell back to text initials), the role tile now renders the deterministic identicon used on the Agents page — visually consistent across the two routes. `bb884448`.
- **AgentAvatar onError fallback** (`apps/ui/src/components/AgentAvatar.tsx`): `<img onError>` flips to BlockAvatar instead of showing a broken image icon. Caught broken `/avatars/tech-lead.svg` URL on the EA agent during AEIQ dogfood. `096ed5d4`.
- **Blueprint brand-naming fix** (`presets/blueprints/aeiq-company.json`): the seed ideas baked into the AEIQ blueprint had the company/product naming inverted (canonical idea read "aeiq = the product, AEIQ Inc. = the company" — backwards). This was making the EA agent talk about itself as "aeqi". Bulk-swept `AEIQ` → `aeiq`, fixed the dual-aeqi line in mission. The live AEIQ tenant DB ideas were also corrected orchestrator-direct. `f0816872`.

## v0.38.0 — 2026-05-07

**Headline:** Quiet Director apex + chart drag/text-selection fix + AA-stack smoke test CLI.

- **Quiet Director apex (chart):** dropped the tinted board zone, the band-divider, and the "Director" eyebrow caps per founder direction ("casual hierarchy feeling, not overwhelming top-down"). The Director seat now renders as a calm peer at the apex — same node size, same edges, no zone tint. Honest about hierarchy (Director is at the top of governance), quiet about presentation. `b8d1a518`.
- **Chart drag fix:** `e.preventDefault()` in the canvas pointerdown handler + `user-select: none` on the viewport CSS. Stops the canvas pan gesture from accidentally triggering text selection (which then broke subsequent pan attempts). Founder report: "drag and drop on the canvas bugs sometimes it randomly selects some text and then I can't drag and drop anymore." `b8d1a518`.
- **AA smoke CLI:** `cargo run -p aeqi-paymaster --bin aa-smoke --release` exercises the full ERC-4337 path end-to-end (deploys SimpleAccount + Paymaster, submits no-op UserOp, polls for receipt). Exit 0 = stack healthy. `SMOKE_JSON=1` for structured output. Diagnostic / monitoring foundation. `f75674d5`.

**Architecture notes:** Memory `architecture_board_vs_org_chart.md` is canonical — board (Director tier) is governance, NOT in the operational reporting chain. The chart now reflects this without imposing a heavy visual hierarchy.

**Known limitations / next:** AEIQ Company now has 4 advisor agents (Legal, AI, Blockchain, SaaS) bound as `role_type='advisor'`. They render as a parallel bottom row in the chart per the existing layout. CEO seat now occupied by Luca (human) — "human-CEO with agent reports" pattern locked. Telegram bot for cofounder group still pending founder BOT_TOKEN.

## v0.37.0 — 2026-05-07

**Headline:** Real avatars + cleaner chart edges + board-org tinted band + cross-tab indented tree.

- **Avatars:** Roles + Agents views now render real avatars where they exist. Director seat (Luca) shows the Google profile photo; CEO Assistant shows its `/avatars/tech-lead.svg`. Other agents fall back to colored circles with initials (CTO Asst blue, COO Asst green) or neutral graphite for unset. Platform proxy enriches `/api/roles` with `occupant_avatar_url`; UI consumes via `AgentAvatar`.
- **Chart edges:** stroke 1px → 1.5px; color stepped from `--border` (rgba(0,0,0,0.06)) to `--color-text-secondary` (rgba(10,10,11,0.65)). Edges now read at default zoom on dense subtrees.
- **Board / Org separation:** chart canvas tints the Director seat zone with a subtle band + divider. The list view populates a "Reports to {parent.title}" column for non-root roles via cross-type role_edges resolution.
- **Indented tree (both lists):** Roles + Agents list views switched from section-header grouping to a single linear pre-order traversal with `padding-left: depth * 24px`. Same hierarchy as the chart, vertical-list ergonomics. CTO at depth 1, Backend Engineer at depth 2, Backend Intern at depth 3.

**Architecture notes:** Chart layout = Reingold-Tilford tidy-tree (`layoutChart`); both list views = pre-order DAG traversal + indent. `layoutDepts` removed entirely (memory `architecture_role_primitive.md` is canonical; no painted dept envelopes anywhere).

**UX score:** 5.0/5 maintained on full walk. All 9 chart/list/avatar ships verified.

**Known limitations / next:** `?view=list` query param dropped during 308 redirect from `/c/<id>` to `/trust/<address>` (cosmetic). VPS dogfood respawn pending founder approval. W33B stack-blueprint cross-Company on-chain edge wiring still in flight.

## v0.36.0 — 2026-05-07

**Headline:** Reingold-Tilford tidy-tree org chart + /me primitives polish + UX micro-pass.

- **Org chart layout:** Sugiyama-lite layered DAG → Reingold-Tilford tidy-tree. Each subtree gets a horizontal slot proportional to its width. Verified: Backend Engineer (with Intern child) renders at 488px subtree width vs Frontend Engineer (leaf) at 220px; Intern centered 0px offset under BE. V_GAP raised to 120, H_GAP to 48 — generous vertical breathing between layers.
- **/me primitives audit batch:** Loading-state gates on AgentIdeasTab/EventsTab/QuestsTab (no more empty-state flash during cold load); Events sidebar gets the missing hover-+ rowAction; "system-prompt moment" copy removed (memory `feedback_no_prompt_vocabulary.md`); `--text-title` undefined token renamed; Quests empty-state CTA uses canonical Button component.
- **UI polish micro-pass:** hover affordances added where they were missing; v3 `--space-{xs,sm,md,lg,xl}` token aliases were silently zeroing spacing on Governance + Treasury — bridged in `primitives.css`; empty states warmer; no-op hovers eliminated; remaining hairline traces cleaned.

**Architecture notes:** UX 5.0/5 maintained on full walk. The tidy-tree layout handles arbitrary depth (verified 3-level CEO → CTO → BE → Intern).

**Known limitations / next:** Bundle size manualChunks for cache-friendly chunking still deferred (P2). VPS dogfood respawn pending founder approval. W33B stack-blueprint cross-Company on-chain edge wiring still in flight.

## v0.35.0 — 2026-05-06

**Headline:** Org chart pure nested tree + agent-spawn data integrity (no duplicate roles, no phantom entities).

- **Org chart:** removed painted department-cluster envelopes per founder direction. Roles + Agents charts now render as a single layered DAG via `layoutChart` (Sugiyama-lite, arbitrary depth). Backend Intern under Backend Engineer under CTO renders as a clean 3-level tree, no misleading "CTO group" boxes. List-view department grouping unchanged (founder explicitly approved that).
- **Spawn integrity:** `POST /api/agents/spawn` no longer creates a phantom Company entity when `entity_id` is already known. `spawn_with_entity_id` pre-checks entity existence; HTTP handler accepts `entity_id` in the request body. The signup flow that mints a personal Company per new user is unchanged (entity_id absent → still mint).
- **Role uniqueness:** `POST /api/roles` now upserts when a role for the same `(entity_id, occupant_id)` already exists. Spawning an agent then assigning a role no longer leaves a duplicate orphan role row in the table.
- **A11y:** SignupPage gets the skip-to-main-content link (LoginPage shipped earlier in v0.34.0).
- **Docs:** `aeqi-sandbox-*` deploy gap documented — sandboxes need explicit `systemctl restart` after Rust deploys (the script only restarts host-placement services).

**Architecture notes:** All spawn/role bugs trace back to the org-chart redesign exposing pre-existing data shapes. The fixes harden the runtime contract: 1 entity → many agents → 1 role per agent → DAG via role_edges.

**Known limitations / next:** AEIQ test data still has Backend Intern at depth 3 (test artefact, harmless). W33B stack-blueprint cross-Company on-chain edge wiring still in flight. Wave 34/35 (Architect meta-agent + /studio chat UI) deferred.

## v0.34.0 — 2026-05-06

**Headline:** Org chart departmental clustering + agents list grouped by team + 144kB gzip perf win.

- **Roles chart:** department clusters render each C-suite + reports as a discrete unit. CEO apex carries visual weight. Drag/zoom/pan stable (race condition in `setTransform` updater closure resolved — captures `dragRef.current` snapshot to a local before queueing state update).
- **Agents:** list view groups agents by parent role (Engineering / Marketing / Operations / C-suite); chart view mirrors roles-chart cluster envelopes. Synthetic "Companies-as-agents" rows from `/api/entities` removed (legacy holdover from the SUPERSEDED 2026-04-29 agent-Company unification).
- **Perf:** lazy-load `WagmiProvider` + `RainbowKitProvider` + 11 AgentPage tabs. Main chunk 1342kB → 838kB raw (−37%), gzip 402kB → 258kB (−144kB / −36%). `QueryClientProvider` stays at root (react-query is used app-wide, not just in wagmi).
- **Auth pages:** `LoginPage` (both render branches) gets the skip-to-main link as the first focusable element.
- **Org chart:** `data-testid="org-chart"` on the SVG root for stable test selectors.
- **AEIQ dogfood:** runtime data cleaned (entity name was mis-labeled "CEO Assistant"; CFO/CMO/CLO/CISO each got provisioned as separate phantom Companies). Now: 1 entity (AEIQ), 12 agents under it. 5 team agents added (Backend/Frontend Engineer under CTO, Content Writer/Growth Analyst under CMO, Operations Coordinator under COO).

**Architecture notes:** `architecture_role_primitive.md` is canonical; `architecture_agent_company_unification.md` is SUPERSEDED — Company is not an agent.

**UX score:** post-fixes walk averages 5.0/5 across 5 routes (corrected for known walk-script regex false negatives).

**Known limitations / next:** SignupPage skip-link still missing (P2). W33B stack-blueprint cross-Company on-chain edge wiring still in flight. v0.34.0 ships UI only; aeqi-platform + aeqi-landing have no new commits since v0.33.0.

## v0.33.0 — 2026-05-06

**Headline:** Org chart zoom + 1,035 v3→v4 token migrations + treasury native ETH + a11y P0/P1 batch.

- **Roles:** org chart now supports zoom, pan, and auto-fits container width on mount + resize (founder ask)
- **Roles + Ownership:** human occupants render display name ("Luca Eich") instead of raw wallet address — platform proxies inject `occupant_name` into `/api/roles` responses (`6a4f6a3` in aeqi-platform)
- **Treasury:** shows native ETH balance via wagmi `useBalance` + new `/chain/rpc` browser proxy; chain label honors `VITE_CHAIN_NAME` instead of hardcoded "Base Sepolia" (`42f613b` in aeqi-platform)
- **Inbox:** "Open inbox" agent-overview link now navigates to `/me/inbox` (was `/`); pane borders replaced with tint shifts; loading state gates empty-state copy
- **Design system:** 1,035 v3 token aliases swept to v4 canonical names across 45 files in `apps/ui` (`--text-{primary/secondary/muted}` → `--color-text-*`, `--text-{xs/sm/...}` → `--font-size-*`, broken patterns now documented)
- **A11y:** skip-to-main-content link, sidebar nav `:focus-visible` ring, `aria-label` on icon-only toolbar buttons, invalid roles removed from buttons, `prefers-reduced-motion` guards on pulse animations
- **Drive:** 3 hairline borders removed from DrivePage; replaced with tint/spacing per locked no-hairlines rule
- **UX-batch-A:** Company rail tab order corrected to spec (Roles → Ownership → Treasury → Governance); Stripe vendor name removed from Treasury + Governance copy; `/me/portfolio` → `/me/treasury` redirect
- **AA polish:** paymaster `/stats` endpoint exposing per-Company sponsorship visibility; bundler systemd hardening (Restart, MemoryMax, log rotation)
- **Roles:** invitation-not-sent badge + "Send invite" affordance on detail page

**Architecture notes:** Board vs org-chart correction landed earlier in v0.32.0 ship cycle (memory `architecture_board_vs_org_chart.md`). AEIQ dogfood Company stable on production with corrected role types.

**UX score:** baseline 3.25/5 → post-fixes 4.5/5 (delta walk verified, 6 routes).

**Known limitations / next:** Wallet Phase 3 (multi-signer rotation UI) deferred to Wave 29+. W33B stack-blueprint cross-Company on-chain edge wiring still in flight.

## v0.32.0 — 2026-05-06

**Headline:** aeiq dogfood company live + role invitation polish + Treasury/Governance empty-state cleanup.

- Blueprint for AEIQ's own dogfood company (`aeiq-company`) shipped and deployed; entity_id `59bc9fd3-956a-4104-aaf8-83253fde840c` provisioned on production
- Roles tab: invite-not-sent status badge + "Send invite" affordance for roles where `email_sent=false` (Wave 32 role invitation UX, see `architecture_role_primitive.md`)
- Treasury and Governance tabs: polished empty states for fresh TRUSTs that have no on-chain activity yet — replaces raw empty lists with context-appropriate messaging
- Telegram bot setup guide added to integrations docs
- Evolve: test-copy coupling pattern documented (empty-state polish cost captured)

**Architecture notes:** `architecture_role_primitive.md` — Role invitation `skip_email` / `email_sent` column is in aeqi-platform; this commit wires the UI indicator to that field.

**Known limitations / next:** Board vs org-chart correction (CFO/CMO/CLO/CISO as operational, not director) not yet reflected in default blueprint seed roles. Mass test-company cleanup complete (obs: `aeiq-rebuild-2026-05-06.md`).

## v0.31.0 — 2026-05-05

**Headline:** Stack wizard UI shipped. Multi-Company orchestration now has a frontend.

- StackBlueprint TypeScript discriminator type
- StackWizard component: rename → review → spawn → progress → success
- BlueprintsPage 4th section for stack templates
- BlueprintDetailPage handles stack vs single

## v0.30.0 — 2026-05-05

**Headline:** Blueprint taxonomy reformed (3 categories) + workspace billing pivot + stack blueprint foundation.

- aeqi-platform: Blueprint Category enum (Company/Foundation/Fund) with separate template field; stack blueprint schema with topo-sort + provision_stack; workspace billing gate (10-Company cap)
- aeqi: category-grouped BlueprintsPage with inclusion lists; pricing.ts pivots to $49/mo per workspace
- aeqi-landing: FAQ updated to workspace billing
- 2 example stacks shipped: founder-plus-spinout, vc-fund-with-3-portfolios
- On-chain edge wiring stubbed (status="skipped"), real wiring in Wave 33

## v0.29.0 — 2026-05-05

**Headline:** Polish wave — design token normalization + Quickstart Deploy TRUST guide.

- aeqi: 11 hardcoded fontSize/padding values normalized to tokens (Wave 29 P2 fixes)
- aeqi-docs: Quickstart "Deploy your first TRUST" guide
- ROUTE-AUDIT-V5 confirmed clean — no regressions on color/border/button-variant; design system 85%/95%/95% compliance

## v0.28.0 — 2026-05-05

**Headline:** Real hairlines fix — borders replaced with spacing and tint, not box-shadow swap.

- Hairlines pass-3 (4d8808fd) was cosmetic swap caught by UX-V13
- Real fix shipped (d3fc9745): drop decorative 1px borders, use --space-* spacing and tint shifts (--color-card vs --color-bg-base) per memory feedback_no_hairlines.md
- Form input borders preserved (semantic, focus indicator)
- UX-V13 walk script extended detector (border + box-shadow inset)

## v0.27.0 — 2026-05-05

**Headline:** Trust routing complete (server + client + direct paths). Stale copy stripped.

- aeqi: client-side trust redirect (useEffect on /c/<id> when trust_address arrives)
- aeqi: removed "10% off" stale waitlist copy from signup page
- aeqi: UX-V12 walk script + observations (score 9.6 held)
- aeqi-landing: removed "free to start" stale phrase from SEO meta
- trustsCount=14 (real wizard flow)

## v0.26.0 — 2026-05-05

**Headline:** TRUST is the canonical primitive. /trust/<address> routing live. Config drift from pre-refactor port corrected.

- aeqi-platform: 301 redirect from /c/:entityId/* to /trust/:trustAddress/* when on-chain
- aeqi-platform: venture module stub correctness (abi_encode_params + slot keys + uint16 unifutures)
- aeqi-platform: registerTRUST gas limit 20M→28M for venture template
- aeqi (UI): /trust/:trustAddress route group, useCurrentCompany hook, wizard polls trust_address
- aeqi-core: 4 P1 drift bugs corrected — entity/fund token names "aeqi Entity"/"aeqi Fund", venture executionDelay 3600, fund governance director-only restored
- RefreshTemplates.s.sol re-registers venture+fund on live anvil
- trustsCount=13 from real wizard flow (5 → 13)

## v0.25.0 — 2026-05-05

**Headline:** Bridge fully proven end-to-end through wizard. trustsCount 5 → 8+.

- aeqi-platform: abi_encode_params() for role trust config (was abi_encode wrapping in extra outer tuple, breaking Role module decode)
- aeqi-platform: stub configs for Uniswap + UniFutures modules on plain anvil (no fork required)
- deploy.sh: UI skip optimization on pure-Rust deploys (FORCE_UI=1 to override)
- Bridge verify confirmed: human-in-loop wizard flow creates on-chain TRUSTs successfully

## v0.24.0 — 2026-05-05

**Headline:** P0 wizard fix — Uniswap module impl registered on factory; on-chain Company spawn now works end-to-end via UI wizard.

- aeqi: wizard post-create redirect now uses /c/<id>/overview + refetches entities
- UX rating v10: 9.5/10 (up from 9.3)
- Bridge wizard verify: UI/API layer confirmed end-to-end via Playwright smoke test
- Walk-detector improvements: P0 triage traps documented, wallet probe 400-state handling, cp-to-main footgun prevention

## v0.23.0 — 2026-05-05

**Headline:** UX 9.3 (from 9.1) — Director list-view name, treasury URL detection, landing nav lowercase.

- Director list/cards view: UUID → display name (was only fixed in detail view in v0.22)
- /me/treasury copy: URL-based personal detection (entity.type wasn't reliable)
- aeqi-landing: hardcoded React nav title "AEQI Entity & AA" → "aeqi Entity & AA"
- Walk-detector improvements: body-text scan pattern documented

## v0.22.0 — 2026-05-05

**Headline:** UX score 9.0 — Director name resolution, hairline cleanup, personal treasury vocab.

- Director role occupant: UUID → display name resolved
- Hairlines second pass on 5 surfaces (economy, blueprints-store, components)
- Personal /me/treasury copy: "account" replaces "Company"
- aeqi-docs nav: lowercase entity name
- Playwright UX rating v7 — 9.0/10 (up from 8.8)

## v0.21.0 — 2026-05-05

**Headline:** AA stack proven end-to-end + wallet Phase 2 UI ready + design hygiene Wave 20.

- End-to-end AA proof: deploy → fund Paymaster → submit UserOp via rundler bundler → 184k gas measured
- Wallet Phase 2 UI: Settings now has "Upgrade to passkey" affordance (WebAuthn frontend)
- Indexer vote tallies: forVotes/againstVotes on Proposal type
- Hairlines sweep: 261 → 124 (-52%)
- Governance copy fixes + Director "Unoccupied" fallback
- aeqi/AEQI casing cleanup across templates + docs
- aeqi-docs: wallet-migration guide

## v0.20.0 — 2026-05-05

**Headline:** Wave 16-19 follow-through — Stripe redirect on company create, plan name binding, indexer governance reads, AA migration tool, design token sweeps.

- Stripe checkout redirect on 402 (company create)
- CompanyPlanCard displayName binding
- Pill button cascade + inline 999px strip
- Governance schema align (proposalsForTrust + votingPower live)
- aeqi-paymaster migrate-to-passkey CLI
- WS-1 marginTop + WS-2 fontSize token sweep
- Schema.org pricing $49 single plan
- Inference API public docs page

## v0.19.0 — 2026-05-05

**Headline:** Full on-chain Company mirror (Treasury · Ownership · Governance) + AA stack online (rundler bundler + ERC-7677 paymaster).

**Ships across all three repos:**

- **aeqi**: Treasury, Ownership, Governance tabs read indexed on-chain state; aeqi-inference Phase 1 (DeepInfra provider behind subscription auth); aeqi-paymaster ERC-7677 pm_sponsorUserOperation service; rundler bundler service deployed + smoke tested; 9 Wave-16 design fixes (pill radius, padding tokens, button variants, jade badges, AEQI lowercase, avatar color, plan name UUID, sidebar leak, spacing/typo)
- **aeqi-platform**: WS-5 inference mount (/v1/* behind subscription lane); docs for cross-repo path dep targeting + vps.rs forwarder evolve
- **aeqi-docs**: AA design memos; API REST reference; inference API page; transaction-governance guide; index polish surfacing AA + canonical-templates

No migration required. On-chain indexing surfaces read-only mirrors of treasury/ownership/governance state via existing Platform APIs.

## v0.18.0 — 2026-05-04

**Headline:** Mainnet-deployable TRUST contract (size audit) + token system audit.

- **aeqi-core**: TRUST.sol contract size optimized to 24435 bytes (under EIP-170 24576 limit) by dropping BitFlagGuard inheritance — mainnet deployment now feasible.
- **aeqi**: Design-system token literal hex fallbacks stripped (11 instances, audit P1) — routing verified, no functional change.
- **aeqi-docs**: IPFS content-addressing reference page — CID encoding/decoding patterns for on-chain and off-chain usage.
- **aeqi-platform**: vps.rs X-Forwarded-For carve-out documented + direct-edit-main recovery pattern.

No migration required. All changes are cleanups and documentation.

### Changed
- Token system audited and literal hex values removed from build artifacts.
- TRUST contract bytecode optimized for EIP-170 compliance.

### Documentation
- IPFS content-addressing patterns documented in aeqi-docs.
