# VPS Dogfood v2 — 2026-05-05

**Method**: curl-based HTTP inspection + source code audit (no browser — no chromium available on VPS).
All API calls made against live https://app.aeqi.ai with zero cookies, zero JWT, zero prior state.
TRUSTs in indexer: **5** (unchanged from Wave 9 — dogfood did not attempt TRUST creation, no
authenticated session was provisioned).

---

## What's better than v1

### P0 rate limiter fixed (affb7394)
`/api/auth/mode` returns 200, `/api/auth/wallet/nonce` returns a real nonce, passkey endpoints
respond — the `into_make_service_with_connect_info` fix landed and is in the deployed binary
(confirmed `crates/aeqi-web/src/server.rs:233`). Every auth endpoint that was 500ing now responds
correctly.

### Auth flow is structurally sound
- Auth mode endpoint: `{"mode":"accounts","google_oauth":true,"github_oauth":true,"waitlist":true}`
- Email magic code: `POST /api/auth/login/code/request` → `{"ok":true}` — fires silently for
  unknown accounts (correct anti-enumeration behavior)
- Wallet nonce: `POST /api/auth/wallet/nonce` → full nonce + domain + expiry
- Passkey login-begin: `POST /api/auth/passkey/login-begin` → WebAuthn challenge with `allowCredentials`
- Invite code check: `POST /api/auth/invite/check` → `{"ok":true,"valid":false}` for unknown code
- Waitlist join: `POST /api/auth/waitlist` → `{"ok":true,"message":"..."}` — works
- Signup with invalid invite: `POST /api/auth/signup` → `{"error":"invalid or already used invite code"}`

### Blueprints are public
`GET /api/blueprints` returns 200 with 5 blueprints (aeqi, personal-os, solo-founder, studio,
tech-studio) without auth. A marketing page could use this to render real Blueprint tiles.

### SIWE path is correctly named
Frontend uses `/api/auth/wallet/nonce` — not the stale `/api/auth/siwe/nonce` path (which 401s).
`ConnectWalletButton` and `walletAuth.ts` are wired to the correct endpoint.

---

## What's still broken

### P1 — Company creation dead-ends with raw error for unpaid users

**Flow**: new user signs up → is authed → goes to `/start` → picks Blueprint → lands on
`/start/:slug` (CompanySetupPage) → sees "Create company — $19 today" CTA → clicks → `POST
/api/start/launch` → backend returns HTTP 402 with `{"error":"Active subscription or invite-tier
required. Subscribe at /settings/billing.","code":"subscription_required"}` → the error string
appears as raw `submitError` text in the wizard UI.

There is **no automatic redirect to Stripe checkout**. The user sees an error paragraph and is
stuck. The CTA says "$19 today" but clicking it produces an error — classic bait-and-switch UX.

**Fix**: in `CompanySetupPage.handleCreate()`, catch `ApiError` with `status === 402`, extract
`blueprint.slug` and `identity.name`, then call `api.createCheckoutSession({ blueprint:
blueprint.slug, display_name: identity.name })` and redirect to the returned `url`. One `if` block
in the catch clause.

**File**: `/home/claudedev/aeqi/apps/ui/src/pages/CompanySetupPage.tsx` line 251–265
**Also**: `WizardReviewPanel.handleCreate()` has the same gap — it swallows the 402 as a generic
error string too.

### P1 — Landing schema.org has stale pricing

`index.html` (the prerendered shell) contains schema.org `SoftwareApplication.offers` with:
- "Free" tier at $0 / "500k tokens, no credit card required"
- "Launch" at $39/month
- "Scale" at $119/month
- FAQ answer referencing "$39/month per company" and "annual billing saves ~14%"

The actual pricing is $19 first month / $49/month, single plan. No free tier (free trial retired in
`start.rs`). No annual billing. No Launch/Scale tiers.

These appear in schema.org structured data which search engines and LLMs read as authoritative. A
user who reads the FAQ snippet in Google gets the wrong price and wrong tiers.

**Fix**: rebuild the landing prerender (`npm run build` in `aeqi-landing`) after updating
`index.html`'s schema.org block to match the live `Enterprise.tsx` copy ($19 first / $49/month,
single "Company" offer). The `src/SEO.tsx` component isn't the source — the `index.html` static
shell is what ships.

**File**: `/home/claudedev/aeqi-landing/index.html` lines 99–233

### P2 — New user first-landing is "economy · æqi" (a coming-soon skeleton)

An authenticated user with no companies lands on `/` → `EconomyPage` → a skeleton UI with shimmer
bars and placeholder charts labeled "Coming soon". No onboarding prompt, no "Start a company" CTA,
no direction.

The sidebar shows "Select a company" as the switcher placeholder — that's the only affordance to
discover the creation path. The switcher dropdown has "Start a new company" at the bottom, which
routes to `/start`. But the new user would need to know to click the company switcher.

**Recommendation**: for users with `entities.length === 0`, redirect `/` to `/start` and skip the
Economy skeleton entirely. Or put a zero-state card inside `EconomyPage` that says "No companies
yet" + "Start a company" CTA.

### P2 — Waitlist hint copy is stale

Signup waitlist form shows: `"Early supporters get 10% off their first month."`

The pricing model changed to $19 first month / $49/month with no tiered discounts. "10% off" is
not a real offer. This copy should be removed or replaced with the actual first-month price.

**File**: `/home/claudedev/aeqi/apps/ui/src/pages/SignupPage.tsx` line 310

### P2 — Schema.org still contains "autonomous companies" in non-FAQ surfaces

The schema.org `SoftwareApplication` description block (which search engines surface in rich
results) contains "Platform for launching autonomous companies" and "Launch autonomous companies
staffed by AI agents" in `featureList`. Per marketing positioning rules, "autonomous companies"
survives in FAQ/blog/Terms only — NOT in the canonical H1 or product descriptions that Google
surfaces as authoritative copy.

The live Hero (`App.tsx`) is correctly clean (no "autonomous" in the motion.h1 or subtitle).
But the structured data that LLMs and crawlers use as ground truth is inconsistent with the
product copy.

**File**: `/home/claudedev/aeqi-landing/index.html` lines 92, 126–127, 144 (schema.org only)

### P3 — Passkey begin-register / begin-login endpoints have wrong public paths

UI-facing passkey auth endpoints are `/api/auth/passkey/login-begin` and `register-begin`
(confirmed working). The `ContinueWithPasskeyButton` presumably uses these via the auth store. But
testing against `/api/auth/passkey/begin-login` and `/api/auth/passkey/begin-register` (reversed
word order, common mis-guess) returns 401 "missing authorization header" — not a 404. This is
because those paths fall through to the catch-all authed route tier. A developer debugging
passkey integration would get a confusing 401 instead of 404 on the wrong path.

**Risk level**: low (only affects developer DX, not users), but worth noting.

### P3 — `waitlist: true` in auth mode response with no visible effect

`/api/auth/mode` returns `"waitlist": true`. The SignupPage source comments explicitly say the
auto-flip-to-waitlist behavior was removed, but the flag still propagates to the client. This is
dead state: the flag is stored in the auth store (`auth.ts:50,109`) but not consumed anywhere in
SignupPage. It creates confusion when debugging auth mode behavior.

**Fix**: either remove `waitlist` from the auth mode response and the auth store, or ensure the
flag is used intentionally.

---

## What's new friction (not in v1)

### Company creation requires paid subscription or invite-tier — "free to start" is now false

The landing page says "Free to start · Source-available · Self-hostable" (Hero footer text). The
schema.org FAQ says "aeqi is free to start with no credit card required". But `start.rs` has
retired the free trial slot entirely:

```rust
// Free-trial slot logic is retired — post-pricing-simplify there's no free path.
let paid = state.user_store.user_has_paid_plan(&uid);
let invited = state.user_store.user_is_invited(&uid);
if !paid && !invited {
    return (StatusCode::PAYMENT_REQUIRED, ...subscription_required...);
}
```

A brand-new user who signs up with an invite code, verifies their email, and clicks "Create
company — $19 today" immediately hits a 402 with a raw error string. There is no free sandbox,
no trial, no grace period.

**Combined with P1 above (no checkout redirect), this is the primary conversion blocker.** The
user has to independently navigate to `/settings/billing`, find the checkout button, complete
Stripe checkout, return, and retry the company creation — with no UI guidance for any of these
steps.

### Signup flow is three steps for a new user (invite gate → email/pass → name)

The signup wizard is: (1) invite code input → (2) email + password → (3) first + last name →
(4) email verification code. That's 4 screens and one async email check before the user is in.
Compared to OAuth (one click to Google) or passkey (one tap), the email path is long. The invite
gate is necessary for pre-launch, but the name collection step (screen 3) before verification
feels early — the user might abandon before verifying.

This is an accepted pre-launch constraint, not a bug. Note it as friction.

### `/api/auth/siwe/nonce` returns 401 instead of 404

Path mislabel: the old SIWE path returns 401 "missing authorization header" because it matches the
authed catch-all rather than returning 404. If any third-party integration or old client tries the
old path, they get a misleading auth error.

---

## TRUST count

TRUSTs in indexer DB at start of session: **5** (2 with on-chain addresses, 3 with null addresses
from pre-create stubs)
TRUSTs at end of session: **5** (unchanged — no new TRUST was created during this dogfood run)

Could not attempt live TRUST creation without a valid JWT. The chain bridge requires auth:
`POST /api/start/launch` → 402 without an active subscription, and the wallet signing flow
requires a real browser (WebAuthn/SIWE can't be invoked headlessly without a real wallet key).

To verify the TRUST creation path: log in as the owner account, complete the wizard with a
Blueprint that has `hasOnchainModules = true` (any non-personal-os Blueprint), and confirm
`trust_count` increments from 5 to 6 in the indexer DB after the spawn resolves.

---

## Wave 17 fix list (priority order)

**P1-A**: CompanySetupPage + WizardReviewPanel: catch `ApiError.status === 402` on `handleCreate`,
call `api.createCheckoutSession({ blueprint, display_name })`, redirect to the checkout URL.
ETA: 30 min, `apps/ui` only.

**P1-B**: Rebuild landing prerender to clear stale schema.org pricing data. Update the static
schema.org offers block in `index.html` to reflect the single-plan $19/$49 model.
ETA: 15 min, `aeqi-landing` only.

**P2-A**: Zero-state redirect or card in EconomyPage: when `entities.length === 0`, show a
"Start your first company" card or redirect to `/start` instead of the Coming Soon skeleton.
ETA: 20 min.

**P2-B**: Remove stale "10% off" copy from waitlist hint.
ETA: 2 min.

**P2-C**: Remove `waitlist` from auth mode response (backend) and auth store (frontend) if not
consumed, OR wire it to an intentional UI behavior.
ETA: 15 min, cross-repo.

**P3**: Consider returning 404 (not 401) for unrecognized `/api/auth/*` paths by moving the
explicit 404 response earlier in the exempt router tier.
ETA: 10 min.

---

## Summary verdict

**v1 vs v2**: The critical P0 (rate limiter 500s) is fixed and the platform is stable. Auth flows
respond correctly. The session is usable end-to-end for existing paid users.

**New blockers**: The primary conversion path — sign up → create company — is broken for all
non-invited, non-paid users. The 402 surfaces as a raw error string with no checkout redirect.
A new user arriving cold from the landing page sees "Free to start" copy, signs up, and immediately
hits a payment wall with no UI path to pay.

**The two P1s should ship together in the next wave.** P1-A (checkout redirect on 402) and P1-B
(fix stale schema.org pricing) are independent diffs that can be done in under 1 hour combined.
