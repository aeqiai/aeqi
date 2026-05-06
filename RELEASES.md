# Release Notes

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
