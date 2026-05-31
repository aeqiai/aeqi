# 4 canonical templates — rationale

**Status:** Decided 2026-05-04 (founder strategic input mid-push). Implemented in commit e9b0fc3 on aeqi-core.  
**Owner:** runtime team.  
**Companion docs:**
- [`runtime-platform-separation.md`](runtime-platform-separation.md) — runtime versus hosted control-plane ownership
- [`architecture.md`](architecture.md) — runtime primitives and storage model

---

## The two-layer architecture

aeqi has TWO layers that interact at company creation:

1. **On-chain templates** (in Factory.sol): exactly 4 canonical archetypes with locked module sets. Foundation, Entity, Venture, Fund. These are the contract-level primitives — what the on-chain world sees. ~200 module addresses + value-config bytes per template.
2. **Off-chain blueprints** (JSON in `presets/blueprints/`): many blueprints. Each declares a template selecting one of the 4. Blueprints layer agent role trees, ideas, events, default sessions, and prompts on top of the on-chain shape — runtime concerns the chain doesn't model.

Many blueprints can map to one template. The mapping is N-to-1.

---

## The 4 templates

### Foundation

- **Module set:** role + budget + token + vesting + foundation
- **Use case:** Philanthropic / non-equity orgs, where governance is opinionated and economics are budget-and-vesting-only (no funding rounds, no AMM positions)
- **Default for:** personal-os blueprint (lightest practical shape)
- **Contract footprint:** 5 modules, ~45k bytecode, minimal upgrade surface

### Entity

- **Module set:** role + budget + token + vesting + funding
- **Use case:** Lightweight Joint Companies — startups with cap table + employees but no Uniswap/Unifutures heavy economics
- **Default for:** solo-founder, studio (most blueprints)
- **Contract footprint:** 5 modules, ~48k bytecode

### Venture

- **Module set:** role + budget + token + vesting + funding + uniswap + unifutures
- **Use case:** Full economic stack — companies that issue equity, run AMM positions, do token-curated funding
- **Default for:** tech-studio, aeqi (the platform itself)
- **Contract footprint:** 7 modules, ~62k bytecode

### Fund

- **Module set:** role + token + vesting + budget + fund
- **Use case:** Investment funds — fund-provisioning pattern (NAV tracking, LP positions, fund flows). NOT the same as Venture; this is a fund OF capital, not a company that raises.
- **Default for:** (no current blueprint maps here yet — reserved for fund-archetype blueprints in the future)
- **Contract footprint:** 5 modules, ~48k bytecode

---

## Why 4 (not 5, not N)

Three calibration principles governed the choice:

**Complexity ladder.** Foundation/Entity/Venture form a staircase: each adds modules horizontally without breaking prior configs. A company coded for Foundation can't suddenly demand Uniswap; a company coded for Entity can't run futures derivatives. The ladder is intentional — we reject à-la-carte module selection (which would make the audit surface explode).

**Fund is orthogonal, not a subset.** Fund swaps "funding" for "fund"—a completely different lifecycle. Investment vehicles don't fundraise; they manage LP capital. One can't be expressed as a Foundation + module X. Worth its own template because the on-chain semantics are distinct. But we only ship one orthogonal template. More fund-like archetypes (DAO, Cooperative, Syndicate) would require separate decisions.

**Audit cost discipline.** On-chain Solidity audits are expensive per contract surface. Four templates × audit = bounded cost. Adding a fifth template doubles the review surface for the new archetype alone. Each new template requires its own Factory registration, its own module set coordination, its own test suite coverage. Fewer templates = faster iteration on new blueprints (they just change the JSON layer, not the contract layer).

**Fewer templates doesn't mean less differentiation.** A Studio blueprint and a Tech Studio blueprint can live on Entity without losing meaning. The difference isn't in the on-chain modules; it's in the role trees, the seed events, the prompt style, the default treasury allocations. All of that lives in the JSON and the runtime — the chain stays simple.

**Prior art precedent.** The original UniFutures / aeqi-app already used this 4-archetype taxonomy (Foundation/Entity/Venture/Fund routes in `/app/(app)/`). We're codifying that proven shape into on-chain primitives, not inventing new categories.

---

## Blueprint → template mapping (current)

| Blueprint slug | Template | Why |
|---|---|---|
| personal-os | Foundation | Personal entity is degenerate — owner-only, no equity, simplest archetype |
| solo-founder | Entity | Lightweight company, founder + maybe a token, no governance complexity |
| studio | Entity | Multi-founder with vesting, still no heavy economics |
| tech-studio | Venture | Adds governance + funding rounds + AMM positions |
| aeqi | Venture | The platform itself is a Venture-shape company |
| (future) | Fund | Reserved for investment-fund archetype blueprints |

---

## How dao_provisioner uses this

In aeqi-platform/src/dao_provisioner.rs, when provisioning a new COMPANY for a blueprint:

1. Read `blueprint.templateSlug` → one of `"foundation"`, `"entity"`, `"venture"`, `"fund"`
2. Compute `template_id_hex = keccak256(templateSlug)` — the on-chain templateId
3. Pass that templateId in the `registerCOMPANY` tx
4. Factory looks up the registered template by templateId, instantiates the module set on a new COMPANY proxy

Importantly: the template_id_hex is computed from `templateSlug` (the canonical name), NOT from the blueprint's own slug. A blueprint named "studio" with `templateSlug="entity"` maps to the Entity template, not a fictitious "studio" template. This separation is the entire point — the on-chain world never knows or cares about blueprint naming.

---

## What this enables

**Audit-friendly.** 4 templates × audit-cycle is bounded. Adding a new blueprint doesn't open the audit window. New blueprints ship as JSON changes to the aeqi repo, zero contract changes.

**Forward-compatible.** New blueprints can ship without contract changes — they just declare an existing `templateSlug`. Blueprint velocity is decoupled from contract audit cycles.

**Cross-chain portability.** When Solana port lands, the same 4 archetypes map to Solana primitives (Squads-style multisig + Realms-style governance + token-2022 vesting). Templates are the chain-agnostic abstraction layer. The JSON stays the same; the `templateSlug` stays the same; the underlying modules change chain-by-chain.

**Brand clarity.** Marketing surface shows blueprints (5+); platform/contract surface shows templates (4). Two layers, two audiences. Users see "Solo Founder" and "Tech Studio." Engineers see "entity" and "venture."

---

## Open questions deferred

- **When does a 5th template become worth the audit cost?** Defer until a real blueprint can't fit any of the 4 existing templates. If/when that happens: write the blueprint in JSON first, prove market demand, then request founder decision + audit budget.

- **Should blueprints override individual module configs at `templateSlug`-resolution time?** E.g., "use Entity but with a tweaked vesting curve." Defer to v2. For now, blueprints are pure templateSlug selectors; module configs are locked per-template by the Factory script. Custom economics require a new template + decision.

- **Cross-chain template parity?** EVM Foundation = Solana Foundation = ARB Foundation? Will surface during Solana port. Current assumption: archetypes map, but module implementations differ per chain. The 4-template structure itself is portable; the Solidity contracts aren't.

---

## Decision authority

**The 4-template structure is locked.** No further templates without explicit founder decision + audit budget allocation.

**Blueprints can be added freely.** Any `templateSlug` pointing at an existing (Foundation/Entity/Venture/Fund) template can ship as a JSON PR without contract review.

**Modifying an existing template's module set is a contract breaking change.** Don't. If Module Y needs a config change, bump its version on-chain and redeploy; don't edit a shipped template. Old Companies instantiated against the old template; new Companies can opt into the new one via a new templateSlug if the change is significant enough.
