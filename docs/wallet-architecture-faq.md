# Wallet Architecture — Deep Dive & FAQ

**Companion docs:**
- `wallet-architecture.md` — the canonical spec (decisions, contracts, build plan)
- `app-information-architecture.md` — URL structure, public surfaces, Economy/Discover IA
**Purpose:** capture the conceptual insights, debates, mental models, and UX clarifications that make the canonical decisions make sense. The main doc has the "what." This doc has the "why we got there" and "how to think about it."
**Last updated:** 2026-05-03

---

## How to use this doc

- **Need a decision lookup?** Go to `wallet-architecture.md`.
- **Confused about WHY a decision is what it is?** Look here.
- **Onboarding a new contributor or thinking partner?** Have them read both, in order: canonical spec first, then this FAQ for the mental model.

---

## 1. The signing chain — top to bottom (clearing the "what's at the root" muddle)

There are TWO legitimate uses of "root" that get conflated:

| Sense of "root" | What it refers to | Answer |
|---|---|---|
| Root of **identity** | The user's stable on-chain address | Their personal Company Entity address |
| Root of **control** | The topmost cryptographic authority that signs anything | Their passkey (in device Secure Enclave) |

**The chain, top to bottom:**

```
USER'S BIOMETRIC (face/finger)        ← unlocks
        ↓
USER'S PASSKEY (Secure Enclave)       ← root of CONTROL
        ↓ signs for
USER'S PERSONAL COMPANY ENTITY        ← root of IDENTITY (stable address)
        ↓ which is registered as
ROLE IN A JOINT COMPANY               ← downstream
        ↓ executes
ON-CHAIN ACTION
```

The passkey is the bottom of the recursion — the only thing in the chain that isn't itself a contract. The Entity is the user's stable identity, but the passkey is what controls the Entity.

**Common mistake:** thinking the Entity is "above" the passkey. It's not. The Entity is downstream of the passkey. The passkey signs FOR the Entity. The Entity holds funds and roles ON BEHALF OF the user (whose authority comes from the passkey).

---

## 2. How a passkey "holds a role" — the unification insight

The conceptual unlock that ties the architecture together: **a passkey holds the Founder role of the user's personal Company.** Same primitive as how an Entity address holds a CEO role in a joint Company.

### Personal Company

```
ALICE'S PERSONAL COMPANY (Entity contract on Base)
│
├── Roles
│   └── "Founder" = Alice's passkey       ← held DIRECTLY by passkey
│
├── Treasury
├── Agents
└── Settings
```

The Founder role holder is literally Alice's passkey public key. Contract logic: "to act as Founder, sign with the registered passkey; I'll verify P-256 directly."

### Joint Company

```
ACME CORP (Entity contract on Base)
│
├── Roles
│   ├── "CEO" = 0xAlice... (her personal Company address)
│   ├── "CTO" = 0xBob...
│   └── "Investor" = 0xCharlieMetaMask
```

Same primitive — a role holder. Just that the holder type differs by configuration.

### Why this matters

It collapses the architecture to ONE mechanism:
- **One Company contract template** (no special "Entity" vs "Company" types)
- **One roles module** (same on-chain logic everywhere)
- **One signing primitive** (passkeys, EOAs, Entities all hold roles via the same registry)

A Company is just a Company. The user's account is a 1-role Company where the role is held by their passkey. Joint Companies have multiple roles held by various Entities/EOAs/passkeys. Recursive — turtles all the way down — each terminating at a passkey at the bottom.

---

## 3. The polymorphic role-holder framework

A role in any Company can be held by ANY signer type:

```solidity
enum HolderKind {
    Passkey,    // P-256 public key, verified directly on-chain
    EOA,        // 20-byte address, verified via ecrecover
    Entity,     // smart contract address, verified via EIP-1271
    MultiSig    // n-of-m of any of the above
}
```

When a role-holder needs to authorize an action, the contract dispatches to the right verifier:
- Passkey → on-chain P-256 verification
- EOA → ecrecover
- Entity → call `entity.isValidSignature(...)` via EIP-1271
- MultiSig → recursive verify N-of-M

### Why polymorphic, even though Entity is the user default

- **Crypto-native users** want to join Companies with their raw EOA (no aeqi Entity wrapper)
- **Sub-DAOs** can hold roles in parent Companies (Entity → Entity)
- **Power users** may want a raw passkey holding a role (no wrapper, simpler)
- **Future systems** that produce signatures we want to recognize (ZK proofs, MPC outputs, etc.)

The cost of polymorphism is small (a `HolderKind` discriminator + dispatch table). The win is huge optionality. Everything plugs into the same registry.

---

## 4. How a passkey translates into a wallet address (CREATE2 derivation)

The passkey doesn't directly correspond to an address (it's a P-256 keypair, not secp256k1). But it deterministically produces an Entity address via CREATE2:

```
1. User enrolls passkey            → device generates P-256 keypair
2. Public key sent to us           → we get (X, Y) coordinates
3. CREATE2 address computed:       → keccak256(factory + salt + bytecode)
                                     where salt = keccak256(passkey pubkey)
4. That address IS the user's      → deterministic, stable, computable by anyone
   Entity / wallet                   with the public key
5. Contract not deployed yet       → counterfactual; the address still works
6. Anyone can send funds there     → they sit at the address until first action
7. First action triggers deploy    → Entity contract materializes at that address
```

### Comparison to legacy

| Legacy EOA | Passkey + Smart Account |
|---|---|
| secp256k1 keypair → address (Keccak256) | P-256 keypair → CREATE2 address |
| Address holds funds in raw chain state | Address holds funds via lazily-deployed contract |
| User manages key (seed phrase) | Hardware manages key (Secure Enclave) |

Same conceptual shape: **a key produces a deterministic address.** Just one extra hop (through the factory) for the smart-account version.

### What this enables

- **Send funds to user before they've done anything** — works, sits at counterfactual address
- **Quote the user's address in a Company role registry** — works, address is stable from day one
- **Recovery via signer rotation** — Entity address never changes; passkey rotation just changes who can sign for it

---

## 5. The two-column UX model — identity + signer

We deliberately separate IDENTITY (proves who you are) from SIGNER (proves you authorize a tx). They serve different jobs.

| Column | What it does | Options |
|---|---|---|
| **Identity** | Proves you're you. Used for login, billing, comms, recovery. | Email OTP, Google OAuth, GitHub OAuth, SIWE |
| **Signer** | Cryptographic authority. Signs transactions for your Entity. | Passkey (default), EOA (for SIWE users) |

User picks one from each column. Two-tap signup total (one identity click + one signer enrollment).

### Why we don't collapse to passkey-only (Coinbase Smart Wallet style)

Coinbase Smart Wallet skips the identity layer entirely — it's just passkey. Works for them because:
- They don't bill users
- They don't email users
- They don't have agents that notify users
- They don't have multi-tenant Company comms
- They don't have customer support cases per user

We're a SaaS product on top of a wallet. We need:
- Stripe billing → email
- Agent notifications → email
- Company governance updates → email
- Recovery channel → email
- Anti-Sybil → identity
- Support cases → identifier

Email/Google identity does PRODUCT work the passkey can't. Two columns, two purposes, no redundancy. From the user's perspective it still feels like one signup step.

---

## 6. Integrations live on Entities

When a user links Google, GitHub, Stripe, Notion, etc., it lives on the Entity they're operating in.

### Personal Entity gets personal integrations

```
ALICE'S PERSONAL COMPANY
├── Integrations
│   ├── Google: alice@gmail.com (OAuth — identity + email + calendar)
│   ├── GitHub: github.com/alice
│   ├── Stripe: Alice's payment method (for the $49/mo subscription)
│   ├── Email inbound: alice@aeqi.ai → Gmail forwarder
│   └── Optional: MetaMask EOA linked as additional signer
```

### Joint Companies get shared integrations

```
ACME CORP
├── Integrations
│   ├── Google Workspace: acme.com domain
│   ├── GitHub: github.com/acme-corp
│   ├── Stripe: company card (paid by Company creator, transferable)
│   ├── Email inbound: hello@acme.com → routed to internal agents
│   └── Other shared services
```

### Concrete consequences

- Alice's agents can read her Gmail (her personal Company has Google connected)
- ACME's agents can read ACME's shared inbox (ACME has its own Google connected)
- Disconnecting an integration is the same UX everywhere (Settings → Integrations → Remove)
- Same data model whether personal or joint scope

This unification means we don't have separate "user settings" vs "company settings" surfaces — both render against the same primitive (Settings tab on the active Entity).

---

## 7. Recovery — non-custodial despite involving us

Recovery doesn't require holding keys. It requires authority to **rotate signers**, which is a different (constrained) authority enforced on-chain by the contract — not by us.

### Three layers, in user-perceived order of frequency

| Layer | Mechanism | Coverage |
|---|---|---|
| **1. Device sync (invisible)** | iCloud Keychain / Google Password Manager sync passkeys across user's devices | ~95% of "lost device" scenarios |
| **2. Email + on-chain timelock** | Re-prove identity → enroll new passkey → 7-day timelock with daily warnings, vetoable from any existing device | "Lost everything" edge case |
| **3. Social recovery (v2)** | 2-of-3 trustees, no aeqi involvement | Power-user opt-in for max trustlessness |

### Why this is genuinely non-custodial

aeqi takes the on-chain `recoveryFacilitator` role with strictly bounded authority:

- ✓ CAN propose adding a new signer (start a 7-day clock)
- ✗ CANNOT sign transactions
- ✗ CANNOT move funds
- ✗ CANNOT bypass the timelock
- ✗ CANNOT modify the rules (Entity is immutable)
- Any existing signer can call `cancelRecovery()` to veto our proposal

Worst-case "aeqi is fully compromised":
- Attacker triggers recovery for every user simultaneously
- Every user gets 7 days of warnings (email + on-device)
- Active users veto trivially
- Inactive users are at risk after 7 days — bounded, observable, time-limited

Compare to Privy: an attacker who breached their auth-share storage signs immediately, silently, no warning. We have a **delayed adversary with veto** model. Strictly more defensive.

### The role of email/Google identity in recovery

When the user re-authenticates to start the recovery flow, they prove identity via the email/Google they linked at signup. This is one of the reasons we collect identity — not just for billing/comms, but as the recovery channel that's independent of the lost device.

---

## 8. The signing UX — when does the user actually sign?

Critical UX question: do users tap Face ID for every action? **No** — that would be hostile.

### The clean rule

| Who's acting | What they're doing | Signature needed |
|---|---|---|
| Agent (under session-key delegation) | Routine ops within bounds | None — session key signs invisibly |
| Agent | Op outside bounds | Notification → user approves with one tap |
| User | Routine action (small transfer, comment, etc.) | One tap |
| User | High-stakes (add cofounder, change cap table, etc.) | One tap with confirmation modal |
| User | Batched changes | One tap covers all of them |

### One signature per INTENT, not per micro-operation

ERC-4337 UserOps support batched calls atomically. Adding a cofounder might trigger 4 contract calls (add signer, set role, set cap table %, emit event), but the user signs ONCE for the intent:

```
User clicks "Add Bob as CTO with 30% equity"
  → Modal: "Confirm: adding Bob as CTO, granting 30% equity"
  → Tap Face ID
  → ONE signed UserOp executes 4 contract calls atomically
  → Done
```

Critical UX principle: **the user feels signing for moments where "wait, am I really agreeing to this?" is a useful question**. Everything routine is silent.

### Comparison to Polymarket

Polymarket's "Deploy Proxy → Enable Trading → Approve Tokens" flow is the canonical pattern:
- 3-4 sigs at SETUP (proxy deploy, session key delegation, token approvals)
- Zero sigs per trade
- Sig only for WITHDRAWAL (high-stakes, money leaves the platform)

We extend this pattern:
- Setup: sigs for personal Entity deploy, agent session key delegation
- Routine agent ops: zero sigs (session key)
- Authority changes (add cofounder, etc.): one sig per intent
- Withdrawals above threshold: one sig
- Periodic renewal of session keys (every ~90 days): one sig

Same shape as Polymarket, but:
- Polymarket enforces session limits server-side (you trust them not to ignore them)
- We enforce session limits **on-chain** (the Entity contract refuses ops outside policy, even if our backend tried)

Strictly stronger guarantee, same UX.

### What the user feels day-to-day

| User type | Face ID taps per week |
|---|---|
| Casual user | 1-2 |
| Power user with multiple Companies | 3-5 |
| Agent operator | 1-2 (mostly invisible — agents handle ops) |

Renewal of session keys: every ~90 days, one tap each.

---

## 9. Wallet-only signup and degraded modes

We support SIWE/MetaMask signup. Some users want pure wallet-only with no email — that's possible but the experience degrades.

### What you get with wallet-only (no email)

- ✓ EOA as signer of your Entity (wallet works)
- ✓ Counterfactual Entity address derived from EOA
- ✓ Can hold roles in Companies signed by your EOA
- ✗ Can't subscribe (no Stripe identifier) → can't create Companies → product locked at read-only
- ✗ No agent notifications (no email channel)
- ✗ No timelock recovery (without email, recovery = your seed phrase only)
- ✗ No support cases ("DM us on Twitter with your wallet" doesn't scale)

So wallet-only-no-email = read-only browsing. Useful for verifying public Entities, not for actually using the platform.

### Future option: crypto-subscription via session keys (v2+)

For hardcore crypto-natives who want pure walletless+emailless flow:

```
1. SIWE signup, no email
2. User funds Entity with USDC
3. User authorizes session key to aeqi treasury:
   "withdraw $49 USDC monthly, until I revoke"
4. Subscription paid in crypto, on-chain enforced
5. Notifications via on-chain events / Farcaster / X DM / in-app only
6. Recovery via multi-EOA enrollment (their problem, not ours)
```

Builds two billing systems and two notification systems for ~5% of users. Not MVP. Plausible v2 if demand materializes.

---

## 10. The custodial temptation — why we don't soft-custody Google signups

Recurring temptation: "for Google signups, just generate a server key, deploy their Entity with that as signer, skip the passkey enrollment for one-tap signup."

This is what Privy does. It works. It's the wrong move for us.

### Trade-off honesty

**Would gain:**
- One-tap signup (matches Privy)
- Higher conversion at top of funnel
- Edge-case device support
- Faster product-market fit

**Would lose:**
- "Truly non-custodial" marketing claim (becomes asterisked truth)
- "No-SaaS-for-foundations" rule (we'd BE the SaaS foundation)
- Agent-economy security model (custodial signers can't cleanly do on-chain bounded delegation)
- Liability posture (we'd hold keys for funds users hold equity in)
- Differentiation vs Privy (we'd be a worse Privy)
- Exit story (if we shut down, those users lose access)

### Why we hold the line

1. **Two-tap signup is fine in 2026.** Google + Face ID is normal modern UX.
2. **The non-custodial pitch IS the differentiator.** Soft-custodial puts us in Privy's bucket where we have nothing to win on.
3. **Users hold equity in companies on aeqi.** This isn't a game wallet; trust posture matters more.
4. **The architectural decision was already made.** Reversing requires reversing every memory entry, the spec, marketing positioning, audit posture. Heavy load.
5. **Agent economy lives on chain enforcement.** Soft-custodial muddles that.

### The hybrid considered (and not adopted)

"Soft-custodial onboarding → mandatory passkey upgrade on first qualifying action" — gets one-tap signup with eventual non-custodial state. Considered as a fallback if conversion data ever forces it, but not adopted by default. Window of vulnerability + accumulating liability for users who never enroll.

Decision: stay passkey-required. Revisit only with strong conversion-data signal showing the passkey step kills >40% of Google signups.

---

## 11. Common confusions and clarifications

### "Embedded wallet" ≠ what we have

| Embedded wallet (Privy/Magic) | Smart wallet (us) |
|---|---|
| Provider holds shares of the user's key | Provider holds nothing |
| Provider gates signing via auth flow | Hardware-backed signing (passkey in Secure Enclave) |
| Recovery via re-auth releases provider's share | Recovery via multi-passkey OR on-chain timelock |
| Custodial-with-strings | Truly non-custodial |

Drop the term "embedded wallet" when describing what we build. We build **passkey-native smart accounts** (or just "smart accounts" or "AEQI Entities" depending on context).

### "Smart wallet has an owner that's a wallet" — wrong

The "owner" of a smart wallet doesn't have to be another wallet (EOA). It can be:
- A passkey (verified via on-chain P-256)
- An EOA (verified via ecrecover)
- Another Entity (verified via EIP-1271)
- A multi-sig combination

There's no infinite recursion of "wallet behind wallet." Each chain bottoms out at a passkey or an EOA at the lowest layer.

### "The passkey is at the root of the user" — both true and incomplete

The passkey is at the root of CONTROL. It's the bottom of the signing chain.

But the user's IDENTITY (their stable on-chain address) is their Entity, not their passkey directly. Roles in Companies reference the Entity address, not the passkey, so identity survives passkey rotation.

Both framings are correct at different levels. Don't conflate them.

### "If the user is a Company, the UI should say 'You are a Company'"

No — the unification is **internal architecture**, not external positioning. UI says "Your account" not "Your company." Marketing keeps "The company OS for the agent economy." The architectural truth doesn't need to be preached at the user; the consistent UX (your account works the same as a Company underneath) carries the meaning without copy.

### "Why deploy a personal Entity at all if every action could just sign directly with the passkey"

Because the Entity is doing real work:
- Stable identity through device changes
- Multi-device support (iCloud sync of passkeys, all signers on one Entity)
- Recovery via timelock without changing identity
- Session keys for agent delegation
- Personal treasury (funds need a contract to hold them with smart-account features)
- Personal agents (agents need an Entity to be owned by)

A raw passkey can sign things, but it has no smart-account features. The Entity wrapper costs basically nothing on Base (sponsored deploy ~$0.10) and gives every meaningful feature. It's not optional architecture — it's the layer that makes the passkey useful for our product.

---

## 12. Mental model summary

**aeqi is an on-chain runtime for autonomous companies, with the wallet as plumbing under a SaaS UX.**

Each user is:
- A face/finger (biometric)
- A passkey (Secure Enclave on their device, signs everything)
- A personal Company Entity on Base (their stable identity, holds funds/agents/treasury)
- One or more joint Companies they participate in (via roles held by their Entity address)

Each Company is:
- A smart contract on Base (AEQI Entity)
- Has roles (Founder for personal, CEO/CTO/etc. for joint)
- Has a treasury, agents, governance, integrations
- Held authoritatively by signers (passkey for personal, Entity addresses for joint)

Each agent is:
- An Entity owned by a parent Entity
- Operates via session-key delegation from the parent's signer
- Bounded by on-chain policy (spend limits, contract allowlists, frequency caps)

The passkey is at the root of cryptographic authority. The Entity is the root of stable identity. Companies are downstream. Agents are downstream of Companies. All on Base, all enforced by the chain, with aeqi as the orchestration layer that runs alongside but never holds the keys.

That's the whole picture.

---

## Appendix — Key terminology corrections we worked through

| Wrong framing | Correct framing |
|---|---|
| "Embedded wallet" (referring to us) | Smart account / passkey-native smart wallet |
| "Personal wallet → Smart wallet" (chained) | Passkey signs Smart wallet directly (no intermediate) |
| "The Entity is at the root" | The passkey is at the root of control; the Entity is at the root of identity |
| "Sign every action" | Sign once per intent; routine ops via session key |
| "You are a company" (in marketing copy) | Internal unification only; UI says "Your account" |
| "Wallet-only signup is fully supported" | Signer-wise yes; product needs email for billing/comms |
| "Account abstraction" (vague) | The umbrella term for ERC-4337 + EIP-7702 + smart accounts + passkey signers + session keys + paymasters |
