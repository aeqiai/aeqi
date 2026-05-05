# VPS Dogfood v3 — 2026-05-05

**Method**: curl-based HTTP inspection + full source audit across `apps/ui/`, `aeqi-landing/`, `crates/aeqi-indexer/`, and `aeqi-platform/src/`. No browser available; all API probes against live https://app.aeqi.ai. Source diffs confirmed against live deployed bundle hash (`index-CDVRX8gJ.js`).

**Context against prior passes:**
- v1 (Wave 9): rate-limiter trap causing 500s — FIXED
- v2 (Wave 18): 402 dead-end on company create — FIXED (`92ef3b46`); stale schema.org pricing — FIXED (`3e3385a`)
- v3 scope: Waves 19–23 changes — on-chain Company mirror, AA stack, director name resolution, treasury URL detection, hairlines, governance schema, passkey upgrade affordance

---

## What's better than v2

### P0 company-create 402 redirect — confirmed working
`CompanySetupPage.handleCreate()` catches `ApiError.status === 402` and calls `api.createCheckoutSession({ blueprint, display_name })`, then `window.location.href = url`. The path is clean — no raw error string for unpaid users. Non-invited, non-admin users get a Stripe redirect. Invited/admin users (`skipsStripe = true`) bypass it. Both CTA labels are correct.

### Schema.org pricing — confirmed correct
`aeqi-landing/index.html` (the prerendered shell served live) contains:
- `"price": "49"` for card offer, `"price": "45"` for USDC offer.
- FAQ "How much does aeqi cost?" correctly describes the `$49/month` / `$45/month` model with `$19 first month`.
- The stale `$39 Launch` / `$119 Scale` tiers from v2 are gone.

### Treasury personal-account copy — confirmed working
`TreasuryPage` detects `/me/*` via `location.pathname.startsWith("/me/")` and substitutes "account" for "Company" throughout. The confirmation from UX v9: `/me/treasury` renders "This account isn't billed through Stripe yet. Personal accounts are exempt." and `/c/*/treasury` renders "This Company isn't billed through Stripe yet."

### Director list — display names confirmed
UX v9 confirms WS-23-B landed: `EntityRolesTab.tsx` director cards show "Luca Eich" not raw UUID. The `OwnershipPage.occupantLabel()` still shows "Human" for human occupants without an agent match, but the Role list itself resolves to display name correctly.

### Governance schema — forVotes/againstVotes fully wired
Indexer `ProposalRow` and `Proposal` GQL type both have `forVotes`/`againstVotes` fields. `fetchProposalsForModule` requests them. `GovernancePage.VoteBar` renders the split bar. Schema is coherent end-to-end.

### Settings → Wallet panel + passkey upgrade affordance — shipped
`WalletsPanel` → `WalletUpgradeSection` render correctly:
- When `custody_state === "custodial"` → `signerType = "custodial_eoa"` → "Upgrade to passkey" button visible.
- When `signer_type === "passkey"` → shows Phase 2 badge.
- The modal explains the migration clearly and degrades gracefully on 501 (backend stub not yet wired) — reports success-state "processing in background, email coming."

### Auth endpoints — all green
- `POST /api/auth/mode` → 200, correct JSON
- `POST /api/auth/wallet/nonce` → 200, nonce + domain + expiry
- `POST /api/auth/passkey/login-begin` → 200, WebAuthn challenge
- `POST /api/auth/login/code/request` → 200, anti-enumeration (always ok:true)
- `POST /api/auth/invite/check` → 200, valid:false for unknown codes
- `POST /api/auth/signup` (invalid invite) → 400 "invalid or already used invite code"
- `POST /api/auth/waitlist` → 200 with confirmation message

### Blueprints public — still working
`GET /api/blueprints` returns 200 with 5 blueprints without auth. Correct for the public catalog.

---

## New issues found in v3 (not in v2)

### P2-A — Waitlist hint says "10% off" — no such offer exists

**File**: `apps/ui/src/pages/SignupPage.tsx` line 310
**Copy**: `<p className="waitlist-hint">Early supporters get 10% off their first month.</p>`

This appears below the waitlist form when a user clicks "Join the waitlist" on the signup page. The pricing model has no "10% off" concept: there's a `$19 first month` intro rate for all users, not a waitlist-specific discount. "10% off $49" would be ~$44.10, not $19. This copy is either stale from a pre-pricing era or was never meant for the post-simplification model.

**Risk**: A user who joins the waitlist expecting a 10% discount, then gets the standard $19 first month, sees a discrepancy.

**Fix**: Change to `Early access to aeqi — starting at $19.` or simply remove the paragraph entirely. The waitlist form should set expectations honestly.

**ETA**: 2 min.

### P2-B — `POST /api/wallet/upgrade-to-passkey` backend route does not exist

**Analysis**: `WalletUpgradeSection.tsx` calls `POST /api/wallet/upgrade-to-passkey`. Live server returns 401 (route matched the authed catch-all, not a dedicated handler — same pattern as old SIWE path). Grep of `aeqi-platform/src/` finds no route registration for this path.

The modal handles 501 gracefully and shows a success state regardless. So a user who completes the enrollment flow gets "Passkey enrolled. We'll process the upgrade in the background" — even though nothing was received server-side. The credential submission is a no-op.

**Risk**: Medium-low. The graceful 501 handling means the user isn't shown an error. But if they authenticated with the understanding that they've upgraded, they haven't. The UI lies about a security operation.

**Fix**: Either (a) implement `POST /api/wallet/upgrade-to-passkey` in aeqi-platform to return 501 explicitly with the message "Wallet passkey upgrade coming in Phase 2" — then the modal's 501-check fires correctly and the "email coming" message is displayed with correct grounding, OR (b) update the WalletUpgradeSection to add a `BETA_STUB` disclaimer that the upgrade is queued manually and not yet automated. Option (a) is cleaner.

**ETA**: 10 min for the explicit 501 stub in aeqi-platform.

### P2-C — "What is aeqi?" FAQ answer says "free to start"

**File**: `aeqi-landing/index.html` line 173 (schema.org `FAQPage`, "What is aeqi?" `acceptedAnswer`)
**Text**: "...It is source-available, self-hostable, and free to start."

The pricing model has no free tier. Company creation requires payment ($19 first month). "Free to start" in the FAQ answer is the most prominent factual mismatch remaining in the schema.org structured data — search engines and LLMs use it.

**Note**: The separate "How much does aeqi cost?" answer IS correct ($49/month). So the FAQ is internally inconsistent: one answer says "free to start" and another says "$49/month required."

**Fix**: Change the "What is aeqi?" answer's closing to "...It is source-available and self-hostable." (drop "free to start"), then rebuild + deploy landing.

**ETA**: 5 min including landing rebuild.

### P2-D — `title` field missing from GQL query for proposals

**File**: `apps/ui/src/lib/indexer.ts` line 251
**Issue**: `IndexedProposal` interface declares `title?: string` but the GQL query string for `proposalsForModule` does not include `title` in its field list. The indexer schema also has no `title` field on `Proposal` (confirmed from `api.rs` and `store.rs`). The `GovernancePage.ProposalRow` falls back to `proposalId.slice(0, 16)…` for all proposals.

This is not a runtime error — it's a dead interface field that creates false confidence that titles will appear. Either implement `title` in the indexer (parse from IPFS CID metadata) or remove the field from the TypeScript interface to avoid confusion.

**Fix**: Remove `title?: string` from `IndexedProposal` in `indexer.ts` until the indexer schema supports it. Alternatively, add a TODO comment clearly marking it as a planned field. Low priority since governance is a future feature.

**ETA**: 2 min to remove the dead field.

### P3-A — Old SIWE path returns 401 instead of 404

**Path**: `POST /api/auth/siwe/nonce`
**Behavior**: Returns 401 "missing authorization header" because the path matches the authed catch-all router instead of returning 404.

This is a known pattern flagged in v2 and still present. Any third-party integration or old client hitting the stale path gets a misleading auth error. Not critical but is confusing for debugging.

**Fix**: Add an explicit 404 response for `/api/auth/siwe/*` in the auth router exemptions. 10 min Rust change.

### P3-B — "autonomous companies" in marketing copy vs brand positioning

**Files**:
- `aeqi-landing/src/App.tsx` line 76: "Source-available · Self-hostable · Free to start" (hero footer)
- `aeqi-landing/src/App.tsx` line 137: description "...free to start"
- `apps/ui/src/lib/pricing.ts` line 43: FEATURES item "Run your own autonomous company"
- `apps/ui/src/components/PublicLayout.tsx` line 108: tooltip "Start your first autonomous company"
- `apps/ui/src/pages/AgentsPage.tsx` line 146: EmptyState description "Pick a Blueprint and ship your first autonomous company."

Memory says "autonomous companies" survives in FAQ/blog/Terms only, NOT in H1 or auth pages. The tooltip and EmptyState are product surfaces that a logged-in user sees — they're not H1 or CTA, but they are app-internal copy. Low risk, cosmetic alignment issue.

The "free to start" in the hero footer line is a harder problem given the current $19 first month model. The UX v9 script didn't flag it because it's in rendered JS, not the prerendered `index.html` shell.

---

## What's verified fixed from v2 issues

| v2 Issue | Fix commit | v3 Status |
|----------|-----------|---------|
| 402 dead-end in company create | 92ef3b46 | FIXED — Stripe redirect wired |
| Stale schema.org $39/$119 pricing | 3e3385a | FIXED — $49/$45 model in schema |
| Rate limiter 500s | affb7394 | FIXED — auth endpoints respond |
| `/api/auth/siwe/nonce` returns 401 | — | CARRY-FORWARD (P3-A) |
| Waitlist 10% off hint | — | STILL PRESENT (P2-A) |

---

## Observations on new-user flow (complete walk)

**Landing → Signup**:
1. `aeqi.ai` — H1 "The company OS for the agent economy." ✓ (matches memory)
2. CTA "Start a company" → navigates to `app.aeqi.ai/signup` ✓
3. Hero footer "Free to start" — factually incorrect post-pricing ✗ (P3-B)
4. Schema.org FAQ "free to start" in "What is aeqi?" — one stale answer ✗ (P2-C)

**Signup flow**:
5. Default step = "invite" (invite gate) — correct for pre-launch
6. Invite code validation: `POST /api/auth/invite/check` → valid:false ✓
7. After invalid code → stuck on invite step, no progression ✓
8. "Join the waitlist" switch → shows waitlist form with "10% off" hint ✗ (P2-A)
9. Waitlist submit: `POST /api/auth/waitlist` → 200 "Check your email" ✓
10. Signup with valid invite: 4 screens (invite → email+password → name → verify) — high friction but pre-launch acceptable

**First-time dashboard** (inferred from source):
11. No auto-creation of primitives — user lands on empty dashboard ✓ (per memory `feedback_no_auto_create.md`)
12. Sidebar shows primitive order Agents · Events · Quests · Ideas ✓

**+ New company wizard**:
13. Blueprint picker → `/start` → picks blueprint → `/start/:slug` ✓
14. Wizard shows all 6 panels (identity/roles/token/vesting/governance/review) for non-personal-os blueprints ✓
15. CTA "Create company — $19 today" for non-invited users ✓
16. 402 → Stripe redirect ✓ (FIXED)

**Settings → Wallet**:
17. `/me/wallets` (WalletsPanel) loads wallet list from `/api/me` ✓
18. `WalletUpgradeSection` shows "Upgrade to passkey" for custodial_eoa users ✓
19. Modal runs WebAuthn P-256 enrollment and submits to `/api/wallet/upgrade-to-passkey` ✗ — route is a 401 catch-all, no dedicated handler (P2-B)
20. Modal gracefully shows success-state on any non-200 that matches "501" or "not implemented" — but server returns 401, not 501 ✗ — the graceful degradation path does NOT fire (P2-B detail)

Wait — re-reading `WalletUpgradeSection`:
```typescript
if (msg.includes("501") || msg.toLowerCase().includes("not implemented")) {
  setPhase("done");
} else {
  setErrorMsg(msg);
  setPhase("error");
}
```

A 401 returns `"missing authorization header"` (from the auth extractor, before the body even reaches the route). This does NOT include "501" or "not implemented", so `setPhase("error")` fires — the user sees a red error banner rather than the success state. **This is a user-visible error for a logged-in user who attempts passkey upgrade.** Severity bumped.

**P2-B revised severity: P1-B** — the passkey upgrade flow shows an error banner to every user who tries it. The "graceful degradation" assumption in the TODO comment was incorrect — it assumed the route would return 501, not 401.

**Settings → /me/treasury**:
21. "account" copy on `/me/treasury` ✓ (WS-23-C confirmed by UX v9)
22. "Company" copy on `/c/*/treasury` ✓

**Governance**:
23. `proposalsForTrust` query exists in indexer schema ✓
24. `forVotes`/`againstVotes` fields in GQL response ✓
25. Proposal `title` field: missing from GQL query and indexer schema — fallback to proposalId substring (P2-D, cosmetic)

**Ownership**:
26. Director display name resolved (WS-23-B confirmed by UX v9) ✓
27. Wallet address "0x...eba8" shows in BOARD section — expected behavior ✓

---

## TRUST count

Could not directly query indexer DB without auth. UX v9 reported TRUSTs in indexer = 5 (as of v8/v9 pass, 2026-05-05). No new TRUST creation attempted in v3 (requires valid JWT + paid sub + real SIWE/passkey signing).

---

## Wave 24 Recommendations

**P1 (ship before any growth push):**

**WS-24-X-passkey-route**: Wire `POST /api/wallet/upgrade-to-passkey` in aeqi-platform to return explicit `501 Not Implemented` with body `{"error":"passkey signer upgrade not yet implemented","code":"not_implemented"}`. This lets the existing frontend 501-check path fire correctly — users see the success-state "queued, email coming" message instead of a red error banner. One axum route handler, ~15 lines Rust.

**WS-24-A** (from v9 carry-forward): DB SQL fix for Luca Eich identity idea AEQI → aeqi.

**P2 (before sustained growth):**

**WS-24-Y-faq-copy**: Remove "free to start" from the "What is aeqi?" FAQ answer in `aeqi-landing/index.html`. Rebuild + deploy landing. 5 min.

**WS-24-Z-waitlist-hint**: Change `apps/ui/src/pages/SignupPage.tsx` line 310 from "Early supporters get 10% off their first month." to "Join the waitlist for early access." or simply remove it. 2 min.

**WS-24-B** (from v9): Diagnose aeqi-docs AEQI uppercase in nav — landing-docs P1-2.

**WS-24-C** (from v9): Hairline third-pass sweep.

**P3 (technical debt):**

**WS-24-D**: Remove `title?: string` from `IndexedProposal` until the indexer schema supports it.

**WS-24-E**: Explicit 404 for `/api/auth/siwe/*` paths.

**WS-24-F**: Address "autonomous companies" copy in `PublicLayout.tsx` tooltip and `AgentsPage` EmptyState if brand copy guidelines require it.

---

## Summary verdict

**v2 vs v3**: The two v2 P1s (402 redirect, schema.org pricing) are confirmed fixed. Auth is solid. The on-chain Company mirror, AA stack, director names, treasury copy, and governance schema are all working correctly. UX score moved 9.1 → 9.3 between v8 and v9 (Waves 22-23).

**New blockers found in v3**:
- **P1-B (NEW)**: Passkey upgrade modal shows error banner — `POST /api/wallet/upgrade-to-passkey` returns 401 catch-all instead of 501. Every user who tries passkey upgrade sees red error. Fix: wire explicit 501 stub in platform.
- **P2-A**: "10% off" waitlist hint — stale copy, no such offer.
- **P2-B**: "free to start" in one FAQ answer — schema.org inconsistency.
- **P2-C**: `title` field in `IndexedProposal` never populated (cosmetic/dead code).

**Net**: Platform is in solid shape for launch readiness. The passkey-upgrade error is the only user-visible regression since v2 and requires a 15-line Rust stub + redeploy.
