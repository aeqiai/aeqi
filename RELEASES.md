# Release Notes

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
