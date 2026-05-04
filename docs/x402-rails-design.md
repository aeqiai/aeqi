# x402 rails — design

**Status:** Decided 2026-05-04. Phase 1 build target ~1-2 weeks for the company-creation endpoint, alongside aeqi-inference Phase 1 for `/v1/*`.
**Owner:** runtime team.
**Companion docs:**
- `aeqi-economy-plan.md` — master plan, WS-7 section
- `aeqi-inference-design.md` — inference uses the same x402 middleware as its external lane

---

## Headline

x402 is the missing per-call payment rail for the agent economy. Coinbase's resurrection of HTTP 402 plus EIP-3009 USDC authorization lets any agent or human with USDC pay any HTTP endpoint without onboarding, account creation, or API keys. We adopt it for two surfaces: `/v1/*` inference (external lane) and `POST /api/companies/create` (programmatic company genesis). The latter is our wedge — nobody else can offer "pay $19 in USDC, get a fully-provisioned multi-agent Company in one HTTP call" because nobody else has Entity-as-account + role-as-cap-table + treasury all in one contract.

---

## Spec primer

Brief x402 mechanics:

1. Client sends request without payment header.
2. Server returns **402 Payment Required** with `X-Payment-Required` header containing JSON: `{amount, asset, recipient, chain, validUntil, nonce}`.
3. Client signs EIP-3009 `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce)` with their EOA or Entity signer.
4. Client retries with `X-Payment` header containing the base64-encoded signature payload.
5. Server forwards to facilitator (`POST https://api.x402.org/verify`) for cryptographic + balance check, then `POST .../settle` to broadcast the `transferWithAuthorization`.
6. Facilitator returns settlement receipt (tx hash). Server returns the resource with `X-Payment-Receipt` header.

**Settlement granularity:** per-call works because facilitator batches `transferWithAuthorization` txs; gas amortizes across many calls. No manual settlement overhead.

---

## Surface 1 — `/v1/*` (inference external lane)

External lane of aeqi-inference. Foreign agents (ElizaOS, MCP hosts, custom Python, anyone with USDC) hit `POST /v1/chat/completions` without auth → server returns 402 with payment requirement scaled to requested model + max_tokens → client signs + retries → inference runs → response streamed back.

**Pricing:** cost + 20% (premium for zero-onboarding convenience).

**Rate limiting:** per-payer-address, 100 req/min sustained, 1000/min burst. Grief-resistant.

**No authentication overhead.** Every agent on the internet becomes a valid inference caller; onboarding is purely cryptographic. Competitive moat: OpenRouter doesn't offer this; Hermes monetizes only via API keys to preregistered users.

---

## Surface 2 — `POST /api/companies/create` (programmatic genesis)

The wedge. Caller (agent or human) `POST`s without auth → server returns **402 with $19 USDC** payment requirement → caller signs EIP-3009 → retries with `X-Payment` header + body:

```json
{
  "blueprint": "default",
  "name": "My DAO",
  "owner_address": "0x...",
  "roles": [
    {"name": "CEO", "owner": "0x...", "vesting_months": 36}
  ]
}
```

Server settles payment, fires `Factory.registerTRUST` with prepopulated role data, provisions the runtime, returns:

```json
{
  "entity_id": "ent_...",
  "trust_address": "0x...",
  "runtime_url": "https://ent-....aeqi.io",
  "owner": "0x..."
}
```

**Marketing surface:** "Pay $19 in USDC, get a company." HTTP-native company genesis as one call.

**Recursive case (the wedge):** an agent inside Company A earns USDC, decides to spawn Company B as subsidiary, calls our endpoint with $19 USDC, B exists owned by A's address. Agent-driven corporate genesis as a primitive. Nobody else can offer it.

---

## Implementation

**Tower middleware layer** in `aeqi-platform/src/middleware/x402.rs`:
- Decodes `X-Payment` header (base64-encoded EIP-3009 authorization)
- Verifies via facilitator HTTP API
- On verify-success: settles via facilitator, attaches settlement receipt to response
- On missing/invalid: returns 402 with the payment requirement for the route

**Per-route configuration:** each route declares its price + asset + chain. Defaults read from a `x402-policy.toml` config file (or env vars for Phase 1).

**Facilitator integration:**
- **Phase 1:** Coinbase's facilitator at `api.x402.org`. Free, public, well-supported. Zero operational overhead.
- **Phase 2:** self-hosted facilitator (open spec). Small Rust service, ~500 LOC. Gives us independence if Coinbase's policy or uptime becomes a constraint.

---

## Settlement reliability

**Failure modes and handling:**

- **Facilitator down:** return 503 Service Unavailable; client retries. x402 spec handles transient failures naturally.
- **Insufficient signer balance:** facilitator returns 402 with `insufficient_balance` reason. We forward verbatim to caller; they fund and retry.
- **Replay protection:** each `nonce` is single-use, enforced on-chain in the USDC contract. No double-spend.
- **Gas spikes:** facilitator absorbs gas variability. Our pricing is denominated in USDC, not gas, so client pays flat amount regardless of base fee.
- **Signature mismatch:** facilitator rejects invalid EIP-3009 signatures. We return 402 with `invalid_signature` reason.

No idempotency key needed — payment authorization inherently prevents replay via nonce.

---

## Why this is genuinely a moat

OpenRouter aggregates models. Hermes monetizes its own model. Neither can offer "pay USDC, get a company" because neither has the underlying primitive. We're the only inference + DAO-creation rail that bills natively in on-chain USDC AND welcomes anonymous agent callers via x402 AND provisions multi-agent Companies atomically.

The recursive case (agent spawns subsidiary via x402) compounds the moat: each spawned Company pays another $19, adding to our USDC revenue. Companies beget companies beget inference demand beget treasury revenue. Loops reinforce.

---

## Sequencing

**Phase 1 (~1-2 weeks, company-creation endpoint):**
- x402 Tower middleware layer in aeqi-platform
- Facilitator HTTP client (Coinbase API)
- `POST /api/companies/create` handler — settles payment, fires `registerTRUST` + runtime spawn, returns Company metadata
- Integration with `dao_provisioner` (assumes WS-1 role encoding is complete)
- `/v1/*` x402 lane in aeqi-inference (ships with aeqi-inference Phase 1)

**Phase 2:**
- Self-hosted facilitator (independence from Coinbase). Small Rust service, open spec.
- Per-payer rate limiting hardening (track cumulative settlement volume per signer address, implement backpressure)
- Receipt → indexer pipeline (x402-spawned Companies appear in Treasury views alongside UI-created ones)
- EIP-3009 signer rotation (if user is Entity, allow changing signer key; settlement ledger stays same address)

---

## Implementation breakdown

**Rust modules:**

| Module | Lines | Responsibility |
|---|---|---|
| `aeqi-platform/src/middleware/x402.rs` | ~300 | Tower layer, 402 generation, header parsing, verify/settle lifecycle |
| `aeqi-platform/src/x402/facilitator.rs` | ~150 | HTTP client for `api.x402.org` verify + settle endpoints |
| `aeqi-platform/src/routes/x402_create.rs` | ~200 | POST /api/companies/create handler, Blueprint + RoleRequest marshalling, runtime provisioning |
| `aeqi-platform/src/x402/config.rs` | ~80 | x402-policy.toml parsing, per-route pricing lookup |

**Configuration:**

New secrets in `/etc/aeqi/secrets.env`:
- `X402_FACILITATOR_URL` — default `https://api.x402.org`
- `X402_RECEIVER_ADDRESS` — our USDC receive address for company-creation revenue
- `X402_USDC_ADDRESS` — USDC contract on active chain (e.g., Base mainnet `0x833589fcd6edb6e08f4c7c32d4f71b1566469c3d`)
- `X402_CHAIN_ID` — active chain (8453 for Base)

**Cargo dependencies:**
- `alloy` — already present; use for signature verification
- `reqwest` — already present; use for facilitator HTTP calls
- `serde` — already present; EIP-3009 struct serialization

No new transitive dependencies needed.

---

## Open questions

1. **Rate limiting scope.** Does per-payer-address 100 req/min apply to both `/v1/*` and `POST /api/companies/create`, or different budgets? Proposal: shared global budget per payer; `/api/companies/create` is expensive (provisions runtime), `/v1/*` is lightweight, rough ratio 100:1. Implementation: annotate routes with "cost weight," aggregator deducts weighted quota.

2. **Fallback if facilitator is down.** Do we queue the settlement request and wait, or immediately 503 to the caller? Proposal: immediate 503; client retries; no durable queue (Phase 2 feature if needed). Simple, honest, no false promise of settlement.

3. **Entity signer rotation.** If Company A (an Entity) wants to use x402 to spawn Company B, does the signer rotate, or does Company A's Entity signer sign both txs? Proposal: same signer; Entity is the payer for both operations. Allows agent (via Company A treasury) to fund subsidiary creation.

4. **Invalid blueprint in POST /api/companies/create.** If caller requests a blueprint that doesn't exist, do we return 400 before 402, or 402 first then validate on retry? Proposal: validate blueprint existence before returning 402; return 400 for invalid blueprint (no payment required for invalid requests). x402 is for valid requests only.

5. **Nonce collision.** Facilitator assigns nonce; what if we get a nonce that's already been used? Proposal: facilitator guarantees uniqueness per receiver address + asset combination. If collision somehow happens, facilitator reject on verify step; we return 402 with `nonce_already_used` reason, client retries with fresh nonce.

---

## Decision authority

Decided architecturally. Module-internal details (error handling, logging, metrics) are owner-discretion. x402 routes that wrap other services (runtime provisioning, indexer polling) follow that service's error contract. No new decisions required to start Phase 1 build.
