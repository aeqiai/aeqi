# Wallet Architecture & Onboarding

**Status:** Decided 2026-05-03. Scoped for ~6-week build.
**Owner:** founder / runtime team.
**Supersedes:** the Phase-1 custodial-EOA wallet stack documented across `aeqi-platform/src/wallets.rs` and `aeqi/crates/aeqi-wallets/`.
**Companion docs:**
- `wallet-architecture-faq.md` — deep-dive Q&A and mental models for the architecture
- `app-information-architecture.md` — URL structure, public surfaces, navigation, Economy/Discover IA
**Companion plan (pending):** Solana port for Colosseum hackathon — see § Solana port.

---

## Decision (the headline)

Every aeqi account, every company, and every agent is an **AEQI Entity** — one comprehensive smart contract template on **Base**, written end-to-end by us (NOT built on Safe or any vendor primitive). Account abstraction via **ERC-4337**. Bundler (`silius`) and paymaster (our contract + Rust signing service) **self-hosted**. Truly non-custodial — aeqi never holds a signing key.

**Atomic unifications locked 2026-05-03:**

1. **Every user signup auto-creates a personal Company Entity** (1-owner config). The user account IS a Company under the hood. The phrase "personal Entity" disappears — it's just a 1-owner Company.
2. **Pricing is per-Company.** $19 first month → $49/month. Each user pays for their own Company; additional Companies they create add to the bill; joining other Companies as a member is free.
3. **Brand positioning unchanged.** The "every user is a company" model is internal architecture, not a marketing surface. UI says "Your account" for the user's primary; "Companies" for ones they explicitly create or join.

Two onramps converge on the same Entity:
- **Identity:** Email / Google / GitHub / SIWE — for login, comms, billing, recovery
- **Signer:** Passkey (default) or EOA (for SIWE users) — for signing wallet ops

One contract template. One factory. One paymaster. One bundler. ~6-week scope to migrate from today's custodial stack.

---

## Current state (Phase 1 — what's in the repo today)

Plain custodial EOAs. Web2-style key custody with proper crypto hygiene.

| Piece | Status |
|---|---|
| Wallet type | secp256k1 EOA, EVM addressing (Keccak256) |
| Where keys live | Server, ChaCha20-Poly1305 envelope, Argon2id master KEK |
| Recovery | BIP-39 mnemonic shown once at provisioning |
| Per-agent wallets | Same custody pattern, separate table |
| Auth methods shipped | Email/password, Google OAuth, GitHub OAuth, SIWE, passkey, TOTP |
| Passkey usage | Login + 2FA only — NOT used for signing |
| Smart accounts | None |
| Bundler / paymaster | None |
| ERC-4337 | None |
| Solana | None |
| Treasury page | Empty shell |
| Agent-callable signing tool | None — signing functions exist, no tool wired |

**Trust model today:** pure custodial. aeqi alone can sign any user's wallet. No on-chain co-custody, no enclave, no threshold scheme. To be migrated to the architecture below.

---

## Industry landscape (2026)

Five viable patterns. None is universally "the standard" — different categories of app pick differently.

### Pattern 1 — Connect external wallet (legacy default)

User brings MetaMask / Rabby / Coinbase Wallet. App is a UI on top of the user's EOA.

- **Used by:** Uniswap, Aave, GMX, Aerodrome, Lido
- **Trust:** Truly non-custodial — app never touches keys
- **UX:** Browser extension, seed phrase, manual gas. Hostile to non-crypto users.
- **Trajectory:** Stable but no longer the default for new consumer apps. Crypto-native niche.

### Pattern 2 — Embedded wallets via SaaS (consumer default 2022-2024)

User signs up with email/social. Provider generates a wallet via MPC sharding (Privy, Web3Auth, Para) or TEE (Magic). Provider holds at least one share; user provides the auth that releases another. Marketed as "non-custodial" but provider always holds material necessary for signing — what we call **"non-custodial with strings"** (deconstructed below).

- **Leaders:** Privy (~60% of new starts), Dynamic (~20%), Magic (declining), Web3Auth (declining), Para (Solana-focused)
- **Used by:** Friend.tech, most social/gaming apps, most Farcaster mini-apps
- **Trajectory:** Dominant for new consumer apps because of speed-to-ship; expected to converge toward passkey-default within ~2 years

### Pattern 3 — Passkey-native smart accounts (2024 breakthrough)

User signs up with email/social. Enrolls a passkey on their device. Smart account (ERC-4337) deployed with the passkey as signer. Private key lives in the device's Secure Enclave — provider holds nothing.

- **Used by:** Coinbase Smart Wallet, Daimo, Cometh, Safe's experimental WebAuthn module
- **Trust:** Truly non-custodial. Provider literally cannot sign — the key is in user hardware.
- **Trajectory:** Fastest-growing category. Coinbase Smart Wallet's launch (June 2024) was the watershed.
- **What we adopt.**

### Pattern 4 — Hybrid (external wallet wraps a proxy account)

User connects MetaMask. App immediately deploys a smart account / proxy wallet on user's behalf. User signs once to delegate an "API key" / session signer. App operates the proxy from its backend. Polymarket's "Deploy Proxy Wallet → Enable Trading → Approve Tokens" flow is the canonical example.

- **Used by:** Polymarket, Hyperliquid (their "API wallet" / "agent wallet"), dYdX, most perps DEXes
- **Trust:** Hybrid. User retains revoke/withdraw via their EOA; app operates day-to-day.
- **Trajectory:** Standard for high-frequency / agent-style apps with crypto-native users.
- **We offer this as a second onramp** (via SIWE) for users who bring MetaMask.

### Pattern 5 — Enterprise multi-sig (Safe-based)

Gnosis Safe with N-of-M signers, optional governance modules.

- **Used by:** Safe app, Den, Coinshift — DAOs, treasuries, funds
- **Trust:** Self-custody by the org
- **Trajectory:** Stable, owns the treasury/DAO segment. Consumer-hostile.

### How patterns map to apps (2026 snapshot)

| App | Pattern | Stack |
|---|---|---|
| Coinbase consumer | 3 | In-house Coinbase Smart Wallet |
| Polymarket | 4 (proxy wallet) | Custom + Magic for some flows |
| Hyperliquid | 4 (API wallet) | Custom |
| Friend.tech / most social apps | 2 | Privy SaaS |
| Most Farcaster mini-apps | 2 | Privy / Dynamic |
| Daimo | 3 | In-house, open source |
| Cometh | 3 | Safe + WebAuthn module |
| Uniswap web | 1 | None — pure UI |
| Robinhood crypto | Custodial CEX | Internal |
| Aerodrome | 1 | None |

### What changed in 2024 — the actual breakthrough

Two things landed and reset the bar for non-custodial onboarding:

1. **WebAuthn PRF extension** widely deployed in Chrome/Safari/Firefox. Lets an app deterministically derive a signing key from a passkey, on-device, never extractable.
2. **Coinbase Smart Wallet launched (June 2024).** First major consumer product to ship the email-signup → passkey → smart account → no-SaaS pattern. Proved the UX works for normies.

Combined: **passkey + smart account is now the cleanest non-custodial onboarding path.** Privy/Magic apparatus (MPC, TEE-sharded keys) was solving for "user has email only, no device key" — passkeys removed that constraint. The legacy SaaS providers are increasingly working around a problem that no longer exists.

Other supporting changes:
- **ERC-4337 went live (March 2023)** — smart accounts can now validate ARBITRARY signature schemes, not just secp256k1
- **On-chain P-256 verification became cheap** — gas-optimized Solidity libs (FreshCryptoLib, Daimo's verifier) + RIP-7212 precompile proposal
- **Apple iCloud Keychain + Google Password Manager** matured for passkey sync — recovery is solved at the OS layer

---

## Embedded wallets, deconstructed (the "non-custodial with strings" story)

Privy/Magic/Dynamic call themselves "non-custodial." That's true at the strict cryptographic claim — they can't sign alone. It is **not** true at the practical claim that the user always controls their wallet. Understanding why matters because it's the basis for our positioning vs them.

### What Privy actually does

**Shamir Secret Sharing.** Three shares of the user's signing key, any 2 of 3 reconstructs:

```
Share A — Device share        (encrypted in user's browser localStorage)
Share B — Auth share          (held by Privy's servers, released after re-auth)
Share C — Recovery share      (export option user may or may not have saved)

Day-to-day signing = A + B
Recovery signing  = A + C  OR  B + C
```

To sign a tx: app re-authenticates user → Privy releases Share B → combined with Share A → key reconstructed in browser memory → signs → key wiped.

The "unlock" Privy pioneered (and what made them eat Magic's lunch from 2022-2023) was using the user's auth method as the recovery mechanism. No seed phrase ever shown.

### The eight strings

1. **Privy gates Share B with their auth system, which they control.** They can add KYC, block sanctioned countries, suspend accounts, demand MFA, geo-block. The cryptographic claim ("they don't hold the key alone") stays intact. The practical claim ("you can always sign your wallet") becomes "you can sign as long as Privy lets you authenticate."
2. **If Privy bans you, your device share alone is useless.** Insufficient to reconstruct without Share B (or Share C, which most users never saved).
3. **If Privy is hacked, attackers get everyone's Share B.** Combined with phishing for Share A, attacker signs as the user. Mitigation is "TEE prevents this" — a trust assumption about AWS Nitro + Privy's policy code.
4. **Government coercion vector.** Privy could be ordered to modify auth-share release policy, or to deploy backdoored client code that exfiltrates Share A from a target user's browser. Magic's docs explicitly mention compliance with court orders where technically possible.
5. **Provider shutdown stranding.** Many users haven't saved Share C. If Privy disappears unannounced, those users lose access.
6. **Provider can change the trust model unilaterally.** Privy has updated their architecture multiple times; each change is a TOS update.
7. **Cross-app portability is illusory.** Wallet is bound to Privy's namespacing. Same wallet across Privy apps in the same cluster, but not portable to other providers.
8. **Auth-share release is policy code, not crypto.** The release of Share B is gated by software in Privy's TEE. Code can have bugs, be updated, be coerced, be replaced. The cryptographic claim is "we did Shamir correctly." The functional claim is "the policy that decides when to release the share is correct, secure, and won't change adversely."

### Why it's still vastly better than custodial

Coinbase-style custodial wallets have all of these problems plus more. Privy genuinely raises the bar — an attacker needs to compromise the user's device AND Privy's server to sign as them. That's harder than "compromise Coinbase." For most apps, most of the time, this is enough.

The "non-custodial" claim isn't a lie. It's an asterisked truth.

### Why we don't use Privy

- **No SaaS in our foundation.** Hard policy.
- **Vendor lock-in is real.** Privy's API is their ABI; switching is rebuilding.
- **Aligned cost incentives flip wrong way.** Privy charges per MAU; we'd subsidize their margin per user forever.
- **Strictly worse trust posture** than passkey-native, which is now the available alternative.
- **No on-chain enforceable session keys** — they have a session-key product but it's policy-gated server-side, not on-chain enforced. Our agent-economy use case needs on-chain.

---

## Account Abstraction — the umbrella term

The whole architectural category we're building in is called **Account Abstraction (AA)**. Vocabulary stack:

| Term | Meaning |
|---|---|
| **Account Abstraction (AA)** | The broad concept: an account on Ethereum should be a smart contract with arbitrary logic, not just a keypair. Includes everything: smart accounts, passkey signing, session keys, gas sponsorship, social recovery, modular signers. |
| **ERC-4337** | The specific implementation standard for AA. Doesn't require protocol changes — adds a separate UserOp mempool, EntryPoint contract, bundlers, paymasters. Live since March 2023. **What we use.** |
| **EIP-7702** | Newer hybrid (Ethereum Pectra upgrade, 2024-2025). Lets EOAs temporarily delegate to a smart contract. Additive to 4337, not a replacement. |
| **ERC-7579** | Modular smart accounts standard. Builds on 4337. Defines pluggable signer/validator/executor modules. |
| **Native AA** | Long-rumored proposal to make every Ethereum account natively a smart contract. Requires EVM changes. Still not shipped. |

Our one-line technical description:

> **A passkey-secured ERC-4337 smart account on Base, with custom modules for cap table, roles, governance, and session keys.**

---

## Why we pick Pattern 3 (with Pattern 4 as a second onramp)

Decision criteria, in priority order:

1. **No third-party SaaS in the foundation.** Hard policy — auth, keys, wallets, identity all built in-house. Rules out Privy / Magic / Dynamic / Coinbase Smart Wallet's contracts.
2. **Truly non-custodial.** Users hold equity in companies (real economic value, possibly large); the trust posture matters more than for a game wallet.
3. **Compatible with the agent economy.** Need on-chain enforceable session keys for agents to act within bounds. Pattern 3 gives this natively; Pattern 2 doesn't.
4. **Speed to ship.** ~6 weeks for the full stack. Slower than Privy integration (1 week) but eliminates ongoing vendor cost and lock-in.
5. **UX competitive with embedded SaaS.** Validated by Coinbase Smart Wallet — sub-30-second signup, Face ID per tx, iCloud-Keychain-handles-recovery.

Pattern 4 (hybrid) is offered as a second onramp via SIWE. Crypto-native users connect MetaMask; we deploy them an Entity with their EOA as the signer. Same Entity contract, different signer config.

---

## The AEQI Entity contract

One smart contract template that powers every account on aeqi. Comprehensive — owned end-to-end, **not built on Safe or any other vendor primitive**.

### Configurations

| Role | Owners | Cap table | Governance | Where it comes from |
|---|---|---|---|---|
| **Personal Company** (a.k.a. "Your account" in UI) | 1 (the user) | Degenerate (100% theirs) | Trivial (owner decides) | Auto-created at signup |
| **Joint Company** | N | Active, proportional | Active, voting | Created via "+ New Company" |
| **Agent** | Owned by parent Entity | n/a | n/a | Created when user spins up an agent; session-key delegated to aeqi runtime |

**Same contract template for all three.** Different module configurations per use case. Same factory, same audit, same ABI.

### What the contract contains

- **Signers** — passkey verifier (P-256), EOA verifier (secp256k1), multi-sig
- **Cap table** — share issuance, transfers, vesting (active for joint Companies, dormant for personal)
- **Roles** — CEO / employee / contributor / agent with scoped permissions
- **Session-key module** — agent delegation with on-chain policy enforcement (max spend, contract allowlist, frequency caps, expiry)
- **Governance** — proposals, voting (active for joint Companies)
- **Recovery rules** — signer rotation via timelock-gated `recoveryFacilitator` role

Users see "Your account" / "Your Company" / "Your Agent." They never see the words "Entity" or "smart contract." The contract is plumbing.

### Why we don't build on Safe (decided)

Safe is the dominant multi-sig contract; we considered using it as the underlying signing engine with AEQI modules layered on top. Decision: build the Entity contract end-to-end ourselves.

1. **AEQI semantics aren't a Safe.** Cap table with proportional ownership, roles with scoped permissions, governance with proposals — these aren't multi-sig features. Building them as Safe modules adds a translation layer that fights the abstraction.
2. **Brand and ABI ownership.** Etherscan and tooling should recognize the contract as "AEQI Entity," not "Safe with weird modules."
3. **Upgrade independence.** Safe's roadmap and module API moves on its own schedule. We don't want to be downstream of it.
4. **Audit posture.** Custom contract is more work to audit but the audit covers exactly our model. A Safe-modules approach gets partial Safe audit coverage for the signing layer but we still need full audits for our modules. Cost is similar; clarity is better with our own contract.

Cost: more Solidity to write and audit. Win: full ownership of the primitive.

### Why we don't use Coinbase Smart Wallet's contracts

- **Vendor lock-in.** Coinbase Smart Wallet is a specific contract Coinbase deployed. Building on it depends on their factory, address registries, upgrade decisions, support windows.
- **No room for AEQI semantics.** Their contract is a wallet. We need a wallet + cap table + roles + governance + session keys. Their contract doesn't have hooks for our semantics.
- **We can borrow the pattern, not the code.** The architectural pattern (passkey + smart account + Base + paymaster) is open. Their specific contract isn't.

---

## The unification: every user account IS a personal Company

**Decided 2026-05-03.** Every signup auto-creates exactly one Entity — a personal Company configured as 1-owner. The user's account, in our backend and on-chain, IS a Company. There's no "personal Entity" as a separate concept.

### Why

- The Role primitive (per `architecture_role_primitive.md`) already says "Entities own agents." Entities are the unit. Users are Entities.
- The founder vision is "autonomous companies" — every individual is themselves an autonomous economic actor with agents. Conceptually a one-person company.
- Removes the awkward "personal vs Company" duality from the architecture and the contract template.
- Pricing aligns: the user's existence on the platform IS owning a Company; that Company is what they pay for.

### What this changes from prior memory

The "no auto-creation of primitives" rule (per `feedback_no_auto_create.md`) gets one explicit carve-out: **the user's personal Company Entity IS auto-created at signup** (because the account itself is the Entity). All other primitives — agents, ideas, quests, additional Companies — still require explicit user action. The empty-dashboard-until-action principle holds for everything except the user's own existence.

### What stays internal (not a marketing surface)

The "every user is a company" model is **internal architecture, not external positioning.** The brand stays:

- **H1:** "The company OS for the agent economy." (unchanged)
- **CTA:** "Start a company" (unchanged)
- **Subhead:** unchanged

We do NOT ship "You're a company" / "Become a company" copy. It reads as overclaiming for normal users. Most users will think of their primary account as "their account," not as "a company they own." That's fine — the unification works under the hood without forcing it on the user's mental model.

### UI vocabulary AND rendering

Architecture and UX live on different layers — and the personal Entity renders **differently** from joint Company Entities, even though they're the same primitive underneath. Without the differentiation, users get confused (the user explicitly raised this — "im rendering the personal company just like any other entity so its confusing").

| Context | URL | UI label | Backend reality |
|---|---|---|---|
| User's primary Entity | `/me/*` | **"Your account"** or their name | Entity configured as 1-owner Company |
| Joint Companies they created or joined | `/c/{slug}/*` | **Company name**, listed under "Companies" section | Same primitive, multi-owner config |
| CTA to spin up another | sidebar `+ New Company` | **"+ New Company"** | Creates another Entity |

### Personal rail vs Company rail

Same Entity contract; **different tab set per render context** (degenerate tabs are hidden):

| Tab | Personal rail (/me/*) | Company rail (/c/{slug}/*) | Agent rail |
|---|---|---|---|
| Inbox | ✓ (default landing) | — | — |
| Overview | — | ✓ (default landing) | ✓ |
| Agents | ✓ | (under Roles) | — |
| Sessions | — | — | ✓ |
| Events | ✓ | — | ✓ |
| Quests | ✓ | — | ✓ |
| Ideas | ✓ | — | ✓ |
| Channels | — | — | ✓ |
| Roles | — (hidden — you're the only role) | ✓ | — |
| Ownership / Cap table | — (hidden — you're 100%) | ✓ | — |
| Governance | — (hidden — you decide alone) | ✓ | — |
| Treasury | ✓ | ✓ | ✓ |
| Tools | — | — | ✓ |
| Integrations | — | — | ✓ |
| Settings | ✓ | ✓ | ✓ |

The locked rails (per `project_company_rail_v1.md`, `project_agent_rail_v1.md`, `project_personal_rail_v1.md`) cover all three contexts.

### Sidebar layout

```
[avatar] User name              ← /me (personal Entity)
  Inbox · Agents · Events · Quests · Ideas · Treasury · Settings

COMPANIES
  ⬡ ACME Corp                   ← /c/acme
  ⬡ Side Project                ← /c/side-project
  + New Company

Settings · Sign out
```

The personal Entity is the **shell of the app** — owns the inbox, the agents, the user's primitives. Companies are switchable destinations the user navigates INTO when operating inside one.

Same shape as Notion ("Workspace" + "Pages" — same data model, different affordances) or Linear ("Personal" + "Workspaces").

---

## The two columns of onboarding

**Identity** and **signer** are separate concerns. Privy/Magic conflate them (the auth method also unlocks the key share). We keep them clean.

| Layer | What it does | Options |
|---|---|---|
| **Identity** | Proves you're you | Email OTP, Google OAuth, GitHub OAuth, SIWE |
| **Signer** | Signs your Entity's transactions | Passkey (Face ID / Touch ID / Windows Hello) OR EOA (MetaMask) |

User picks one from each column. Standard combinations:

| Signup | Identity | Signer |
|---|---|---|
| **Continue with Google** | Google | Passkey |
| **Continue with email** | Email + OTP | Passkey |
| **Continue with GitHub** | GitHub (email via `user:email` scope) | Passkey |
| **Connect wallet** | SIWE | EOA |

All four converge on the same Entity contract. Identity is for login, comms, billing, and recovery. The passkey (or EOA) is what signs.

### Why we keep email/Google AND require passkey (not passkey-only)

Coinbase Smart Wallet does passkey-only signup (no identity layer required). For aeqi we keep both because the identity layer does **product work**, not crypto work:

- **Stripe billing** — needs an email
- **Agent notifications** — "your agent just deployed your DAO" goes to email
- **Company comms** — board updates, cap table changes, governance proposals
- **Support** — user identification when things break
- **Identity uniqueness** — anti-Sybil, referral programs, fraud detection
- **Cross-device login** when iCloud Keychain doesn't sync (mixed-platform users)
- **Recovery** — identity is the recovery channel for the email-with-timelock flow

The passkey is doing crypto work alone; the identity is doing product work alone. Two columns, two purposes, no redundancy. From the user's perspective it still feels like one signup step (one identity click + one Face ID tap).

### How a passkey is the "owner" of the Entity — the conceptual unlock

Common confusion: "if a passkey is the owner of the smart wallet, doesn't there need to be an intermediate wallet between them?" **No. The passkey signs the smart contract directly. There is no intermediate.**

The 2015-era assumption "owner of a contract is an EOA address (which has a private key somewhere)" doesn't hold for smart accounts. **A smart contract's "owner" can be ANY signature-verification policy** — including direct passkey verification. The contract decides what counts as a valid signature.

```solidity
// In the AEQI Entity contract:
struct PasskeySigner {
    bytes32 publicKeyX;
    bytes32 publicKeyY;
}

function isValidSignature(bytes32 hash, bytes memory sig) public view returns (bool) {
    // For each registered signer:
    //   passkey signers → run P-256 verification math on-chain
    //   EOA signers     → run secp256k1 ecrecover
    // Accept if any signer's policy validates the signature.
}
```

When the user touches Face ID, their device produces a WebAuthn assertion (P-256 signature over the UserOp hash). We submit it as part of the UserOp. The contract verifies the math against the registered public key. Valid → tx executes.

**Mental model:**

```
WRONG:  Passkey → Embedded wallet → Smart wallet     (3 layers, recursion)

RIGHT:  Passkey ────signs──→ AEQI Entity              (2 layers, direct)
        
        Or for SIWE users:
        EOA ────signs──→ AEQI Entity                  (also 2 layers)
```

The passkey IS the signer. The Entity IS the wallet. There's nothing between them.

**Apple Pay analogy:** Face unlocks Secure Enclave → enclave signs payment authorization → merchant verifies signature against your card's public credentials. No "intermediate wallet" between your face and the merchant. Passkey + smart account is the same shape, applied to a smart contract instead of a payment network.

The contract holds **public keys**, not private keys. Public keys are just data. The corresponding private key (the passkey) lives in the user's Secure Enclave forever.

### Recursive case (Companies of Companies)

For a joint Company with multiple cofounders, each "owner" of the Company Entity is itself another Entity (each cofounder's personal Company):

```
ACME COMPANY  (an AEQI Entity smart contract)
│
├── Cofounder 1 owns 51%
│   └── Their signer = their personal Entity (smart contract)
│       └── Their signer = their passkey
│           └── Their face
│
├── Cofounder 2 owns 30%
│   └── Their signer = their personal Entity (smart contract)
│       └── Their signer = their passkey
│           └── Their face
│
└── Investor owns 19%
    └── Their signer = MetaMask EOA
        └── Their MetaMask private key
```

Every chain bottoms out at a **passkey or an EOA**. Never at an "embedded wallet."

---

## Self-hosted infrastructure

| Component | What it is | Build vs adopt |
|---|---|---|
| **Bundler** | Off-chain service that takes UserOps, simulates, packs into bundles, submits to EntryPoint | **Adopt `silius` (Rust).** Self-host as sibling service to aeqi-platform. |
| **Paymaster contract** | Solidity contract; pays gas for sponsored UserOps; funded with ETH deposit at EntryPoint | **Write our own.** ~80 lines. One per chain. |
| **Paymaster backend** | Rust service that signs paymaster approvals based on policy | **Write our own.** Sits beside aeqi-platform. |
| **AEQI Entity contract** | Comprehensive — signers, cap table, roles, session keys, governance | **Write our own** end-to-end. Audit before mainnet. |
| **Entity factory** | CREATE2 deployer for deterministic addresses | **Write our own.** |
| **Session-key module** | On-chain policy enforcement for agent delegation | **Write our own.** AEQI-specific IP. |

**Adopted as protocol infrastructure** (not vendor lock-in):
- **EntryPoint contract** — canonical, EF-deployed singleton on every chain
- **WebAuthn signer logic** — we write our own implementation but reference public Cometh / Coinbase / Daimo / Safe approaches
- **P-256 verifier libraries** — FreshCryptoLib and Daimo's verifier are public; we use them as references or vendor in

**Pragmatic dependencies** (vendor-swappable, not foundational):
- **RPC** — Alchemy or QuickNode. Read-mostly, swap in one config line. Self-hosting an L1/L2 node is real ops work and not "smart server" territory.

### On-server topology

```
aeqi-platform.service       (auth, users, identity — already running)
aeqi-bundler.service        (silius, listens on 4337 mempool port — new)
aeqi-paymaster.service      (Rust, signs paymaster approvals — new)
aeqi-host-<entity>.service  (per-tenant runtime — already running)
```

Plus three contracts deployed once per chain (Sepolia for staging, Base mainnet for prod):
- AEQI Entity implementation (the template)
- AEQI Entity factory
- AEQI paymaster

---

## Trust model

### What the user owns at the end of signup

| Thing | Where it lives | Who controls it |
|---|---|---|
| **The passkey** (signer's private key) | User's device Secure Enclave (Apple T2, Android StrongBox, TPM) | Only the user's biometric can unlock it |
| **The Entity contract** (their personal Company) | On-chain on Base, immutable | The Entity's own logic — which says "do what the passkey signs" |
| **The Entity's contents** (assets, company shares, roles, agents) | Inside the Entity contract | Same — only the passkey can move them |

aeqi holds none of these. We can't see the passkey. We can't move funds in the Entity. We can't change its signers. We can't freeze it.

### What the user trusts us for

| Layer | Trust required | Why |
|---|---|---|
| **Signing** | None | Only their passkey signs. We literally cannot. |
| **Contract code** | Yes, once | They trust the Entity contract is honest. Mitigated by: open source, audit, immutable on-chain. |
| **Paymaster funding** | Operationally yes | If we vanish, they can't get gas sponsored. But they can pay gas themselves. Graceful degradation, not lock-in. |
| **Bundler availability** | Operationally yes | If our bundler dies, they can submit UserOps to any other 4337 bundler. Standard mempool, swappable. |
| **Indexing / our UI** | Operationally yes | If aeqi.ai is down, they can use Etherscan or any wallet UI that supports the Entity ABI. |
| **Agent operations** | Yes, but bounded | They sign a session key to aeqi with explicit on-chain limits (this contract, max $X/day, expires in N days). We can't exceed bounds. They revoke any time. |

For the wallet itself: **zero trust in us.** For the convenience layer (sponsored gas, agents acting on their behalf, our UI): trust scaled to the convenience.

### Can the user take the wallet?

Yes, completely. Three escape paths:

1. **Use it without us.** Open any 4337-compatible wallet UI, point it at their Entity address, sign with their passkey.
2. **Add a different signer.** From Face ID, call `addSigner(metamaskAddress)`. Now their MetaMask can also sign for the Entity. They could remove the passkey entirely.
3. **Migrate assets out.** Transfer everything to a brand new address.

If aeqi shuts down tomorrow, every user's Entity keeps running on-chain. They lose our UI, our agent layer, our paymaster. They keep their assets, their company contracts, their cap tables, their signing authority. **The chain is the source of truth, not our database.**

### The chain of authority, top to bottom

```
User's face / finger
        ↓ unlocks
User's device Secure Enclave (Apple T2, Android StrongBox, TPM)
        ↓ holds
Passkey private key
        ↓ signs operations on
AEQI Entity contract on Base
        ↓ controls
Their assets, company shares, roles, agents
```

aeqi exists nowhere in that chain. We exist alongside it: bundler, paymaster, UI, agent orchestrator. **Convenience layer. Removable.**

---

## Recovery without custody

Recovery doesn't require holding keys. It requires authority to **rotate signers**, and that authority is enforced by the smart contract — not by us.

### The mechanism

Entity contracts have a `recoveryFacilitator` role with strictly bounded authority: it can ONLY propose adding a new signer, with a 7-day timelock, vetoable by any existing signer. It cannot sign txs, cannot move funds, cannot read balances. It can ring a doorbell that the user can ignore for 7 days.

```solidity
function proposeAddSigner(address newSigner) external {
    require(msg.sender == recoveryFacilitator, "not authorized");
    pendingSigner = newSigner;
    pendingSignerActivatesAt = block.timestamp + 7 days;
    emit RecoveryProposed(newSigner);
}

function activateAddedSigner() external {
    require(block.timestamp >= pendingSignerActivatesAt, "timelock");
    require(pendingSigner != address(0), "nothing pending");
    signers.add(pendingSigner);
    pendingSigner = address(0);
}

function cancelRecovery() external onlySigner {
    pendingSigner = address(0);          // ANY existing signer can veto
    pendingSignerActivatesAt = 0;
}
```

aeqi takes the `recoveryFacilitator` role. The role's authority is "ring a doorbell the user can ignore for 7 days." Custody and recovery are different authorities; we have the second without ever having the first.

### Three layers, in user-perceived frequency

| Layer | Mechanism | Coverage |
|---|---|---|
| **1. Automatic device sync** | iCloud Keychain / Google Password Manager sync the passkey across the user's devices automatically | ~95% of recovery scenarios — invisible to the user |
| **2. Email/identity recovery with timelock** | Re-prove identity (email OTP / Google re-auth) → enroll new passkey on new device → 7-day timelock with daily warnings, cancelable from any existing device | The "lost all devices" edge case |
| **3. Social recovery** (v2 / opt-in) | User designates 2-of-3 trustees who can rotate signers without aeqi involvement | Power-user opt-in for maximum trustlessness |

### Why this is meaningfully more trustless than Privy/Magic

| Scenario | Privy/Magic | aeqi |
|---|---|---|
| **Provider hacked** | Attacker gets users' shares; combined with phished device shares, signs immediately, silently | Attacker has nothing useful. Worst case: triggers recovery for inactive users with 7-day warning window. |
| **Provider coerced** | Could be ordered to modify auth-share release policy or push backdoored client code | No coercion vector — we have nothing to hand over. Recovery requires user's email proof + 7-day timelock. |
| **Provider shuts down** | Need recovery share exported (most users haven't) | Wallet keeps working forever. Email recovery goes away but multi-passkey + trustees still work. |
| **Provider bans user** | Auth share refused → wallet locked unless recovery share exists | aeqi cannot lock anyone out. Worst we can do is decline to facilitate one of three recovery paths. |

### Recovery presets at signup

| Preset | Recovery options | Trust required |
|---|---|---|
| **Standard** (default) | iCloud/Google sync + aeqi email recovery (7-day timelock) | Some trust in email + aeqi as facilitator |
| **High security** | iCloud/Google sync + 2-of-3 trustees | Trust in your trustees only |
| **Paranoid** | Multi-passkey only (must enroll on 2+ devices at signup) | Trust in your own backup discipline |

---

## Onboarding flows

### Email + passkey

```
1. User enters email
2. 6-digit OTP, verifies
3. Browser prompts "Create passkey for aeqi.ai?"
4. User taps Face ID / Touch ID / Windows Hello
5. Device's Secure Enclave generates P-256 keypair
6. Public key sent to us; we compute Entity address (counterfactual — not deployed yet)
7. Done. Account ready.

First action (e.g., agent setup, treasury action):
8. We submit UserOp deploying their personal Company Entity, signed by passkey, paid by paymaster
9. Entity contract deployed at the precomputed address
10. From now on, every action requires Face ID
```

### Google + passkey

Identical to email flow, replace step 1-2 with Google OAuth handshake. We get verified email automatically via standard `email` scope.

### GitHub + passkey

Identical to email flow, replace step 1-2 with GitHub OAuth handshake + `user:email` scope call to `GET /user/emails` for the primary verified email. Edge case: ~5% of GitHub users have only the noreply email — we then prompt "add a real email for notifications" as one extra step.

### MetaMask connect (SIWE)

```
1. User clicks "Connect wallet"
2. SIWE handshake (EIP-4361) — they sign a nonce with MetaMask
3. We have proof they own the EOA
4. We compute Entity address with the EOA as sole signer (counterfactual)
5. Prompt: "Add an email for notifications and recovery" (since SIWE gives no email)
6. Done.

First action: deploy Entity with EOA as signer.
```

The user's MetaMask becomes the signer on their Entity. AEQI runtime can be granted a session key for agent ops (or not, if they want manual approval per tx).

---

## Pricing model — per-Company, $19 → $49/mo

**Atomic billing unit: the Company.** Every Company costs $19 first month, $49/month after.

Since every user signs up by getting their own personal Company, **every user pays for at least one Company** ($49/mo). Joining other Companies as a member is free. Creating additional Companies adds to the bill.

### The math by team size

| Setup | Cost / mo |
|---|---|
| Solo founder (just their personal Company) | $49 |
| Solo founder running 4 ventures (1 personal + 4 ventures) | $245 |
| 2 cofounders, 1 joint Company | 2 × $49 + $49 = $147 |
| 5 cofounders, 1 joint Company | 5 × $49 + $49 = $294 |
| 5 cofounders, 1 joint + 1 sub-company | 5 × $49 + $49 + $49 = $343 |
| 50-person team, 1 Company | 50 × $49 + $49 ≈ $2,500 |

Each member's personal Company is paid by them. The joint Company is paid by whoever created it (transferable ownership flow for handoff). Members ride free on Companies they join.

### Why per-Company beats per-user

- **Aligns with what we charge for.** Real on-chain Companies, not just account records.
- **Solo users not penalized for collaborating.** Inviting 4 cofounders adds $0 to my bill (they each pay for themselves; one of us pays for the joint Company).
- **Cofounder math is transparent.** "$49 per Company. Whoever creates pays."
- **Easy to explain in three words.** "$49 per Company."
- **Recurring revenue model** — aligned with ongoing infra cost (paymaster, bundler, RPC, agent runtime).

### Tiers (initial proposal)

| Tier | Price | Per Company includes |
|---|---|---|
| **Standard** | $19 first month → $49/mo per Company | Unlimited agents (with monthly LLM token cap, e.g. $30-50 worth of compute). All session-key features. Standard support. |
| **Pro** (later, optional) | $149/mo per Company | Higher LLM caps, premium models (Opus, GPT-5), priority bundler/paymaster, advanced governance modules, audit logs, support SLA |
| **Enterprise** | Negotiated | Custom usage, dedicated infra, white-label options, SOC2 evidence, SLAs |
| **Annual** | $490/yr per Company ($98 off) | Standard tier paid annually |

### No free tier

Reasoning:
- Free signups burn real on-chain deployment cost (~$0.10 + paymaster gas) we can't recover
- Free tier attracts non-converting users, inflates infra costs without paying
- Linear / Cursor / Devin / ChatGPT Plus all gate at first dollar — converts who actually want it
- $19 first month IS the trial — low enough commitment to try, high enough to filter
- Better hooks for top-of-funnel: public Entity explorer (read-only, free), demos, content

If we ever need looser top-of-funnel later: 7-day free trial, no credit card up front, auto-conversion to paid. Standard SaaS. Not Day 1.

### What's open (decide later)

- **Exact LLM token cap** at each tier (depends on model costs; need unit economics modeling)
- **Pro tier feature list** (decide once Standard validates)
- **Enterprise pricing** (don't overthink; quote per deal)
- **Annual discount %** (15-20% is industry standard; $490/yr ≈ 17% off, fine)

---

## Brand positioning — unchanged

The "every user is a company" model is **internal architecture, not a marketing surface.** We do NOT rebuild positioning around it.

### What stays

- **H1:** "The company OS for the agent economy."
- **CTA:** "Start a company"
- **Subhead / supporting copy:** unchanged per the existing pivot-scope rule (`feedback_pivot_minimal_scope.md`)

### What we explicitly don't ship

- ❌ "You're a company" subhead
- ❌ "Become a company" CTA
- ❌ Hero variants leaning on personal-corp framing
- ❌ Manifesto rewrite around the unification

### Why

- "You're a company" reads as overclaiming for normal users
- The unification deepens the existing positioning rather than contradicting it — "company OS" now covers literally everyone
- The pivot-scope rule says: when the architecture shifts, change H1/CTA/SEO only — not the supporting system. We're not even changing those.
- Most users naturally think of their account as "their account," not as "a company they own." Forcing the framing in copy would confuse, not enlighten.

The line that's accurate, defensible, and distinguishing (for the FAQ / about page, not the H1):

> "Sign up with email or Google. Run a company on-chain. Your equity, your treasury, your decisions — all recorded immutably on Base. We provide the rails; the chain enforces the rules. No seed phrases, no extensions, no third-party custody. Privy and Magic hold shares of your key. We don't hold any part of it. Your face is the key. Your phone is the vault. We just provide the agents and the rails."

---

## Public Entity explorer (post-MVP, ~3 wks)

If every aeqi user/company/agent is an on-chain Entity, every Entity deserves a public viewable surface. Without this, the "companies on-chain" thesis is invisible to anyone outside the app — same failure mode as DAOs on Aragon that nobody inspects.

### Surfaces

```
aeqi.ai/c/{slug}              ← public Company page (default public)
aeqi.ai/u/{slug}              ← personal profile (default private, opt-in public)
aeqi.ai/entity/0x{address}    ← canonical address-based view
```

### What an Entity page shows

| Section | Content |
|---|---|
| **Header** | Name, type (Company/Self/Agent), Etherscan link, deployment date, current chain |
| **Owners / Cap table** | Company: signers with proportional ownership. Personal: single owner. |
| **Treasury** | On-chain balances (ETH, USDC, NFTs, sub-Entities owned) |
| **Agents** | Linked Agent Entities + session-key policies (with explorer drill-in) |
| **Activity** | Recent on-chain ops — transfers, governance votes, agent actions |
| **Governance** | Open proposals, recent decisions, voting log |
| **Roles** | CEO / employees / contributors with their permissions |
| **Verify** | Etherscan link, on-chain audit trail link |

### Defaults

- **Companies:** public by default (you WANT investors / customers / collaborators to see)
- **Personal accounts:** private by default, opt-in public profile
- **Agents:** public if owning Entity is public, otherwise private

### Why this matters

The Entity explorer is the **public face of the AEQI thesis**. It's how:
- Investors verify a Company's cap table before investing
- Customers verify a Company is real before paying
- Cofounders verify their ownership stake matches what was promised
- Counterparties verify what authority an agent has before transacting

Without the explorer, on-chain primitives are technically present but socially invisible. A Notion-style "share this page" link to a Company Entity is the proof that closes the "is this real?" question for outsiders.

### Build phase

Post-MVP, after the 6-week wallet stack. Approximately 3 weeks: routing, on-chain indexer for the Entity contract, public-page React components, slug→address resolution.

---

## What we explicitly DON'T build

- **No TEE / TKMS / AWS Nitro Enclaves.** Magic's apparatus is solving the EOA-custody problem we don't have.
- **No MPC / threshold signing.** Smart accounts make threshold sigs unnecessary at this layer.
- **No "sealed recovery" / soft custody fallback.** Multi-passkey + trustees + email-with-timelock is enough. Anything stronger reintroduces a soft custody dependency.
- **No third-party SaaS** for wallets, custody, or signing. Privy / Magic / Dynamic / Coinbase Smart Wallet's contracts all off the table.
- **No Safe.** AEQI Entity is full-blown comprehensive, written by us. Safe is not a building block.
- **No mainnet Ethereum** initially. Base only. If a user needs mainnet later, that's a v2 problem.
- **No ERC-4337 paymaster reliance on Pimlico/Alchemy/Stackup as services.** Self-host silius bundler + our own paymaster contract + our own paymaster signing service. RPC IS rented (Alchemy/QuickNode) — different layer, vendor-swappable.
- **No "You're a company" marketing.** Internal architecture; not externally surfaced.
- **No free tier.** $19 first month is the trial.

### Solana — see § Solana port below

Previously listed as "no Solana expansion." Status updated 2026-05-03: **Solana port is on the table for the Colosseum hackathon opportunity.** Decision pending hackathon date confirmation. EVM-Base remains the canonical, default stack regardless of whether Solana ships.

---

## Build plan — EVM Base (~6 weeks)

| Week | Deliverable | Acceptance criteria |
|---|---|---|
| **1** | Pick chain (Base — locked). Reference Safe singleton addresses for tooling parity (we don't use them, just don't conflict). Deploy our paymaster on Base Sepolia. Fund EntryPoint deposit. | Test UserOp through canonical EntryPoint flows on Sepolia |
| **2** | Stand up `silius` as `aeqi-bundler.service`. End-to-end UserOp from a test script through our bundler to Sepolia. | Test UserOp signed by a test EOA submits through our bundler, lands on Sepolia |
| **3** | Solidity: AEQI Entity v1 (signers, basic execTransaction, recovery facilitator with timelock). Entity factory with CREATE2. Sepolia deploy. | Deploy an Entity counterfactually, fund it, execute a transfer, propose+activate a new signer, cancel a proposal |
| **4** | Paymaster backend service (`aeqi-paymaster.service`) in Rust. Sponsorship policy = "if user has paid Stripe / has trial credit, sponsor up to $X gas." **Book audit** with Spearbit / Trail of Bits / OpenZeppelin (~$30-60k). | UserOp through bundler → paymaster signs approval → tx lands without user paying gas |
| **5** | Backend integration in aeqi-platform: counterfactual address on signup, deploy-on-first-action, passkey signer wiring (WebAuthn PRF), EOA signer wiring (reuse SIWE), session-key issuance. **Stripe billing wired** for per-Company subscription. | Email signup → passkey enroll → personal Company Entity deploys on first action → Stripe charge fires for the Company subscription |
| **6** | Solidity: cap table module, roles module, governance module, session-key module with on-chain policy. Frontend: passkey enrollment UI, signer management UI, Treasury page wired to RPC, Companies sidebar showing personal + joint. Multi-passkey enrollment for recovery. Mainnet Base deploy of contracts. | A user signs up → has personal Company → creates a joint Company (cap table populated, roles assigned) → delegates session key to aeqi runtime → agent transacts within policy. Treasury shows real on-chain balances. Stripe subscription ladder works. |

**Total: ~6 weeks** + audit elapsed (2-3 weeks parallel from Wk 4).

---

## Solana port — Colosseum hackathon assessment

**Status: pending Colosseum date confirmation.** If hackathon timeline is 6+ weeks out, green-light a parallel Solana track. If sooner, defer to v2.

### Why Solana matters strategically

- Colosseum hackathon = focused deadline, big audience, grant money, investor intros, Solana ecosystem distribution
- Solana-native agent crowd (ElizaOS, Phantom users, Para/Crossmint integrations) is a real audience we'd otherwise miss
- The conceptual architecture ports cleanly (Solana has native account abstraction); the code does not (different language, different VM, different account model)

### Solana DAO / wallet landscape

| Solana | Role | EVM equivalent |
|---|---|---|
| **Squads** | Multi-sig + smart account, treasury management. Squads V4 added policy controls and session-key-style features. | Safe (Gnosis Safe) |
| **Realms / SPL Governance** | Canonical DAO framework. Created by Solana Foundation. Token-weighted voting, treasury, proposals. Powers Mango, Marinade, Drift. | Aragon + OpenZeppelin Governor + Tally combined |
| **MetaDAO** | Futarchy-based governance — decisions made via prediction-market signals. Newer, growing traction. | No real EVM equivalent |
| **STAMP** | Stake-based equity standard for cap tables on Solana. | Closest: ERC-20 with vesting + custom registries |
| **Para (Capsule) / Crossmint** | Embedded wallets on Solana with passkey-style flows | Privy / Magic on EVM |

The Solana DAO ecosystem is significantly less mature than EVM's. ~5-10x less variety. But the dominant primitives exist and have meaningful TVL. The space is consolidated under Squads + Realms + Para — easier to position into than EVM's fragmented landscape.

### Architectural mapping (concept-level)

| EVM piece | Solana equivalent | Status |
|---|---|---|
| AEQI Entity contract (Solidity) | Solana program (Rust/Anchor) + PDAs | Full rewrite |
| ERC-4337 + bundler + paymaster | Not needed — native fee payer + multi-signer | Delete the layer |
| Paymaster contract | Native fee payer | Delete |
| Session keys | Native (secondary signers + program logic) | Easier than EVM |
| Passkey signer (P-256) | On-chain P-256 verifier (custom Solana program) | Harder — Solana is ed25519-native |
| Cap table / roles / governance | Same shape, Solana program | Full rewrite, similar logic |
| EVM address (20-byte hex) | Solana address (32-byte base58) | Different identifier |
| Solidity audit | Anchor/Rust audit | Separate audit |

### Effort estimate

| Scope | Effort | Tradeoff |
|---|---|---|
| **Full canonical port** (custom Entity program, on-chain P-256 passkey verification, cross-chain identity, full audit) | 10-12 weeks + $20-30k audit | Matches EVM quality |
| **Minimum-viable port** (use Squads as base, ed25519 keypair signers via Phantom, per-chain Entities, skip STAMP/MetaDAO interop initially) | 4-6 weeks | Vendor dep on Squads, custodial-ish Solana side, fragmented identity |
| **Hackathon-tight subset** (Entity program + signer + agent + session key + one demo) | 4 weeks | Wins hackathon, defer cap table / governance / explorer to post-Colosseum |

### Strategic position vs Solana DAO ecosystem

If we ship a Solana version, position as **complementary, not competitive**, with the existing primitives:

- **STAMP-compatible cap tables** (interop with the emerging standard)
- **MetaDAO-style futarchy** as one optional governance mode
- **Squads multi-sig** as a recognized peer (not as our base — we have our own Entity)
- **Compete only on the agent + company runtime layer** — nothing else does this on Solana

This is identical to our EVM positioning vs Safe / Coinbase Smart Wallet — we acknowledge the foundation primitives, position above them.

### What's CHEAPER about a port (vs original EVM build)

- We've already paid the design cost. Same time we recover.
- Spec is settled — cap table, roles, governance, session keys, recovery model all decided.
- Patterns are validated.
- Documentation exists (this doc).
- Maybe 30-40% of original effort was figuring out what to build. Don't pay that twice.

### What's MORE EXPENSIVE

- Different language stack (Rust on BPF, Anchor framework). Not transferable from Solidity.
- Separate audit budget ($20-30k).
- 2x ongoing maintenance — two contract codebases, two audit cycles, two upgrade paths, two ops surfaces. Forever.
- Different ops complexity (Solana RPC patterns, slot tracking, priority fees, compute budget management).

### Decision criteria

**Confirm Colosseum dates first.** Then:

| Hackathon date | Action |
|---|---|
| **6+ weeks out** | Green-light minimum-viable port (4-6 wks) parallel to EVM track. Ship hackathon submission. Defer full feature parity to post-event. |
| **3-5 weeks out** | Hackathon-tight subset only (4 wks). Ship demo-grade. Plan full port for after. |
| **<3 weeks out** | Decline. Focus on EVM. Wait for next hackathon cycle. |
| **No hackathon catalyst** | Defer Solana port to v2 (Q1 2027 earliest). EVM-only for MVP. |

---

## Glossary

| Term | Meaning |
|---|---|
| **Account Abstraction (AA)** | Umbrella concept — accounts on Ethereum should be programmable smart contracts, not just keypairs. Includes everything below. |
| **ERC-4337** | The implementation standard for AA without protocol changes. Defines UserOps, EntryPoint, bundlers, paymasters. Live since March 2023. **What we use.** |
| **EIP-7702** | Newer hybrid — lets EOAs temporarily delegate to a smart contract (Pectra upgrade, 2024-2025). Additive to 4337. |
| **ERC-7579** | Modular smart accounts standard, builds on 4337. |
| **Embedded wallet** | The Privy/Magic category — non-custodial wallet inside an app, social login, no seed phrase, recovery via auth method. We are NOT this category. |
| **Smart wallet / smart account** | Smart-contract-based account (4337 or 7702). What we ARE. |
| **Passkey-native** | Smart wallet with a WebAuthn passkey as its signer. Our chosen variant. |
| **EOA** | Externally Owned Account — traditional 2015-style Ethereum keypair (MetaMask address). |
| **AEQI Entity** | Our comprehensive smart contract template; the underlying primitive for users, companies, and agents. Internal name; not user-facing. |
| **WebAuthn / passkey** | Browser standard for hardware-backed credential auth. Private key lives in device Secure Enclave, never extractable. |
| **WebAuthn PRF extension** | Lets an app deterministically derive a key from a passkey on the user's device, never extractable. |
| **EntryPoint** | Canonical singleton contract deployed by the Ethereum Foundation on every EVM chain. Validates and executes UserOps. |
| **Bundler** | Off-chain service that bundles UserOps and submits them as real txs to the EntryPoint. We self-host (`silius`). |
| **Paymaster** | Contract + service that pays gas on behalf of users. We self-host. |
| **UserOp** | A "pseudo-transaction" in 4337 — what a smart account user signs instead of a regular tx. |
| **Session key** | A scoped, time-limited, policy-bounded signer delegated to an app (us) to act within strict limits without user signature per action. |
| **Counterfactual address** | The deterministic future address of a contract that hasn't been deployed yet. Used so we know a user's Entity address before any on-chain action. |
| **Recovery facilitator** | Constrained role on the Entity contract; can ONLY propose adding a new signer, with timelock and veto by existing signers. aeqi takes this role; cannot sign or move funds. |
| **SIWE** | Sign-In With Ethereum (EIP-4361) — standard for proving ownership of an EOA via signature. |
| **PDA** | Program Derived Address — Solana's primitive for accounts owned by programs (not keypairs). |
| **Shamir Secret Sharing** | Key splitting scheme used by Privy. NOT MPC despite often being called that loosely. |
| **MPC** | Multi-Party Computation — true threshold signing scheme used by Web3Auth. Different from Shamir. |
| **TKMS** | Magic.link's "TEE Key Management System." Patent-pending TEE-based key custody. |

---

## Appendix A — Why not Coinbase Smart Wallet's contracts

Coinbase Smart Wallet pioneered the passkey-native smart-account pattern in mid-2024. It's the reference implementation for what we're building. We adopt the **pattern**; we do not use the **contracts**.

Reasons:

1. **Vendor lock-in.** Their factory, their address registries, their upgrade roadmap, their support windows. Same calculus that ruled out Privy.
2. **No room for AEQI semantics.** Their contract is a wallet. We need wallet + cap table + roles + governance + session keys. Their contract has no hooks for our model.
3. **The pattern is open; the code isn't.** ERC-4337, WebAuthn, on-chain P-256 verification are all standards. We use the standards; we write our own contract.
4. **Brand and ABI ownership.** Etherscan should show "AEQI Entity," not "Coinbase Smart Wallet."

What we DO take from Coinbase Smart Wallet's playbook (free reference):
- The architecture pattern
- The UX pattern (signup → counterfactual → deploy on first action → Face ID per tx → iCloud sync)
- The validation that normies will use it
- Public WebAuthn signer code as a reference (not a dependency)

---

## Appendix B — Why not Safe

Safe is the dominant multi-sig contract; we considered using it as the underlying signing engine with AEQI modules layered on top. Decision: build the Entity contract end-to-end ourselves.

1. **AEQI semantics aren't a Safe.** Cap table with proportional ownership, roles with scoped permissions, governance with proposals — these aren't multi-sig features. Building them as Safe modules adds a translation layer that fights the abstraction.
2. **Brand and ABI ownership.** Etherscan and tooling should recognize the contract as "AEQI Entity," not "Safe with weird modules."
3. **Upgrade independence.** Safe's roadmap and module API moves on its own schedule.
4. **Audit posture.** Custom contract is more work to audit but covers exactly our model. Safe-modules approach gets partial Safe audit coverage but we still need full audits for our modules. Cost is similar; clarity is better with our own contract.

Cost: more Solidity to write and audit. Win: full ownership of the primitive.

---

## Appendix C — Why Base

| Criterion | Base | Mainnet | Arbitrum | Optimism |
|---|---|---|---|---|
| Gas cost per Entity deploy | ~$0 | ~$3-5 | ~$0 | ~$0 |
| Gas cost per UserOp | <$0.01 | $1-5 | <$0.01 | <$0.01 |
| Smart-account ecosystem maturity | Excellent (Coinbase Smart Wallet native) | Excellent | Good | Good |
| USDC native | Yes | Yes | Yes | Yes |
| Distribution / users | Coinbase pipeline + growing consumer base | Established but expensive for normies | Growing | Growing |
| Brand fit for "company on-chain" | Strong | Strongest | Neutral | Neutral |

Base wins on cost, smart-account ecosystem maturity (Coinbase Smart Wallet was Base-native at launch), and Coinbase distribution. The brand call ("your company is on Base") is acceptable — Base is the Coinbase L2 and has the strongest consumer perception of any L2.

If a user needs Ethereum mainnet specifically (rare for our market), defer to v2.

---

## Appendix D — What stays from today's stack

- **Email/password, OAuth (Google, GitHub), TOTP** — auth methods. Identity layer, not custody. Keep all.
- **SIWE** — repurposed as the EOA-signer onramp (Pattern 4).
- **Passkey infrastructure** — extended from login-only to signing.
- **Custodial code path in `aeqi-wallets`** — kept ONLY for AEQI's own platform wallet (paymaster funding, fee collection — boring backend stuff, not user custody). Never used for user wallets after migration.

---

## Appendix E — Mental model

**Today:** aeqi is a Web2 app that happens to hold private keys.

**Proposed:** aeqi is an on-chain runtime. Every user is a personal Company on Base. Every company they create is a Company on Base. Every agent they spin up is an Agent Entity owned by a Company on Base. aeqi runs the orchestration layer; the chain is the source of truth.

The user's AEQI Entity is their safety deposit box. They own the box. We built it for them. The key to the box is their face. We don't have a copy. We can't open it. We CAN deliver mail you ordered into the box (paymaster), or, if you sign a written authorization with limits, run small errands on the box's behalf (session keys / agents). You can revoke either at any time.

If we go out of business, the box is still yours, in the same vault, openable with your face. You just walk to a different bank's lobby (a different UI). The contents and authority haven't moved.

---

## Appendix F — Marketing positioning honesty test

The story we can tell that's accurate, defensible, and distinguishing:

> "Sign up with email, Google, or GitHub. You own a smart contract on Base from the moment you take your first action. Your face is the key — no seed phrases, no extensions, no third-party custody. Privy and Magic hold shares of your key. Coinbase Wallet stores it for you. We don't hold any part of it. Your phone holds the key; the chain holds the rules; we provide the runtime. Run agents from your account, spin up companies, issue equity, and never trust us with anything you couldn't take back in one transaction."

What this beats:
- **Coinbase Smart Wallet:** they're a wallet. We're a runtime where companies are born, with the wallet as the floor.
- **Privy / Magic / Dynamic:** we're cryptographically more trustless. They're "trust our TEE / our share storage." We're "trust your device."
- **MetaMask:** we don't need a browser extension or seed phrase.
- **Custodial competitors (Coinbase consumer, Robinhood):** we're non-custodial; they're not.
- **Aragon / Squads / Safe:** they're DAOs / treasuries. We're DAOs + agents + every-user-as-company in one runtime.

The honesty test these other providers fail:
- Privy can't truthfully say "your face is the key" — at least one of their server shares is required to sign.
- Coinbase Wallet (custodial) can't truthfully say "we don't hold any part of it."
- Magic can't truthfully say "no third-party custody" — their TEE holds your shares.
- We can say all three without an asterisk.

---

## Appendix G — Phase ordering & open decisions

### Locked decisions (won't relitigate)

- ERC-4337 smart accounts on Base
- AEQI Entity contract written end-to-end by us (no Safe)
- Passkey + smart account architecture (Pattern 3)
- SIWE as second onramp (Pattern 4)
- Self-hosted bundler (silius) + paymaster
- User account = personal Company (auto-created at signup)
- Per-Company pricing $19 → $49/mo
- No free tier
- Brand stays unchanged (no "you're a company" copy)
- UI says "Your account" + "Companies"
- Recovery via on-chain timelock facilitator
- 6-week build target

### Pending (decide soon)

- **Solana port:** awaiting Colosseum date confirmation
- **Audit firm:** Spearbit vs Trail of Bits vs OpenZeppelin (book in Wk 4)
- **Exact LLM token caps** per pricing tier (needs unit-economics modeling)
- **Pro tier feature list** (decide once Standard validates)

### Deferred (v2+)

- Mainnet Ethereum support
- ZK-based recovery (advanced)
- Cross-chain unified identity (if Solana ships)
- Public Entity explorer (post-MVP, ~3 wks)
- Social recovery via trustees (post-MVP)
- Sealed recovery (likely never — soft-custodial)
- ERC-7579 modular extensions (interesting future, not blocker)
