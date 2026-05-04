# aeqi-indexer

This worktree contains a self-hosted Rust indexer for aeqi-core contracts.
Replaces the TheGraph subgraph at `~/projects/aeqi-graph` with a binary that
runs alongside aeqi-platform: SQLite + alloy + axum + async-graphql.

## Where to start

→ **`docs/HANDOFF.md`** — full pickup doc: boot recipe, end-to-end demo
against real aeqi-core, schema (30 migrations), GraphQL surface (25 queries),
per-tab apps/ui integration mapping, open work, repo layout, "how to add a
new event type" recipe.

## What's in here

```
crates/aeqi-indexer/    — the indexer binary (lib + bin)
test-contracts/         — 9 mock contracts emitting byte-identical signatures
                          to real aeqi-core for fast smoke tests
docs/
  HANDOFF.md            — read this first
  CHANGELOG.md          — per-phase summary (Keep a Changelog lite)
  DEPLOY.md             — production-hardening thinking aid (systemd, WSS,
                          prometheus, multi-chain — none implemented)
  indexer-build-log.md  — full per-tick autonomous build log (~39 ticks)
  indexer-loop-prompt.md — /loop heartbeat metaprompt
  aeqi-indexer-spec.md  — original architectural spec
  aeqi-graph-survey.md  — subgraph entity inventory (135 events catalogued)
```

Sister worktree (separate repo, different git tree):
`~/projects/aeqi-core-deploy-fix` — fixed Deploy.s.sol + CreateTrust.s.sol
+ CreateMultiSigTrust.s.sol on branch `deploy-fix-2026-05-04`. Used to
exercise the indexer against real aeqi-core contracts.

## Quick build + sanity

```bash
cd /home/claudedev/aeqi-indexer-build
cargo build --release -p aeqi-indexer --bin aeqi-indexer
cargo test --release -p aeqi-indexer
cargo clippy --release -p aeqi-indexer -- -D warnings
```

Expected: 33/33 tests pass, zero warnings.

## Status

Feature-complete for the v2 demo as of 2026-05-04. 10 contract types
indexed (TRUST + Role + Governance + Token + Vesting + Funding + Budget
+ Fund + Factory admin + accounts), 4 levels of dynamic dispatch, full
multi-sig flow indexed across arbitrary block ranges. Live-tested against
real aeqi-core. Branch: `indexer-build`.

The next move is interactive apps/ui glue (defer to interactive session)
or production hardening (WSS log subscription, multi-chain, eth_call
backfill — see `docs/HANDOFF.md` "Production-readiness checklist").
