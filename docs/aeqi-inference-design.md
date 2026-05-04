# aeqi-inference — design

**Status:** Decided 2026-05-04. Phase 1 build target ~3-4 weeks.
**Owner:** runtime team.
**Companion docs:**
- `aeqi/docs/aeqi-economy-plan.md` (master plan, WS-5 section)
- `aeqi/docs/aeqi-entity-aa-design.md` (AA stack; billing-from-treasury depends on it)
- `aeqi/docs/x402-rails-design.md` (sister doc for per-call settlement via EIP-3009)

---

## Headline

aeqi-inference is the OpenAI-compatible API endpoint that monetizes the on-chain agent economy. Three billing lanes (subscription, treasury, x402) denominated in dollars, not tokens. Hermes proved the play — monetize the API endpoint, not the model layer. Our wedge: treasury-native billing nobody else can offer. We ride free model commoditization (DeepSeek, Llama, Qwen) forever; we own the routing and billing surface.

---

## API surface

**OpenAI-compatible endpoints:**
- `POST /v1/chat/completions` — streaming and non-streaming
- `POST /v1/embeddings`

**OpenRouter-compatible routing:**
- `POST /api/v1/chat/completions` — same interface, same request/response shapes

Both endpoints accept a `model` parameter: caller picks the model, we route. Examples: `gpt-5`, `claude-sonnet-4.6`, `deepseek-v4`, `llama-4-large`, `qwen-32b`.

**Request shape:**
```json
{
  "model": "claude-sonnet-4.6",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true,
  "max_tokens": 2048,
  "temperature": 0.8
}
```

**Response:** Standard OpenAI SSE streaming format (`data: {json}` lines) for chat; json object for embeddings.

**Auth headers:**
- Subscription lane: `Authorization: Bearer <JWT>`
- Treasury lane: `Authorization: Bearer <api-key>` (signed by Entity, verified via on-chain ECDSA)
- External x402 lane: `Authorization: Bearer <EIP-3009 USDC signature>`

---

## Three lanes

### Subscription lane (Phase 1)

**Auth:** JWT token from logged-in user session.

**Billing:** Debits the Company's $25/mo dollar-denominated allowance. When exhausted, caller can top up via Stripe. Top-up adds credit to `inference_balance_cents` (one row per Company in platform DB).

**Implementation:**
1. Tower middleware resolves `entity_id` from JWT claim
2. Reads `inference_balance_cents` from in-memory LRU cache + sqlite fallback
3. Before forwarding to upstream provider, snapshot the balance
4. After response streams complete, calculate token count (via provider's response header) and compute dollar cost at that moment's rate
5. Debit `inference_balance_cents`, write to sqlite, invalidate cache entry
6. If balance goes negative, log but allow (prevents stream interruption mid-token). User sees overage billing next month
7. Return 402 Payment Required if balance is zero and no Stripe credit is available (gated at request start, before upstream call)

**Rate limiting:** Per-Company per-hour sustained usage. Default: 1000 req/min, 10k/min burst. Overages return 429 Retry-After.

**Pricing:** Subscription's included $25 is marked as -10% margin (loss-leader, funded by subscription revenue). Top-ups beyond included are cost+5%.

### Treasury lane (Phase 2 — after WS-4 wallet build)

**Auth:** API key issued per Entity smart contract, signed by Entity via passkey or EOA signer. Verification: recover signer from signature, check if signer is authorized on-chain in Entity's role ACL.

**Billing:** Deposit-and-meter pattern. Company pre-deposits USDC into a sub-balance (a field on the Entity smart contract or a sister contract tracking per-Company deposits). Off-chain meter (in aeqi-platform) tracks inference-cent debit against deposit balance. Settlement on-chain: at $1-threshold OR hourly cron, emit `InferenceCharge` event + execute USDC transfer via paymaster-bundler (covered by paymaster sponsorship policy; Company already pays subscription, so gas is covered).

**Why deposit-and-meter not per-call on-chain settle:** Per-call USDC transfer costs ~21k gas, ~$0.03 per call at Base rates. For a $0.001 inference call, gas dwarfs COGS. Batching up to $1 thresholds or hourly reduces settlement overhead to sub-1% margin.

**Implementation:**
1. aeqi-platform reads Entity's on-chain deposit balance via alloy provider call (cached, ~10 sec TTL)
2. Validates API key signature against Entity's on-chain signer module
3. Tracks debit in `treasury_inference_ledger` (entity_id, timestamp, cents_debited, status=[pending|settled])
4. After response completes, insert ledger row, add to `pending_settlement_batch`
5. Hourly cron: batch all pending rows where `created_at < now() - 1h OR total_cents > 100`, emit `InferenceCharge(entity, cents, calldata_for_transfer)`, hand to bundler
6. If on-chain settlement fails (low deposit balance, signer key rotated), ledger marks status=failed, alerts ops, Company gets 402

**Rate limiting:** Per-API-key per-hour. Same defaults as subscription lane; separate from subscription quota (both lanes are independent).

**Pricing:** cost+10%.

### External lane via x402 (Phase 1)

**Auth:** `Authorization: Bearer <eip-3009-signature>`. Signature is an EIP-3009 (permit2-style) authorization for caller to spend USDC, signed by caller's address.

**Billing:** Per-call USDC settlement. Caller authorizes up-to amount; we debit exact cost at response time. Settled via Coinbase Facilitator service (Phase 1) or self-hosted facilitator (Phase 2). Returns 402 with `Retry-After: settle-usdc?amount=<wei>` if caller is fresh and has not authorized yet.

**Why:** Any agent anywhere with USDC can pay-per-call without aeqi onboarding, no API key signup, no email. Table stakes for the agent economy. The recursive case: Agent in Company A earns USDC, decides to spawn Company B as a subsidiary, calls `POST /api/companies/create?x402=true`, pays $19 in USDC, B exists.

**Implementation:**
1. Decode `Authorization` header to extract USDC amount + caller address + signature
2. Verify signature against EIP-3009 spec
3. Check caller's balance via alloy; reject if insufficient
4. Forward to upstream, stream response
5. Calculate cost, submit settlement tx via facilitator (Coinbase Phase 1, self-hosted Phase 2)
6. If settlement fails, retry up to N times with exponential backoff; log but don't interrupt stream (caller sees "charged but settlement pending")

See `aeqi/docs/x402-rails-design.md` for the full middleware spec and settlement details.

**Rate limiting:** Per-caller-address per-hour. Separate cap from the other two lanes.

**Pricing:** cost+20% (premium for the zero-friction onboarding).

---

## Routing

**Model parameter resolution:**
1. Caller specifies `model` (e.g. `gpt-5`, `deepseek-v4`, `claude-sonnet-4.6`)
2. aeqi-inference looks up model in internal registry → maps to provider (openai, anthropic, deepseek-api, together, deepinfra)
3. Request is transformed if needed (e.g. Claude's `max_tokens` becomes `max_completion_tokens` for Anthropic API)
4. Forwarded to upstream provider
5. Response piped back to caller unchanged

**Closed models (GPT-5, Claude 4.x, Gemini 2.x):**
- Upstream provider APIs
- Margin: cost + 10-15% (wholesale tier pricing where available)
- No self-hosting

**Open-weights (Llama 4, DeepSeek V4, Qwen, Mixtral):**
- Phase 1: routed via DeepInfra or Together (wholesale pricing ~cost + 10%)
- Phase 3 optional: self-hosted GPU pool behind vllm/sglang, margin cost + 40-60%, only after Phase 1 traffic data justifies hardware

**Failover:** If upstream provider returns 5xx, we return 502 to caller immediately. No auto-failover-to-different-model in Phase 1 (caller decides retry strategy). Phase 2: explicit failover allowlist per model (e.g. GPT-5 failure → fall back to Claude Opus) if caller opts in.

**Caching:** Embeddings results cached per (model, text_hash); 24h TTL. Chat completions not cached (inherently stateful; caching would require session awareness).

---

## Pricing table

| Lane | Auth | Billing model | Margin | Notes |
|---|---|---|---|---|
| **Subscription (included $25/mo)** | JWT | Dollar balance | -10% (loss-leader) | Company's $49 sub funds this |
| **Subscription top-up** | JWT | Stripe credit | cost+5% | Card via Stripe |
| **Treasury** | API key (Entity signer) | Deposit-and-meter USDC | cost+10% | Phase 2; batch settlement at $1 threshold or hourly |
| **External (x402)** | EIP-3009 USDC | Per-call USDC | cost+20% | Phase 1; any agent, no signup |

**Example: $25/mo included allocation**

At retail rates today:
- ~90M tokens DeepSeek V4 (cost ~$0.08/1M)
- ~12M tokens Claude Sonnet (cost ~$2/1M)
- ~2.5M tokens Claude Opus (cost ~$10/1M)

Frame is dollar-denominated, not token-denominated. UI shows the dollar amount + token estimate per model class.

**Rate matching:** aeqi-inference prices publicly match OpenRouter's retail prices. No surprise markup vs the aggregator standard. Our margin comes from:
- Volume discount with providers (once we scale)
- Subscription cross-subsidy (heavy inference users pay $49 + overage; light users subsidize the heavy via the $25 included loss-leader)
- x402 premium (convenience tax for zero-onboarding)

---

## Rate limiting

**Subscription + Treasury lanes:**
- Default: 1000 req/min sustained, 10000 req/min burst per Company
- Anti-grief: UserOp gas estimates must be reasonable (reject obviously inflated limits; prevents DoS spam on external lane)
- Soft limit returns 429 Retry-After; hard quota after 5-min window returns 402 insufficient balance

**External x402 lane:**
- Per-payer-address cap separate from authenticated lanes
- Default: 100 req/min sustained, 1000 req/min burst to prevent single-address spam
- Abuse (>50% failure rate or >90% of calls to one model in 1h) flags for manual review; future rate-limit tiers based on on-chain reputation score

---

## Implementation breakdown

New crate: `aeqi/crates/aeqi-inference/`

**Module structure:**

```
aeqi-inference/
├── src/
│   ├── lib.rs           # crate entry, public API
│   ├── router.rs        # model → provider routing table
│   ├── billing/
│   │   ├── mod.rs       # shared traits (BillingLane, SettlementResult)
│   │   ├── subscription.rs  # JWT + balance debit
│   │   ├── treasury.rs      # API-key + deposit-and-meter
│   │   └── x402.rs          # EIP-3009 + per-call settlement
│   ├── upstream/
│   │   ├── mod.rs       # UpstreamAdapter trait
│   │   ├── openai.rs    # OpenAI API adapter
│   │   ├── anthropic.rs # Anthropic API adapter
│   │   ├── google.rs    # Gemini API adapter
│   │   ├── deepinfra.rs # DeepInfra routing
│   │   ├── together.rs  # Together routing
│   │   └── deepseek.rs  # DeepSeek API routing
│   ├── api.rs           # OpenAI-compat / OpenRouter-compat axum routes
│   ├── models.rs        # request/response schemas
│   └── rate_limit.rs    # Tower middleware for rate limiting
├── Cargo.toml
└── tests/
    ├── billing_integration_tests.rs
    └── routing_tests.rs
```

**Integration with aeqi-platform:**

`src/main.rs` routes:
```rust
app.nest("/v1", aeqi_inference::router::create_router())   // OpenAI-compat
  .nest("/api/v1", aeqi_inference::router::create_router()) // OpenRouter-compat
```

Tower middleware stack:
1. Auth layer (JWT | API key | x402 signature) → extract caller identity
2. Rate limit layer → enforce per-caller quota
3. Billing pre-check → verify balance/deposit is nonzero (return 402 early if not)
4. Inference router → forward to upstream

**Stripe webhook integration:**

Platform's existing Stripe webhook handler extends to handle `invoice.payment_succeeded`:
```rust
if let Some(metadata) = invoice.metadata {
  if metadata.get("type") == Some("inference_topup") {
    let entity_id = metadata.get("entity_id")?;
    let cents = invoice.total;
    db.update_inference_balance(entity_id, |old| old + cents)?;
  }
}
```

**Frontend pricing display:**

`aeqi/apps/ui/src/lib/pricing.ts` exports:
```typescript
const COMPANY_SUBSCRIPTION_MONTHLY_USD = 49;
const COMPANY_INFERENCE_CREDIT_USD = 25;
const INFERENCE_RATES = {
  "deepseek-v4": { cost_per_1m_tokens: 0.08 },
  "claude-sonnet-4.6": { cost_per_1m_tokens: 2.0 },
  // ...
};
```

UI shows: "Your $25/mo includes ~90M tokens DeepSeek, ~12M Sonnet, or ~2.5M Opus."

---

## Phase boundaries

**Phase 1 (~3-4 weeks):**
- Subscription lane (JWT, balance debit, Stripe top-ups)
- External x402 lane (EIP-3009, per-call USDC via Coinbase Facilitator)
- OpenAI-compat router
- Routes only to upstream providers (no self-hosting)
- Ships standalone; does NOT depend on WS-4 wallet build
- Proof-of-life: agents running on aeqi can pay-per-call via x402; aeqi users can call the API within their $25 monthly budget

**Phase 2 (~2 weeks after WS-4 lands):**
- Treasury lane (API key auth, deposit-and-meter, on-chain USDC settlement)
- Requires Entity contract with IAccount + session keys (WS-4)
- Unlocks the dream loop: agent earns USDC → deposits to treasury → inference debits treasury
- Requires `aeqi-paymaster` service and silius bundler running

**Phase 3 (optional, +6-8 weeks if volume justifies):**
- Self-hosted GPU pool for open-weights (vllm/sglang behind inference backend)
- Deploy only if Phase 1+2 traffic data shows >1M inference calls/day and >30% of calls are Llama/DeepSeek
- Economics: GPU hardware cost breaks even once per-token margin (cost+40-60%) covers amortized CAPEX

---

## Sequencing

Where this fits in the economy plan:

- **Phase 1 starts now** (parallel with WS-1 / WS-2 / WS-4)
- **Phase 1 ships ~4 weeks** (concurrent with WS-4a contracts + WS-4c paymaster prep)
- **Phase 2 unblocked** when WS-4 audit clears (week 3 of WS-4 calendar → 1 week later Phase 2 ships)
- **Phase 3 is conditional** on traffic demand; queue for Q3 planning

Phase 1 is the wedge: "pay USDC per-call, no account needed" demo. Proves the API endpoint model works without depending on the full wallet build.

---

## What we don't build

- **Models.** Hermes paid that tuition. We never train, fine-tune, or own model weights. Ride free model commoditization (DeepSeek's open release, Llama's open release, Qwen's open release) forever.
- **Custom inference framework.** We're the aggregator and billing layer. Use upstream APIs (Phase 1) and wholesale providers like DeepInfra/Together (Phase 1) and vllm/sglang behind company infrastructure (Phase 3).
- **Vendor lock to any single provider.** Explicit model parameter means caller chooses; we route. No "default model" trick that locks to one provider.
- **Enterprise inference features** (RAG, fine-tuning, context windows >100k). Ship to agents that just need to call an LLM. Premium features (custom fine-tunes, retrieval) defer to Phase 3 if market demands.

---

## Open implementation questions

1. **Embedding model variants.** Should we expose multiple embedding models (OpenAI text-embedding-3, Anthropic, open-source), or standardize on one upstream + rerank? **Default: support multi-model, let caller choose via `model` parameter.** Reranking-on-top-of-embeddings is a v2 feature (too noisy for Phase 1).

2. **Token counting accuracy.** For billing we need to count tokens accurately pre-response (to predict cost) and post-response (to charge). Some providers return token counts in headers; others don't. **Default: always use provider's count from response headers; pre-prediction assumes worst-case (Claude's ~4 chars/token rule).** If pre-prediction is off by >10%, we eat it (margin absorbs).

3. **Multi-turn conversation state.** `/v1/chat/completions` is stateless (caller passes full message history each call). Should we offer a stateful conversation endpoint (like the agent's own session)? **Default: stateless only in Phase 1.** Stateful conversation endpoint is a v2 feature that requires session storage per caller, complexity we don't need yet.

4. **Fallback chain for failover.** If a provider is down, should we auto-failover to a different model from the same provider family (e.g. GPT-5 failure → GPT-4)? **Default: no auto-failover Phase 1.** Return 502 to caller; let them retry or specify a backup model. Phase 2: optional explicit allowlist per Company (opt-in failover rules).

5. **Streaming latency SLO.** Should we publish guarantees (e.g. "first token within 2s")? **Default: no SLO Phase 1.** Log latencies, measure, publish Phase 2. Upstream provider latency dwarfs our routing overhead anyway.

---

## Decision authority

This memo is **decided** at the architectural level — the three lanes, Phase boundaries, model routing, and pricing structure. Implementation details inside each lane (exact token-counting formula, specific rate-limit window sizes, settlement batch thresholds) are owner-discretion within the lane's module. Cross-lane changes (new billing lane, removing a provider class, repricing margins) re-open this memo.
