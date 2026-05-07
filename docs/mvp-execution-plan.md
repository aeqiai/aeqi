# MVP Execution Plan

**Status:** Locked 2026-05-03. Revised 2026-05-03 (hardened acceptance criteria, week-by-week milestones, Phase 1 risk coverage, audit timing, Solana decision).
**Companion docs:**
- `wallet-architecture.md` — the on-chain spec (decisions, contracts, build plan)
- `wallet-architecture-faq.md` — mental models behind the architecture
- `app-information-architecture.md` — public/private surfaces, nav, Economy taxonomy

This doc is the **execution layer** — what we ship, in what order, on what dependencies. The other docs describe the destination. This one describes the path.

---

## Headline

Ship in two phases:

1. **Phase 1 — SaaS MVP** (4 weeks, week-by-week milestones below). Full product, no chain. Users get personal Company workspace, agent runtime, joint Company spawn, billing, agents, ideas, quests, events, channels. Wallet stays custodial (current state, transitional). Treasury/Ownership are DB-backed. Governance shows "v2" placeholder.

2. **Phase 2 — Chain integration** (8 weeks, includes 4-6 wk audit overlap). AEQI Entity contracts on Base. Self-hosted bundler + paymaster. Per-runtime indexer. Audit. Retro-deploy existing entities. Treasury/Ownership/Governance become on-chain reads.

The split de-risks shipping. Phase 1 is a working product even if Phase 2 slips. Phase 2 layers on top without breaking Phase 1.

**Total to "non-custodial smart-account-backed product":** ~12 weeks from start of Phase 1, with audit on the critical path for mainnet.

---

## Locked architectural decisions (apply to both phases)

These are non-negotiable and shape every workstream:

1. **User == Company.** Every user has one personal Company entity, auto-created at signup. The user account IS a Company under the hood. Internal architecture only — UI says "Your account" / "Companies" externally.

2. **Per-Company pricing.** $19 first month, $49/mo after. Every user pays for their own personal Company. Joining other Companies as a member is free. Creating additional Companies adds to the bill.

3. **Stripe single-product structure.** One Product (`Company`), one Price ($49/mo recurring), one Coupon (`amount_off: 3000, duration: once`) for first-month $19 effective. Replaces dual-product Founder-fee + Subscription setup.

4. **URL structure (locked, kills `/me/*`).** All Companies at `/c/{slug}` (personal and joint, same routing). Cross-Company aggregations at top-level `/inbox`, `/portfolio`, `/account`. Public Discover at `/`. Personal Company gets auto-generated slug at signup (email prefix or @handle, user-editable).

5. **Brand stays unchanged.** "Company OS for the agent economy" / "Start a company" / unchanged subhead. The user==Company unification is internal architecture, not marketing copy.

6. **No `/economy/*` namespace.** Marketplace verticals at top-level `/companies`, `/agents`, `/bounties`, `/blueprints`. Brand "æconomy" stays as the surface name.

7. **No third-party SaaS in foundations.** Auth, keys, wallets, identity, indexing all built in-house. Privy / Magic / Dynamic / Coinbase Smart Wallet contracts / TheGraph hosted are all out.

8. **Per-runtime indexer (Phase 2).** Each runtime indexes its own Entity into its own Postgres. Sovereign by default. Self-hosters get this for free.

9. **Optional network registry (Phase 2).** aeqi-platform-side service that mirrors public chain data network-wide for Discover. NOT used by self-hosters unless they want their own Discover. Public-only data — never aggregates tenant-private state.

10. **Checkpoint discipline.** Every successful ship tags main as `checkpoint-YYYY-MM-DD-NN`. Rollback = `git reset --hard checkpoint-X` + redeploy. <5min recovery target, instrumented (see § Checkpoint discipline).

11. **Phase 1 custodial is transitional.** Existing Phase-1 wallet stack stays custodial because rebuilding non-custodial chain layer takes 8+ weeks and gates revenue. Phase 2 migrates everyone. Marketing copy in Phase 1 says "smart wallet on-chain coming Phase 2" — does NOT claim non-custodial during Phase 1 window.

12. **Public Companies default-public for joint Companies, default-private for personal.** Per `app-information-architecture.md`. Privacy implications surfaced at signup ("Your Company will appear on Discover") with opt-out toggle.

---

## Phase 1 — SaaS MVP scope

**Goal:** ship a complete, paid, working product that users can sign up for, pay $19, run their personal Company workspace + agents, optionally spawn joint Companies with cofounders. Real billing, real data, real value — no chain.

### Week-by-week milestones

```
WEEK 1 — Foundation + isolated work
  Mon-Tue   #58 checkpoint discipline wired into /ship
            #51 Stripe restructure (single Product + coupon)
  Wed-Fri   #54 DB unification design + migration plan written
            Audit firm outreach (Spearbit / Trail of Bits / OpenZeppelin) — book audit slot
            Per-runtime indexer schema designed (deferred impl to Phase 2)
  GATE      Stripe in test mode charging $19/$49 correctly. Migration plan reviewed.

WEEK 2 — DB unification + IA refactor (backend)
  Mon-Wed   #54 DB unification IMPLEMENTED (users table thinned, entities table populated, memberships table)
            Slug auto-generation logic (email prefix → entity.slug, collision resolver)
  Thu-Fri   #50 IA refactor — backend routes (/c/{slug}, /inbox, /portfolio, /account)
            Old /me/* routes redirect to /c/{personal-slug}/*
  GATE      Existing user data migrated cleanly in staging. /c/{slug} routing returns correct entity.

WEEK 3 — IA refactor (frontend) + cross-Company surfaces
  Mon-Wed   #50 IA refactor — frontend (top nav, left vertical Economy nav, sidebar Companies list)
            Personal Company renders identically to joint Company (per IA doc)
            #57 cross-Company /inbox + /portfolio + /account surfaces wired
  Thu-Fri   #55 Joint Company spawn flow (modal, $19 charge, slug pick, role % sliders)
            Cofounder onboarding flow: invite by email → if not aeqi user, signup-with-pay flow → land in joint Company
  GATE      End-to-end flow works locally: signup → personal Company → spawn joint → invite cofounder → cofounder signs up + pays + lands in joint.

WEEK 4 — Polish + pre-launch infra + ship
  Mon-Wed   #56 Agent runtime UX audit (chat, ideas, quests, events, channels)
            Pre-launch infra parallel: #28 deploy.sh fixes, #29 JWT mint, #30 smoke cron, #31 legal pages, #32 webhook test, #33 abuse rate-limiting
  Thu       Production smoke pass against all 10 acceptance criteria
            Ship readiness gate review
  Fri       Phase 1 LAUNCH — open signups, post on socials, monitor
```

Each milestone day-range is a hard checkpoint — if a gate fails, the week extends, no skipping. Phase 1 launch happens when all gates pass, not on the calendar date.

### What ships in Phase 1

| Surface | Status |
|---|---|
| `/` Discover (public Economy front door) | New |
| `/c/{slug}` Company workspace (personal AND joint, identical routing) | Refactored |
| `/inbox` cross-Company aggregated inbox | Refactored from current `/` |
| `/portfolio` cross-Company holdings (DB-backed) | New |
| `/account` aeqi auth identity (email, password, passkey, payment method) | New |
| `/companies`, `/agents`, `/bounties`, `/blueprints` | New (Discover verticals) |
| Top bar globals (logo + search + inbox bell + avatar) | New |
| Left vertical Economy nav | New |
| Signup → personal Company entity (DB row, no chain) | Refactored |
| Joint Company spawn ($19 → DB entity row + members + role %s) | Refactored |
| Stripe billing (single Product + first-month coupon) | Refactored |
| Cofounder invite flow (email → signup-and-pay → join joint) | New |
| Agent runtime + ideas + quests + events + channels + integrations | Already shipped, audit-pass |
| Custodial wallet (current state) | Quarantined as "legacy custodial path until Phase 2" |
| Abuse rate-limiting on signup + Company creation | New (#33) |
| Smoke cron + JWT mint + legal pages + webhook test | New (pre-launch infra) |

### What's deferred to Phase 2

| Surface | Phase 1 state | Phase 2 state |
|---|---|---|
| Treasury tab | Stripe-side spend + plan budget cap, "On-chain coming v2" banner | + on-chain ETH/USDC/NFT balances |
| Ownership tab | DB-backed membership rows + role %, "On-chain coming v2" banner | On-chain cap table from per-runtime indexer |
| Governance tab | "Voting opens when this Company goes on-chain (v2)" placeholder | Real proposals/votes from indexer |
| Wallet model | Custodial EOA (current), banner: "Smart wallet upgrade coming Phase 2" | Passkey + AEQI Entity smart account |
| Self-host story | Not yet — chain layer makes self-host meaningful | Full open-source release of runtime; platform stays proprietary |
| Recovery via timelock | Email-only recovery (current Stripe-style flow) | On-chain `recoveryFacilitator` + 7-day timelock |
| Session-key agent delegation | Server-side policy enforcement | On-chain enforcement via session-key module |

### Phase 1 acceptance criteria (testable, with edge cases)

A new user can:

1. **Signup happy path.** Sign up via email + OTP at `/`. Receive 6-digit code within 30s. Enter code, land at Stripe Checkout in <2s.
   - **Edge:** OTP code expired (>10 min) → resend flow works
   - **Edge:** OAuth provider (Google) returns error → fallback to email signup offered, no data loss
   - **Edge:** GitHub returns noreply email → prompt for real email post-OAuth, soft-required for billing

2. **Payment happy path.** Pay $19 (first-month coupon applied automatically) via Stripe Checkout. Receive receipt email within 60s.
   - **Edge:** Card declined → retry flow, no Company created, user can retry without losing form data
   - **Edge:** 3DS challenge → completes in popup, returns to checkout
   - **Edge:** Stripe webhook delayed/missed → reconciliation job catches it within 5 min, Company creation completes
   - **Edge:** Duplicate Stripe webhook (idempotency) → only one Company created, idempotency key enforced

3. **Personal Company landing.** Land at `/c/{their-auto-slug}` within 3s of payment success. Slug generated from email prefix (e.g., `alice@example.com` → `alice`). Collision resolver appends `-2`, `-3`.
   - **Edge:** Slug collision (alice already taken) → user prompted to pick alternative before completing signup
   - **Edge:** Slug contains restricted chars (admin, api, c, u, entity, inbox, portfolio, account) → rejected, user prompted

4. **Agent runtime end-to-end.** Use the agent runtime: send a chat message, create an idea, spawn a quest, configure an event, connect a channel. Each completes in <5s server-side.
   - **Edge:** LLM call fails (rate limit, provider outage) → graceful degrade, retry queued, user sees status
   - **Edge:** Token cap reached for the month → user notified, throttled, can upgrade

5. **Joint Company spawn.** Spawn a joint Company at "+ New Company" → $19 Stripe charge → land at `/c/{joint-slug}`. Joint Company creator becomes Founder role, 100% cap table by default.
   - **Edge:** Slug collision → prompted at modal step, no charge until slug confirmed
   - **Edge:** Payment fails → no entity created, no membership created
   - **Edge:** Refresh during checkout → state preserved, can resume

6. **Cofounder add by email.** Add cofounders to the joint Company by email, assign role %s.
   - **If cofounder is existing aeqi user:** invitation email → accept link → membership created, no payment required (they already pay for their personal Company)
   - **If cofounder is NOT a aeqi user:** invitation email → they sign up via the invite flow → pay $19 for THEIR personal Company → join the joint Company (free)
   - **Edge:** Invitation declined → original user notified, role % returned
   - **Edge:** Invitation expires (7 days) → automatic cleanup
   - **Edge:** Cofounder email is invalid → bounce handler, original user notified

7. **Cross-Company /inbox.** View `/inbox` aggregated across all Companies user is in (personal + every joint). Notifications sorted by recency, marked read/unread, filterable by Company.
   - **Edge:** User in 50 Companies → pagination/perf scales
   - **Edge:** Old notifications (>90 days) → archived, accessible via filter

8. **Cross-Company /portfolio.** View `/portfolio` showing held equity %s across all Companies. Updates within 5s of cap table change.
   - **Edge:** User is sole owner of 1 personal Company → portfolio shows 100% of self
   - **Edge:** User has zero joint Companies → portfolio shows just personal

9. **Cancel subscription.** Cancel via Stripe Portal at `/account` → access remains until current period ends → on period end, Company enters read-only mode (existing data preserved, no new actions).
   - **Edge:** Cancel mid-period for a joint Company they CREATED → joint Company also enters read-only unless ownership transferred to another paying member first
   - **Edge:** Resubscribe within grace period (30 days) → seamless restoration

10. **Long-term return.** Sign back in months later → all Companies, agents, ideas, quests, history intact. If subscription lapsed, see "Reactivate" CTA → restore in <2 min.
    - **Edge:** Account inactive >12 months → reactivation requires re-verifying email
    - **Edge:** Forgot password → email-OTP recovery flow works (Phase 1 simple flow; Phase 2 adds on-chain timelock)

When all 10 hold (including all edge cases verified in staging), Phase 1 ships.

### Phase 1 ship readiness gate

ALL must pass before Phase 1 LAUNCH:

- [ ] All 10 acceptance criteria pass in staging (including edges)
- [ ] Smoke cron green for 48h continuous
- [ ] Stripe webhook reconciliation tested with simulated failure (drop 5% of webhooks, verify recovery)
- [ ] Database migration run on staging copy of prod data, zero data loss verified
- [ ] All `/c/{slug}` URLs route correctly; old `/me/*` URLs redirect or 404 cleanly
- [ ] Legal pages (TOS, Privacy, Refund) reviewed and posted
- [ ] Abuse rate-limiting verified (>10 signups/IP/min throttled, >3 Companies/user/hour throttled)
- [ ] No P0 bugs open in tracker
- [ ] Checkpoint tag created and rollback tested in staging

---

## Phase 2 — Chain integration scope

**Goal:** every Phase 1 entity gets an on-chain AEQI Entity contract on Base. Custodial wallets migrate to passkey-native. Treasury/Ownership/Governance read on-chain state. Indexer + audit + paymaster + bundler ship.

### Audit timing — booked during Phase 1 Wk 1

Top firms (Spearbit, Trail of Bits, OpenZeppelin) have 4-12 wk lead times. To hit Phase 2 Wk 4-7 audit window, **audit must be booked during Phase 1 Wk 1**, contingent on draft contracts being available by Phase 2 Wk 3.

If no top firm has Wk 4-7 capacity, fallback options:
- Defer mainnet to Wk 8-10 with later audit slot (acceptable — Sepolia testing continues)
- Use second-tier firm (Cantina, Code4rena, etc.) — only if reputation tradeoff acceptable
- Internal review + bug bounty in lieu of audit — only if scope is genuinely small (<500 LOC of novel Solidity); NOT recommended for Entity contract which has cap table + roles + governance + session keys

### Workstreams — week-by-week

Per `wallet-architecture.md` § Build plan:

| Wk | WS-A Solidity | WS-B Infra | WS-C Backend | WS-D Frontend | WS-E Audit |
|---|---|---|---|---|---|
| 1 | Entity skeleton + factory | Paymaster on Sepolia, EntryPoint funded | Per-runtime indexer schema implemented | — | (booked from Phase 1 Wk 1) |
| 2 | Entity v1 + recovery facilitator | silius bundler stood up | Counterfactual address library | Passkey enrollment UI design | — |
| 3 | Entity v1 deployed Sepolia | Test UserOp end-to-end | Wallet lib refactor | Passkey enrollment UI built | Audit kickoff (contracts handed off) |
| 4 | Module library (cap table, roles) | Paymaster Rust signer | Deploy-on-first-action wired | Signer mgmt UI | Audit Week 1 |
| 5 | Session-key module | Sponsorship policy → Stripe link | Stripe per-Company billing wired | Treasury wired to RPC (Sepolia) | Audit Week 2 |
| 6 | Governance module | Mainnet readiness checks | Indexer wired to Treasury / Ownership / Governance tabs | Migration UI for Phase 1 → Phase 2 | Audit Week 3 |
| 7 | Audit fixes | Mainnet deploy rehearsal on Sepolia | End-to-end Phase 2 flow on Sepolia | Migration flow tested | Audit Week 4 (final report) |
| 8 | Mainnet deploy | Mainnet go-live, monitoring | Migration flow goes live | Migration banner UX | Post-audit fixes deployed |

### Phase 1 → Phase 2 migration story (hardened)

Existing Phase 1 entities (DB-backed, custodial wallet) need to migrate to on-chain Entity contracts. Migration is **opt-in, per-Company, triggered by qualifying action**.

**The flow:**

1. User taps "Activate on-chain" (or attempts a chain-only action: issue equity, propose, on-chain transfer)
2. Modal: "Activating your on-chain Company. We'll deploy the contract for you. Sign once with Face ID."
3. User enrolls passkey (if not already enrolled) → P-256 keypair in Secure Enclave
4. We compute Entity address counterfactually from passkey pubkey
5. UserOp deploys Entity, paid by paymaster, takes ~5s
6. **Critical:** for Companies with existing DB-backed treasury value, migration sweeps funds into Entity:
   - DB-tracked treasury balance (Stripe-side spend tracking) is informational only — no actual funds move (no funds existed on-chain for Phase 1)
   - DB-tracked cap table (membership rows + role %) is mirrored on-chain at Entity deploy via initialization params
   - All existing roles, agents, integrations, ideas, quests, events, channels remain pointing at the same Entity (now on-chain)
7. Custodial EOA from Phase 1 is added as a SIGNER on the new Entity (transitional), then removed on user confirmation after grace period

**Risks specifically for migration:**

- **User has significant LLM spend / agent activity in Phase 1** but no on-chain funds → migration is metadata-only, no risk
- **User has cofounders who haven't migrated** → joint Company can be migrated by Founder (creator); cofounder signers added as the Entity addresses they get when THEY migrate; if cofounder hasn't migrated, their slot reserved with their custodial EOA address (placeholder) until they activate
- **User refuses to migrate** → Phase 1 custodial mode supported indefinitely as legacy; on-chain features (real treasury, governance, equity issuance) unavailable for that Company

### Phase 2 acceptance criteria

A user existing from Phase 1 can:

1. Click "Go on-chain" (or trigger qualifying action — issue equity / propose / treasury op)
2. See modal: "Activating your on-chain Company. We'll deploy the contract for you. Sign once with Face ID."
3. Tap Face ID → AEQI Entity deploys at counterfactual address derived from passkey
   - **Edge:** Bundler down → graceful queue, user notified, retries automatically
   - **Edge:** Paymaster out of funds → fallback to user-paid gas with clear cost preview
4. Their `/c/{slug}/treasury` now shows on-chain ETH/USDC balances within 60s of deploy
5. Their `/c/{slug}/ownership` reads cap table from per-runtime indexer
6. Their `/c/{slug}/governance` allows real proposals + votes
7. They can issue equity to a cofounder (one Face ID tap, atomically: add signer + assign role + grant %)
8. They can revoke aeqi's session-key delegation any time (one tap, on-chain enforced immediately)
9. Migration is reversible until first on-chain action — they can roll back to custodial Phase 1 state if needed

A new user post-Phase-2 launch:
1. Signs up → personal Company entity creates AND deploys to Base in one flow
2. Same UX as Phase 1, just with chain primitives present from day one

### Phase 2 ship readiness gate

ALL must pass before Phase 2 mainnet LAUNCH:

- [ ] Audit final report received, all P0/P1 findings resolved
- [ ] All Phase 2 acceptance criteria pass on Sepolia for 7 consecutive days
- [ ] Mainnet deploy rehearsal on Sepolia executed without issue (full deploy + paymaster fund + bundler config + first user flow)
- [ ] Indexer keeps up with realistic load (1000+ Entity events per minute simulated)
- [ ] Migration flow tested on staging copy of prod data — zero loss of Phase 1 state
- [ ] Paymaster sponsored gas budget set + monitoring + alerts wired
- [ ] Bundler uptime SLA defined + monitoring + alerts wired
- [ ] Mainnet deploy script tested + rollback documented
- [ ] On-call rotation scheduled for first 2 weeks post-launch
- [ ] Phase 1 → Phase 2 migration banner UX reviewed by 5+ Phase 1 users in staging

---

## Workstream owners (multi-team plan via subagents)

The plan is for a solo founder dispatching parallel subagents. Each workstream is a track that can run in parallel with others.

| WS | Title | Phase | Owner | Critical-path | Blocks-on |
|---|---|---|---|---|---|
| A | Solidity (AEQI Entity contracts) | 2 | Solidity engineer (subagent) | Yes | — |
| B | Bundler + paymaster ops | 2 | Infra engineer (subagent) | Yes | — |
| C | Platform integration (signup wiring, indexer) | 1 + 2 | Platform engineer (founder/subagent) | Yes | WS-A (Phase 2 indexer needs Entity ABI) |
| D | Frontend (IA refactor, workspace surfaces, wallet UX) | 1 + 2 | Frontend engineer (subagent) | Yes | WS-C (Phase 2 wallet UX needs deploy-on-first-action API) |
| E | Audit (Spearbit / Trail of Bits / OpenZeppelin) | 2 | External | Mainnet-blocking only | WS-A (needs draft contracts by Phase 2 Wk 3) |
| F | Pricing (Stripe restructure) | 1 | Founder | No (isolated) | — |
| G | Network registry (Discover aggregator) | 2 | Platform engineer (subagent) | No (post-MVP) | WS-A (needs deployed Entity ABI) |

**Coordination rules:**
- WS-D can start frontend mocks in Phase 2 Wk 1-2 against stub APIs; real integration with WS-C blocks at Wk 3-4
- WS-A and WS-B can run fully parallel until Phase 2 Wk 3 (they meet at the Sepolia paymaster/bundler integration test)
- WS-E (audit) only blocks mainnet — Sepolia work continues during audit

---

## Phase 1 task order (hardened dependency graph)

Explicit blocks-on / blocks-which relationships:

```
#58 checkpoint discipline ───────────► (process, no blocks, ship anytime)

#51 Stripe restructure ───────────────► blocks #55 (Joint Company spawn needs working billing)
                                          ► doesn't block #54, #50, #57

#54 DB unification + slug ────────────► blocks #50, #55, #57
                                          ► critical foundation — start of Wk 2

#50 IA refactor (URL, nav) ───────────► blocked by #54
                                          ► blocks #57 (cross-Company surfaces need /inbox URL)

#55 Joint Company spawn ──────────────► blocked by #54, #51
                                          ► blocks cofounder onboarding (which is part of #55)

#57 Cross-Company surfaces ───────────► blocked by #54, #50
                                          ► doesn't block #55, #56

#56 Agent runtime polish ─────────────► independent, ship Wk 4

#28-#33 Pre-launch infra ─────────────► independent, ship parallel any week
```

**Critical path (longest dep chain):** #54 → #50 → #57 → ship gate. ~3 weeks minimum.

**Foundation Wk 1:** #58 + #51 + audit booking + indexer schema design. Fully parallel.

**No skipping.** If a dependency check fails, the dependent task waits. Don't start #50 if #54 is broken in staging.

---

## Hidden assumptions surfaced

These are non-trivial pieces the plan previously implied but didn't design. Each needs a design step before implementation.

### Per-runtime indexer schema (Phase 2 Wk 1)

**Assumption:** "per-runtime indexer" is one line in the plan but it's real infrastructure.

**Design needed:**
- What events does the indexer ingest? (Entity deploy, signer added/removed, role changes, cap table changes, session key issued/revoked, governance proposals, governance votes, treasury transfers in/out)
- Schema (Postgres tables for each event type, indexes for common queries)
- Replay strategy (start from block N, follow tip)
- Reorg handling (depth threshold for confirmed; rollback on reorg)
- Fork/chain split handling (which fork wins? lookups during fork ambiguity)
- Backfill (when a new runtime spins up, how does it catch up to current state?)

**Recommendation:** dedicated 0.5-day design session in Phase 1 Wk 1. Output: a `docs/indexer-design.md` doc. Implementation in WS-C during Phase 2 Wk 1-2.

### Paymaster sponsorship policy code (Phase 2 Wk 4)

**Assumption:** "Sponsorship policy = if user has paid Stripe / has trial credit, sponsor up to $X gas" is one line.

**Design needed:**
- What's the actual `$X` per user per period? Hard cap? Soft cap with grace?
- How does the paymaster Rust service query Stripe state? (Cache? Direct API call per-UserOp?)
- What's the response when a user exceeds budget? (Fall back to user-paid gas? Reject UserOp? Soft cap with overdraft?)
- How is policy versioned / updated without a redeploy?
- How is policy attack-resistant? (Replay protection, sybil resistance, etc.)

**Recommendation:** design doc by Phase 2 Wk 3. Implementation in WS-B Wk 4.

### Slug collision UX (Phase 1 Wk 2)

**Assumption:** "collision handler appends -2, -3" is one line.

**Design needed:**
- At which step in signup does the user see their slug? (Right after email verification? In Stripe Checkout? After payment?)
- If `alice` is taken, do we silently make them `alice-2` or prompt?
- Can users edit slug post-signup? (Yes per locked decisions, but with what cooldown? what redirect logic for old URL?)
- What chars are allowed? (Lowercase alphanumeric + hyphen, length 3-30, no leading/trailing hyphen)
- What's reserved? (admin, api, c, u, entity, inbox, portfolio, account, blueprints, agents, bounties, services, companies, discover, settings, sign-in, sign-up, login, signup, etc.)

**Recommendation:** design as part of #54 in Phase 1 Wk 1-2. UX prompt-on-collision (better UX than silent suffix). Reserved list in code, gated.

### Cofounder onboarding billing trigger (Phase 1 Wk 3)

**Assumption:** addressed in acceptance criteria #6 but not in workstream plan.

**Design needed:**
- Email invitation template + CTA → "Join {creator-name}'s Company on aeqi"
- If cofounder is new: signup flow that LANDS them in the joint Company after their personal Company is created and paid
- If cofounder is existing user: in-app notification + accept button (no payment, instant join)
- Role % is set by Founder pre-invite OR negotiated post-invite? (Lean: pre-set by Founder, cofounder accepts or declines)
- What happens to the % allocation if cofounder declines? (Returns to Founder)
- Invitation lifecycle (created → accepted/declined/expired) → state machine

**Recommendation:** part of #55, designed in Phase 1 Wk 2, implemented Wk 3.

### Stripe webhook reliability (Phase 1 Wk 1)

**Assumption:** Stripe webhooks are reliable. They mostly are, but ordering, duplicates, and missed delivery happen.

**Design needed:**
- Idempotency keys on all webhook handlers
- Reconciliation cron that polls Stripe for state mismatches every 5 min
- Handler retries with exponential backoff
- Dead-letter queue for permanently-failed webhooks
- Alerting on webhook handler failure rate > 1%

**Recommendation:** part of #51 in Phase 1 Wk 1.

---

## Open decisions (operationalized — each has trigger or recommended close-out)

| Decision | Trigger / recommendation | Default if no decision |
|---|---|---|
| **Solana port (Colosseum hackathon)** | **HARD DEFER unless hackathon is 6+ wks out AND budget is genuinely available.** Current recommendation: defer to v2 (Q1 2027). Reason: 4-6 wk minimum port + $20-30k separate audit budget + ongoing 2x maintenance forever. Solo dev cannot sustain two stacks during MVP. Revisit only when (a) >20% of inbound asks Solana, OR (b) explicit grant funding for Solana port materializes. | Defer — EVM only for MVP and Phase 2 |
| **Audit firm** | **Decide by end of Phase 1 Wk 1.** Outreach to all three (Spearbit, Trail of Bits, OpenZeppelin) in parallel. Pick whoever has Wk 4-7 availability AND smart-account experience. Recommendation: Spearbit (most consumer + smart-account audits in 2024-2025). | Spearbit |
| **Pro-tier feature list** | After Phase 1 launches and Standard validates with 100+ paying customers (~2 months post-launch). | Standard-only at MVP |
| **LLM token caps per tier** | Unit-economics modeling required by Phase 1 Wk 3 (before billing wiring is finalized). Need actual cost data on average agent invocation cost across model mix. | $30-50 worth of compute per Standard sub, throttled at hard cap with notification |
| **Personal Company slug format** | **Decide by Phase 1 Wk 1.** Recommendation: email prefix → entity.slug, collision resolver prompts user (not silent suffix). Reserved-slug list maintained in code. | Email prefix with prompt-on-collision |
| **Network registry build (#52)** | Build trigger: Phase 2 launch + 30 days of Discover surface usage data. If Discover engagement low, defer to v3. If high, build in Phase 2 Wk 9-10. | Build Phase 2 Wk 9-10 |
| **Self-host runtime open-source release** | **Defer to v3 unless explicit demand.** Open-sourcing while shipping is high-cost (docs, contributor onboarding, security disclosure process). Reframe Phase 2 plan to NOT include open-source release; frame self-host story as "available v3 / Q2 2027." | Defer to v3 |
| **Joint Company creator transferring billing to another member** | Phase 1 ship blocker if it doesn't work. Recommendation: ship transfer flow in Phase 1 Wk 4 (part of cancel flow #9 acceptance criteria). | Ship in Phase 1 Wk 4 |

---

## Risks + mitigations

### Phase 1 risks (newly added — previously underrepresented)

| Risk | Impact | Mitigation |
|---|---|---|
| **Stripe webhook missed/duplicated** | Charge succeeds but Company never created (or duplicate Company) | Idempotency keys + reconciliation cron every 5 min + dead-letter queue + alerting on handler failure rate >1% |
| **OAuth provider outage** during high-conversion window (post-marketing post) | Signups drop to zero | Email signup as fallback, prominently surfaced; status banner if OAuth down |
| **LLM cost overrun** before throttle kicks in | Negative gross margin on power users | Hard cap on LLM spend per Company per day, configurable. Throttle before charge instead of after. Stripe-side spend visible in real-time on Treasury tab. |
| **Bot/abuse signup spam** (someone scripts Company creation) | Fraud, infra cost spike | Rate-limit signup per IP (10/min) and per device fingerprint; rate-limit Company creation per user (3/hour); CAPTCHA on suspicious patterns; require Stripe payment to land first Company |
| **Email deliverability issues** (transactional emails landing in spam) | Users locked out of recovery, OTP signup broken | Use established transactional ESP (Postmark/SendGrid), warm IPs, monitor bounce rate, fallback to in-app code display for OTP |
| **DB migration breaks during Phase 1 Wk 2** | Phase 1 timeline slips, possible data loss | Migration tested on staging copy of prod data BEFORE staging deploy; rollback script ready; checkpoint tag immediately after migration runs cleanly |
| **Slug collision during high signup velocity** | Two users picking same slug at same time | Use Postgres unique constraint + retry-with-suffix on conflict; user prompted to pick alternative if their first choice taken |
| **Cofounder invitation flow confusion** | Cofounders bounce instead of paying $19 | UX walkthrough: invite email is super clear about "you'll need to pay $19 for your own personal aeqi Company"; landing flow makes it obvious why they're paying |
| **Search engine indexing public Companies** before users understand defaults | Privacy embarrassment | At signup, default joint Company to private until creator explicitly toggles public; opt-in to /companies directory; clear defaults explained in modal |

### Phase 2 risks (refined from previous version)

| Risk | Impact | Mitigation |
|---|---|---|
| Audit slips past Wk 7 → mainnet date slides | Phase 2 launch delayed 2-4 weeks | Inquire by Phase 1 Wk 1; have backup firm queued; Sepolia testing continues during slip |
| Phase 1 user growth gates Phase 2 priorities | Distraction during chain build | Hard schedule split — Phase 2 work in dedicated sprints, not interleaved with Phase 1 ops; founder time-blocks |
| Solana hackathon temptation creates parallel track | Both tracks slip | Per Open decisions: HARD DEFER unless explicit criteria met |
| Chain integration breaks existing Phase 1 customers | User trust damage | Retro-deploy is opt-in, not mandatory; existing entities work without on-chain side until user clicks "Go on-chain"; migration is reversible until first on-chain action |
| Custodial-to-passkey migration loses keys | Catastrophic | Migration window with both signers active; 7-day timelock on signer rotation; existing custody path stays as fallback for non-migrated users; staging migration tested with prod data copy |
| Paymaster gas budget burns out under heavy load | Phase 2 unusable for users without on-chain funds | Hard cap per user per day; alerts at 50% / 80% / 100% of daily budget; auto-throttle at 100%; user can pay own gas with clear pricing |
| Bundler down during user signup → can't deploy Entity | Signup conversion drops | Monitor bundler uptime; graceful queue (UserOp pending); fallback to alternate bundler (e.g., Pimlico) ONLY if our bundler down >5 min; alert on this fallback (it's a vendor-lock-in event) |
| Indexer falls behind → Treasury/Ownership shows stale data | User confusion, support load | Indexer monitoring with lag alert >30s; fallback to direct RPC for treasury reads if indexer lag >2 min |
| EIP-7702 / native AA changes break our 4337 stack | Forced rewrite | Monitor Pectra upgrade timeline; design Entity contract with upgrade hooks for signer-validation logic; keep contract minimal (cap table + roles + governance separate from signer logic) |

---

## Checkpoint discipline (instrumented, not aspirational)

Every successful `/ship` that includes a deploy, auto-tag main:

```bash
# at end of /ship pipeline, after deploy verifies green
NEXT=$(git tag --list 'checkpoint-*' --sort=-v:refname | head -1 | awk -F- '{print $NF+1}')
DATE=$(date +%Y-%m-%d)
git tag -a "checkpoint-${DATE}-$(printf '%02d' ${NEXT:-1})" -m "<commit subject>"
git push origin --tags
```

**Tag preconditions (instrumented in /ship):**
- `npm run verify` exits 0
- `cargo test --workspace` exits 0 (when Rust touched)
- post-deploy curl smoke: `health` endpoint returns 200 within 30s
- post-deploy UI hash matches source: `cat dist/index.html | grep index-XXX.js` matches `curl https://app.aeqi.ai/ | grep index-XXX.js`

If any precondition fails, tag is NOT created. Ship completes (deploy may have happened) but rollback target stays at previous checkpoint.

**Rollback recipe** (when a future ship breaks something):
```bash
# Find last good checkpoint
git tag --list 'checkpoint-*' --sort=-v:refname | head -3

# Reset main to it
git reset --hard checkpoint-2026-05-03-04
git push --force-with-lease origin main

# Redeploy from that state
./scripts/deploy.sh   # or ui-deploy.sh
```

**Recovery time target: <5 min, measured.** Each rollback drill in staging logs the elapsed time; if any drill exceeds 5 min, the script gets debugged before the next ship.

**Checkpoint tagging discipline gate:** Phase 1 cannot launch until at least 5 successful ship cycles have produced checkpoints, and at least 1 rollback drill has been completed in staging in <5 min.

---

## Memory entries to sync (action items)

When this plan is adopted, update:

1. `project_company_rail_v1.md` — Inbox URL update, /me killed reflected
2. `project_fifth_layer_economics.md` — URL move to /
3. `project_personal_rail_v1.md` — annotate: "rendering rules for kind=personal Companies in /c/{slug}; degenerate tabs hidden"
4. `architecture_user_account_is_company.md` — update URL section (slugs at /c/{slug})
5. `project_pricing_per_company.md` — implementation note: single Stripe Product + coupon, not dual-product
6. `project_solana_port_colosseum.md` — update with HARD DEFER recommendation unless trigger criteria met
7. New entry: `project_mvp_execution_plan.md` — pointer to this file
8. New entry: `feedback_checkpoint_tagging.md` — locks checkpoint discipline as a process rule
9. New entry: `architecture_indexer_design.md` — pointer to indexer design doc (after design step completes Phase 1 Wk 1)

---

## TL;DR

**Phase 1 (4 weeks, week-by-week milestones):** ship the SaaS product. No chain. User signs up, pays $19, gets personal Company at `/c/{slug}`, runs agents, spawns joint Companies. Treasury/Ownership are DB-backed. Custodial wallets quarantined as transitional. 10 testable acceptance criteria with edge cases. 9-item ship readiness gate.

**Phase 2 (8 weeks, audit on critical path):** layer chain on top. AEQI Entity contracts. Passkey signing. Per-runtime indexer. Self-hosted bundler + paymaster. Audit booked during Phase 1 Wk 1. Treasury/Ownership/Governance become on-chain reads. Existing Phase 1 entities retro-deploy on-demand. Migration is reversible until first on-chain action. 9-item Phase 2 ship readiness gate.

**Both phases share**: the user==Company unification, per-Company pricing, single-product Stripe, `/c/{slug}` URL convention, no /me/, top-level cross-Company views, brand unchanged, checkpoint tagging on every ship.

**Critical-path workstreams**: Solidity (WS-A) → Backend (WS-C) → Frontend (WS-D). Bundler/Paymaster (WS-B) parallel. Audit (WS-E) blocks mainnet only. Network registry (WS-G) post-MVP. Solana hard-deferred.

**Process discipline**: every ship tags a checkpoint with instrumented preconditions. Rollback recipe is documented and <5min — measured each drill. Phase 1 launch gates on 5+ successful checkpoint cycles and 1 successful rollback drill.

**Hidden assumptions surfaced** (each gets a design step before implementation): per-runtime indexer schema, paymaster sponsorship policy, slug collision UX, cofounder onboarding billing trigger, Stripe webhook reliability.

**Risks coverage hardened** for Phase 1 (Stripe webhooks, OAuth outage, LLM cost overrun, bot abuse, email deliverability, DB migration, slug collision, cofounder confusion, public Company defaults).

The product is unprecedented in composition. The plan is honest about scope. The checkpoints make it safe to move fast. Let's ship it.
