# aeqi-indexer

Solana log indexer for the AEQI protocol. Replaces the EVM event indexer that previously watched the Base contracts.

## What it does

- WebSocket-subscribes to logs of all 11 AEQI programs via `logsSubscribe`
- Decodes Anchor events from `Program data:` lines (base64 of `8-byte discriminator || borsh payload`)
- Projects events into a SQLite DB matching the existing `aeqi-indexer` schema (so the runtime / UI doesn't notice the chain swap)

## Skeleton (this iteration)

- ✅ Connect to RPC + WS
- ✅ Subscribe to all 11 program log streams in parallel
- ✅ Decode Anchor `Program data:` lines
- ✅ Persist decoded events to SQLite with idempotent replay protection
- ✅ `getSignaturesForAddress` backfill
- 🔴 Two-tier projection (finalized for company mutations, confirmed for UI optimism)
- ✅ Idempotent crash recovery keyed by `(signature, program, event_type)`
- ✅ Discriminator → typed event registry (per-program decoders)

## Run

```bash
cargo build --release
AEQI_INDEXER_WS=ws://127.0.0.1:9900 ./target/release/aeqi-indexer
```

For Solana mainnet:

```bash
AEQI_INDEXER_WS=wss://api.mainnet-beta.solana.com \
AEQI_INDEXER_COMMITMENT=finalized \
./target/release/aeqi-indexer
```

Production: **public RPC** (Helius / Triton / Solana Foundation public). Per `feedback_use_public_solana_rpc.md` — self-hosting an agave-validator RPC node is out-of-scope (~$500-1500/mo + weekly upgrade churn). If a paid tier of the SAME provider isn't enough, that's the trigger to re-litigate.

## Programs watched

| Program | ID |
|---|---|
| aeqi_company | `CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV` |
| aeqi_factory | `3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv` |
| aeqi_role | `4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB` |
| aeqi_governance | `5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq` |
| aeqi_token | `AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh` |
| aeqi_treasury | `2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7` |
| aeqi_vesting | `DCZKRmxjUyAZ3nptbkCBnAGqTe4E7xTvXfLbnf95uj7y` |
| aeqi_budget | `5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G` |
| aeqi_fund | `DaFpZcqMaL4rmAemJ2WBeUth42PMmHxNg9t6j9h9p7YP` |
| aeqi_funding | `8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U` |
| aeqi_unifutures | `CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF` |
