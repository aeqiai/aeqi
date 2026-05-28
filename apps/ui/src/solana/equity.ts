/**
 * On-chain reads for the Equity surface.
 *
 * Equity is the second TRUST-scope surface to land after Incorporation
 * (ja-001.2). The cap table is "real" only for Venture-shape TRUSTs —
 * those that adopted the `aeqi_token` + `aeqi_vesting` modules at
 * registration. Foundation-shape TRUSTs (the signup default) have no
 * `TokenModuleState`; `readTokenModuleState` resolves to `null` and the
 * page renders a quiet empty state instead.
 *
 * Source-of-truth references:
 *   - `TokenModuleState`: `programs/aeqi-token/src/lib.rs` (TS mirror at
 *     `apps/ui/src/solana/generated/types/aeqi_token.ts`, type
 *     `tokenModuleState`, PDA `[b"token_module", trust]`).
 *   - Token-2022 mint PDA: `[b"mint", trust]` under `AEQI_TOKEN_PROGRAM_ID`.
 *     Owned by the Token-2022 program at runtime — read via
 *     `getMint(connection, mintPda, commitment, TOKEN_2022_PROGRAM_ID)`.
 *   - Holders: SPL Token account layout is 165 bytes with `mint` at
 *     offset 0 and `owner` at offset 32. `getProgramAccounts` against
 *     `TOKEN_2022_PROGRAM_ID` with `dataSize: 165` + `memcmp(offset:0,
 *     bytes: mintPubkey)` yields every holder account for that mint.
 *   - `VestingPosition`: `programs/aeqi-vesting/src/lib.rs` (TS mirror at
 *     `apps/ui/src/solana/generated/types/aeqi_vesting.ts`, type
 *     `vestingPosition`). Anchor account layout is
 *     `[discriminator(8)][trust(32)][position_id(32)][recipient(32)][mint(32)]…`,
 *     so a memcmp at offset 8 with the trust pubkey scopes the list to
 *     one TRUST. We then filter client-side by `mint == cap_table_mint`.
 *
 * All reads go DIRECT from the browser through the shared Anchor /
 * web3.js provider; writes (mint, transfer, burn, claim) belong on
 * aeqi-platform.
 */
import { PublicKey } from "@solana/web3.js";
import type { IdlAccounts } from "@coral-xyz/anchor";

import { getConnection } from "./client";
import {
  getFundingProgram,
  getTokenProgram,
  getUnifuturesProgram,
  getVestingProgram,
} from "./programs";
import { AEQI_UNIFUTURES_PROGRAM_ID, deriveTokenModuleStatePda, deriveTokenMintPda } from "./pdas";
import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  decodeTokenAccount,
  getMint,
  type Mint,
} from "./splToken";
import type { AeqiFunding } from "./generated/types/aeqi_funding";
import type { AeqiToken } from "./generated/types/aeqi_token";
import type { AeqiUnifutures } from "./generated/types/aeqi_unifutures";
import type { AeqiVesting } from "./generated/types/aeqi_vesting";

/** Typed alias for the TokenModuleState account as returned by Anchor's fetch. */
export type TokenModuleStateAccount = IdlAccounts<AeqiToken>["tokenModuleState"];

/** Typed alias for the VestingPosition account as returned by Anchor's fetch. */
export type VestingPositionAccount = IdlAccounts<AeqiVesting>["vestingPosition"];

/** Typed alias for the FundingRequest account as returned by Anchor's fetch. */
export type FundingRequestAccount = IdlAccounts<AeqiFunding>["fundingRequest"];

/** FundingRequest account paired with its on-chain address (the PDA). */
export interface FundingRequestWithPda {
  publicKey: PublicKey;
  account: FundingRequestAccount;
}

/** A parsed Token-2022 holder row — one entry per token account that holds this mint. */
export interface TokenHolder {
  /** Address of the token account (NOT the owner). */
  tokenAccount: PublicKey;
  /** Wallet/PDA that owns the token account. */
  owner: PublicKey;
  /** Holder balance in raw base units (use mint.decimals to format). */
  amount: bigint;
}

/** VestingPosition account paired with its on-chain address (the PDA). */
export interface VestingPositionWithPda {
  publicKey: PublicKey;
  account: VestingPositionAccount;
}

/**
 * Fetch the `TokenModuleState` PDA for the given TRUST.
 *
 * Returns `null` when:
 *   - the TRUST is Foundation-shape (never registered `aeqi_token`), OR
 *   - the TRUST has not been bridged on-chain yet.
 *
 * Both shapes look identical to the caller — the Equity page renders a
 * "no equity module" empty state and lets the user keep moving.
 *
 * `trustPda` is the base58-encoded Trust PDA — same value as
 * `entity.trust_address` on the platform-side Trust record.
 */
export async function readTokenModuleState(
  trustPda: string | PublicKey,
): Promise<TokenModuleStateAccount | null> {
  const program = getTokenProgram();
  const trustKey = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const moduleStatePda = deriveTokenModuleStatePda(trustKey);
  return program.account.tokenModuleState.fetchNullable(
    moduleStatePda,
  ) as Promise<TokenModuleStateAccount | null>;
}

/**
 * Fetch the Token-2022 mint that backs the TRUST's cap table.
 *
 * Returns `null` if the mint PDA does not exist (Foundation-shape TRUSTs
 * never create one). The mint is owned by the Token-2022 program — pass
 * `TOKEN_2022_PROGRAM_ID` to `getMint` so the layout parses correctly
 * past the base mint header.
 */
export async function readMint(mintPda: string | PublicKey): Promise<Mint | null> {
  const connection = getConnection();
  const mintKey = typeof mintPda === "string" ? new PublicKey(mintPda) : mintPda;
  try {
    return await getMint(connection, mintKey, undefined, TOKEN_2022_PROGRAM_ID);
  } catch {
    // `getMint` throws TokenAccountNotFoundError on a missing account and
    // TokenInvalidAccountOwnerError on the wrong-program case. Both
    // collapse to "no mint here" for the purposes of the Equity page.
    return null;
  }
}

/**
 * List every Token-2022 holder of the given mint.
 *
 * Uses `getProgramAccounts(TOKEN_2022_PROGRAM_ID, [{ dataSize:165 },
 * { memcmp:{ offset:0, bytes: mint } }])`. Each result is a parsed
 * TokenAccount — we surface `owner` + `amount` and the token-account
 * address itself for downstream linking.
 *
 * Note: many public RPC providers rate-limit or disable unfiltered
 * `getProgramAccounts`. Localnet / Helius / Triton / self-hosted RPCs
 * support it. For v1 cap tables (<1k holders) one round-trip is fine;
 * pagination is a future indexer-HTTP concern (see matrix §5.2).
 */
export async function readHolders(mintPda: string | PublicKey): Promise<TokenHolder[]> {
  const connection = getConnection();
  const mintKey = typeof mintPda === "string" ? new PublicKey(mintPda) : mintPda;

  const accounts = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
    filters: [
      // SPL Token Account is 165 bytes flat; Token-2022 accounts that
      // belong to a mint WITHOUT extensions are also exactly 165 bytes.
      // Token-2022 accounts that DO carry per-account extensions (e.g.
      // memo-on-transfer) are larger and would be missed by this filter.
      // Equity v1 does not need to surface extended accounts; revisit if
      // the cap-table mint adopts per-account extensions.
      { dataSize: ACCOUNT_SIZE },
      { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
    ],
  });

  const holders: TokenHolder[] = [];
  for (const entry of accounts) {
    const decoded = decodeTokenAccount(entry.account.data.slice(0, ACCOUNT_SIZE));
    // `decoded.amount` is a bigint (buffer-layout's u64 helper);
    // `decoded.owner` is a PublicKey. Skip zero-balance accounts — they
    // appear when a holder closes a position but the account is still
    // open (rent-exempt placeholder). They're not meaningful cap-table
    // rows.
    if (decoded.amount === 0n) continue;
    holders.push({
      tokenAccount: entry.pubkey,
      owner: decoded.owner,
      amount: decoded.amount,
    });
  }
  return holders;
}

/**
 * List every `VestingPosition` account for the given TRUST + mint.
 *
 * `aeqi_vesting` indexes positions by `(trust, position_id)`; there is
 * no on-chain `(trust, mint)` index, so the cheapest read is:
 *   1. `getProgramAccounts(aeqi_vesting, [memcmp(offset=8, trust)])`
 *      (Anchor's `account.vestingPosition.all([memcmp])` is the typed
 *      wrapper around this).
 *   2. Client-side filter by `account.mint === capTableMint`.
 *
 * Returns `[]` when the vesting module isn't deployed for this TRUST.
 * The `getProgramAccounts` call itself is cheap when no accounts match.
 */
export async function readVestingPositions(
  trustPda: string | PublicKey,
  mintPda: string | PublicKey,
): Promise<VestingPositionWithPda[]> {
  const program = getVestingProgram();
  const trustKey = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const mintKey = typeof mintPda === "string" ? new PublicKey(mintPda) : mintPda;

  const results = await program.account.vestingPosition.all([
    {
      memcmp: {
        // Discriminator(8) + trust(32) — `trust` is the first struct field.
        offset: 8,
        bytes: trustKey.toBase58(),
      },
    },
  ]);

  return results
    .filter((r) => (r.account as VestingPositionAccount).mint.equals(mintKey))
    .map((r) => ({
      publicKey: r.publicKey,
      account: r.account as VestingPositionAccount,
    }));
}

/**
 * Convenience: derive the cap-table mint PDA for a TRUST. Exported here
 * so the Equity hook can reuse the derivation without re-importing the
 * full `pdas` surface from page-level code.
 */
export function deriveCapTableMintPda(trustPda: string | PublicKey): PublicKey {
  const trustKey = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  return deriveTokenMintPda(trustKey);
}

/**
 * List every `FundingRequest` declared against the given TRUST.
 *
 * The on-chain layout is
 *   `[discriminator(8)][trust(32)][request_id(32)][creator(32)]…`,
 * so `memcmp(offset=8, trust)` filters to one TRUST in a single
 * round-trip. Returns `[]` when the funding module isn't deployed or no
 * rounds have been declared — the section renders a quiet empty state
 * in that case.
 *
 * Soft-fails like vesting: if `aeqi_funding` isn't deployed against the
 * cluster, Anchor's `account.fundingRequest.all` raises — the hook
 * downstream catches and treats as empty so the form keeps working.
 */
export async function readFundingRequests(
  trustPda: string | PublicKey,
): Promise<FundingRequestWithPda[]> {
  const program = getFundingProgram();
  const trustKey = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;

  const results = await program.account.fundingRequest.all([
    {
      memcmp: {
        offset: 8,
        bytes: trustKey.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as FundingRequestAccount,
  }));
}

/* ------------------------------------------------------------------ */
/* Funding-round ledger reads — iter-10                                */
/* ------------------------------------------------------------------ */

/** Typed alias for the BondingCurve account from the Unifutures program. */
export type BondingCurveAccount = IdlAccounts<AeqiUnifutures>["bondingCurve"];

/** Typed alias for the CommitmentSale account from the Unifutures program. */
export type CommitmentSaleAccount = IdlAccounts<AeqiUnifutures>["commitmentSale"];

/** Typed alias for the Exit account from the Unifutures program. */
export type ExitAccount = IdlAccounts<AeqiUnifutures>["exit"];

/**
 * Result of reading the underlying Unifutures primitive for an activated
 * FundingRequest. Each kind carries its native shape; consumers
 * pattern-match on `kind` to extract the right counters.
 *
 * Returned shape mirrors the on-chain account exactly so the UI doesn't
 * have to re-derive counters when more fields are surfaced. `null` ⇒ the
 * primitive_id on the FundingRequest doesn't resolve to an account on
 * the configured cluster (typical for honest-stub activations the
 * platform handler hasn't backfilled yet).
 */
export type FundingPrimitive =
  | { kind: "commitment_sale"; address: PublicKey; account: CommitmentSaleAccount }
  | { kind: "bonding_curve"; address: PublicKey; account: BondingCurveAccount }
  | { kind: "exit"; address: PublicKey; account: ExitAccount };

/**
 * Resolve the underlying Unifutures primitive backing an activated
 * FundingRequest. PDA derivation mirrors `aeqi-unifutures`:
 *
 *   - kind 0 (CommitmentSale): `[b"sale",  trust, sale_id]`
 *   - kind 1 (BondingCurve):   `[b"curve", trust, curve_id]`
 *   - kind 2 (Exit):           `[b"exit",  trust, exit_id]`
 *
 * `primitive_id` lives on the FundingRequest and is set on activation by
 * the platform to the sale_id / curve_id / exit_id of the newly-created
 * primitive. Pre-activation it's all-zeros — caller must filter to
 * status == 1 (Activated) before calling this.
 *
 * Soft-fails to `null` on any fetch error so the UI can render a quiet
 * "ledger not yet visible" state without crashing the section. The
 * platform's activation route is itself an honest stub (see
 * `api.fundingActivate`), so this read may return null for sessions
 * after the toggle-flip until the real activation handler ships.
 */
export async function readFundingPrimitive(
  trustPda: string | PublicKey,
  kind: number,
  primitiveId: Uint8Array | number[],
): Promise<FundingPrimitive | null> {
  const trustKey = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const idBytes = primitiveId instanceof Uint8Array ? primitiveId : Uint8Array.from(primitiveId);
  if (idBytes.length !== 32 || idBytes.every((b) => b === 0)) return null;

  const program = getUnifuturesProgram();

  const seedPrefix = kind === 0 ? "sale" : kind === 1 ? "curve" : kind === 2 ? "exit" : null;
  if (!seedPrefix) return null;

  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(seedPrefix), trustKey.toBytes(), idBytes],
    AEQI_UNIFUTURES_PROGRAM_ID,
  );

  try {
    if (kind === 0) {
      const account = (await program.account.commitmentSale.fetchNullable(
        pda,
      )) as CommitmentSaleAccount | null;
      if (!account) return null;
      return { kind: "commitment_sale", address: pda, account };
    }
    if (kind === 1) {
      const account = (await program.account.bondingCurve.fetchNullable(
        pda,
      )) as BondingCurveAccount | null;
      if (!account) return null;
      return { kind: "bonding_curve", address: pda, account };
    }
    const account = (await program.account.exit.fetchNullable(pda)) as ExitAccount | null;
    if (!account) return null;
    return { kind: "exit", address: pda, account };
  } catch {
    // Common cause on stub clusters: program not deployed at the
    // expected ID. Treat as "ledger not visible yet" rather than a
    // section-blocking error.
    return null;
  }
}
