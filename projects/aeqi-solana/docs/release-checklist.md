# Release Checklist

`aeqi-solana` releases are not production-ready until every item below is
complete for the exact commit being shipped.

## Candidate Freeze

- record the release branch and commit hash
- confirm no shipped program contains placeholder execution paths
- confirm all program IDs match `docs/deployments.md`
- run `npm ci`
- run `npm run verify:ci`
- run `anchor build`
- run `anchor test --skip-build`
- run `npm run verify:hashes`

## Security Review

- compare the release against `docs/solana-protocol-benchmark.md`
- review all authority checks on mutable instructions
- review PDA seed constraints against `docs/deployments.md`
- review arithmetic bounds for token, treasury, budget, funding, fund, vesting,
  and Unifutures flows
- review governance proposal lifecycle and vote snapshots
- confirm dependency audit findings are accepted, fixed, or tracked
- update `SECURITY.md` if supported scope changed

## Audit Record

- write the frozen commit hash to `audits/README.md`
- attach auditor report or pre-audit rationale
- record every accepted risk
- record every remediation commit
- record final audited commit hash

## Deployment Record

- record cluster
- record deployer
- record upgrade authority or immutability state
- record program IDs
- record local executable hashes
- record deployed executable hashes
- compare local and deployed hashes

## Rollback

- keep previous program IDs and hashes in `docs/deployments.md`
- keep the previous release commit available
- document whether rollback means upgrade, authority handoff, or client config
  rollback
