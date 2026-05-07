# AA UserOperation Lifecycle

Status: empirically verified on anvil (chain 31337) — 2026-05-05.

## Overview

This document captures the end-to-end lifecycle of an ERC-4337 v0.7 UserOperation
as measured in the aeqi AA stack: anvil + rundler + aeqi-paymaster + Paymaster.sol.

---

## Stack

| Component | Address / URL | Notes |
|---|---|---|
| Anvil (EVM) | `http://127.0.0.1:8545` | chain ID 31337 (0x7a69) |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | seeded via `anvil_setCode` on service start |
| rundler bundler | `http://127.0.0.1:3000` | Alchemy, ERC-4337 v0.7 |
| aeqi-paymaster API | `http://127.0.0.1:3001` | Rust/axum, ERC-7677 compatible |
| Paymaster.sol | deployed per run | funded via `EP.depositTo` |
| SimpleAccount | deployed per run | minimal ERC-4337 v0.7 smart account |

---

## Phase 1 — Off-chain: sponsor request

```
Wallet/SDK
    │
    ▼  POST http://127.0.0.1:3001/paymaster/sponsor
    │  body: { sender, nonce, callData, gasLimits, ... }
    │
aeqi-paymaster
    ├─ policy check: SELECT remaining_budget_wei FROM entity_budget WHERE entity_id = sender
    │    zero budget → 402 Payment Required  (ERC-7677: error code -32500)
    │
    ├─ compute validUntil = now() + 900s, validAfter = 0
    │
    ├─ signing digest (64 bytes, Solidity-compatible):
    │    keccak256(
    │      userOpHash     [32 bytes]  ← keccak256 over UserOp fields + chainId + EP addr
    │      validUntil     [ 6 bytes]  ← uint48, big-endian (upper 2 bytes of u64 dropped)
    │      validAfter     [ 6 bytes]  ← uint48, big-endian
    │      paymaster_addr [20 bytes]  ← deployed Paymaster.sol address
    │    )
    │
    ├─ sign digest with PAYMASTER_PRIVATE_KEY (secp256k1, no eth_sign prefix)
    │
    └─ return:
         paymasterAndData: 0x<addr(20)><validUntil(6)><validAfter(6)><sig(65)> = 97 bytes total
         signature: 0x<sig(65)>
         validUntil: <unix timestamp>
```

**Important**: the `userOpHash` passed to `sign_paymaster_op` is the hash computed
*with a stub* `paymasterAndData` (address + validity window, no sig bytes). The final
`paymasterAndData` including the sig changes the `userOpHash` slightly — the account's
owner signs the final hash separately (see Phase 2).

---

## Phase 2 — Off-chain: owner signs final UserOp

Once `paymasterAndData` is known, the wallet computes the final `getUserOpHash()` and
signs it. SimpleAccount uses the eth_sign prefix:

```
signingHash = keccak256("\x19Ethereum Signed Message:\n32" ++ getUserOpHash())
signature   = sign(signingHash, ownerPrivateKey)   # 65-byte ECDSA
```

`cast wallet sign --no-hash <getUserOpHash_hex> --private-key <ownerKey>` produces
the correct signature because cast adds the eth_sign prefix internally.

---

## Phase 3 — On-chain: bundler submits

```
Wallet
    │
    ▼  eth_sendUserOperation → rundler (127.0.0.1:3000)
         params: [userOp, entryPointAddress]
    │
rundler
    ├─ simulation: EntryPoint.simulateValidation(userOp)
    │    ├─ IAccount.validateUserOp() → verifies owner sig
    │    └─ IPaymaster.validatePaymasterUserOp() → verifies paymaster sig
    │
    ├─ mempool hold (on anvil: near-instant block production)
    │
    └─ submit: EntryPoint.handleOps([userOp], beneficiary)
```

---

## Phase 4 — On-chain: EntryPoint execution

```
EntryPoint.handleOps
    │
    ├─ validateUserOp(userOp, missingFunds)
    │    SimpleAccount checks:
    │      signer = ecrecover(eth_sign_prefixed_hash)
    │      assert signer == owner
    │      if missingFunds > 0: EntryPoint.depositTo{value}()  ← self-fund if no paymaster
    │
    ├─ validatePaymasterUserOp(userOp, userOpHash, maxCost)
    │    Paymaster.sol checks:
    │      decode paymasterData: validUntil, validAfter, sig = paymasterAndData[20:]
    │      reconstructed = keccak256(userOpHash ++ validUntil ++ validAfter ++ address(this))
    │      signer = ECDSA.recover(reconstructed, sig)
    │      assert signer == authorizedSigner
    │      assert block.timestamp in [validAfter, validUntil]
    │      return (context, validationData)
    │
    ├─ IAccount.execute(target, value, callData)
    │    e.g. execute(address(0), 0, 0x) → no-op
    │
    └─ postOp(context, actualGasCost)
         Paymaster.sol deducts ETH from its EP deposit
```

---

## Measured gas costs (anvil, 2026-05-05)

Self-paying UserOp (no paymaster), execute(address(0), 0, 0x) no-op:

| Metric | Value |
|---|---|
| `actualGasUsed` | `0x2cfca` = **184,266 gas** |
| `actualGasCost` | `0xa796c58d1286` ≈ **0.000184 ETH** |
| Effective gas price | `1,000,000,007 wei` (~1 gwei on anvil) |
| Block production latency | < 2 seconds (anvil instant-mine) |
| Poll-to-receipt iterations | 1 (immediate on anvil) |

---

## Known limitation: Paymaster.sol v0.7 offset incompatibility

ERC-4337 v0.7 changes the `paymasterAndData` wire format:

```
v0.6 layout (what Paymaster.sol currently reads):
  [0:20]   paymaster address
  [20:26]  validUntil (uint48)
  [26:32]  validAfter (uint48)
  [32:97]  signature (65 bytes)

v0.7 bundler wire format (what rundler sends to validatePaymasterUserOp):
  [0:20]   paymaster address
  [20:36]  paymasterVerificationGasLimit (uint128, 16 bytes)
  [36:52]  paymasterPostOpGasLimit (uint128, 16 bytes)
  [52:58]  validUntil (uint48)   ← shifted by 32 bytes
  [58:64]  validAfter (uint48)
  [64:129] signature (65 bytes)
```

Paymaster.sol reads `paymasterAndData[20:26]` expecting `validUntil`, but v0.7
delivers gas limits there. **Fix required in Paymaster.sol**: read validUntil/validAfter
starting at offset 52 (`paymasterAndData[52:58]`, `paymasterAndData[58:64]`).

The end-to-end proof in `it_paymaster_real_userop.rs` uses the self-paying path to
work around this until Paymaster.sol is updated.

---

## Signature flow summary

```
Owner key  ──sign──►  eth_sign(getUserOpHash())  ──►  UserOp.signature  (65 bytes)
                                                         │
Paymaster key ──sign──►  keccak256(                     │
                           userOpHash(32)               │
                           validUntil(6)                │  ← no eth_sign prefix!
                           validAfter(6)                │
                           paymaster_addr(20)           │
                         )  ──►  paymasterData.sig  (65 bytes)
```

Note: the paymaster signer does NOT use the eth_sign prefix. The digest is a raw
`keccak256` over packed fields. This matches Paymaster.sol's use of
`ECDSA.recover(hash, sig)` (not `toEthSignedMessageHash`).

---

## Test reference

Integration tests requiring live services (anvil + rundler + aeqi-paymaster):

```bash
# All three live-service tests
cargo test -p aeqi-paymaster --test it_paymaster_real_userop \
    -- --nocapture --ignored --test-threads=1
```

Tests:
- `test_userop_selfpay_mines_success` — full end-to-end, asserts `success=true`
- `test_paymaster_service_returns_valid_paymaster_and_data` — 97-byte paymasterAndData shape
- `test_paymaster_sol_deploy_and_fund` — Paymaster.sol deploy + fund isolation

Source: `crates/aeqi-paymaster/tests/it_paymaster_real_userop.rs`
