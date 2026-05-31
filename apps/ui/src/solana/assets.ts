/**
 * On-chain reads for the Assets surface.
 *
 * Assets is the COMPANY's wealth surface — "what does this COMPANY hold?" —
 * and the user-facing answer to the "COMPANY capitalizes self → buys
 * runtime" model: deposit USDC at the vault address, and the COMPANY owns
 * the balance going forward. The hero affordance on the page is the
 * vault deposit address; everything else is supporting context.
 *
 * Source-of-truth references:
 *   - `TreasuryModuleState`: `programs/aeqi-treasury/src/lib.rs:38-52`;
 *     PDA `[b"treasury_module", company]`.
 *   - Vault authority PDA: `programs/aeqi-treasury/src/lib.rs:86,155,176`;
 *     PDA `[b"treasury_vault_authority", company]`. Token accounts owned by
 *     this PDA ARE the COMPANY's holdings.
 *   - `Budget`: `programs/aeqi-budget/src/state.rs`; PDA
 *     `[b"budget", company, budget_id]`. First field after the 8-byte
 *     discriminator is `company: Pubkey`, so a memcmp at offset 8 scopes
 *     the list to one COMPANY.
 *   - `VestingPosition`: `programs/aeqi-vesting/src/state.rs`; same
 *     `company: Pubkey` layout at offset 8.
 *
 * Holdings enumeration goes direct to RPC via
 * `getTokenAccountsByOwner(vault_authority_pda, ...)` for both the
 * Token-2022 program (where AEQI-issued mints live) and the legacy SPL
 * Token program (where USDC and most other deposit assets live today).
 * The set of accepted mints is NOT enumerated on-chain — each deposit
 * pins a `(mint, vault_ata)` pair implicitly.
 */
import { PublicKey } from "@solana/web3.js";
import type { IdlAccounts } from "@coral-xyz/anchor";

import { getConnection } from "./client";
import { deriveTreasuryModuleStatePda, deriveTreasuryVaultAuthorityPda } from "./pdas";
import { getBudgetProgram, getTreasuryProgram, getVestingProgram } from "./programs";
import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeTokenAccount,
} from "./splToken";
import type { AeqiBudget } from "./generated/types/aeqi_budget";
import type { AeqiTreasury } from "./generated/types/aeqi_treasury";
import type { AeqiVesting } from "./generated/types/aeqi_vesting";

/* ------------------------------------------------------------------ */
/* Typed aliases                                                       */
/* ------------------------------------------------------------------ */

export type TreasuryModuleStateAccount = IdlAccounts<AeqiTreasury>["treasuryModuleState"];
export type BudgetAccount = IdlAccounts<AeqiBudget>["budget"];
export type VestingPositionAccount = IdlAccounts<AeqiVesting>["vestingPosition"];

export interface BudgetAccountWithPda {
  publicKey: PublicKey;
  account: BudgetAccount;
}

export interface VestingPositionWithPda {
  publicKey: PublicKey;
  account: VestingPositionAccount;
}

export interface VaultHolding {
  /** SPL token account address (the ATA — what the chain stores the balance under). */
  tokenAccount: PublicKey;
  /** The mint this token account holds. */
  mint: PublicKey;
  /** Raw token amount, base units (NOT decimal-adjusted). */
  amount: bigint;
  /** Which token program owns the token account — Token vs Token-2022. */
  programId: PublicKey;
}

export interface TreasuryVault {
  /** `[b"treasury_module", company]` PDA. */
  moduleStatePda: PublicKey;
  /** `[b"treasury_vault_authority", company]` PDA — the deposit destination. */
  vaultAuthorityPda: PublicKey;
  /** Fetched module-state account if registered; null if treasury module not adopted. */
  moduleState: TreasuryModuleStateAccount | null;
}

/* ------------------------------------------------------------------ */
/* Token registry — minimal, permissive                                */
/* ------------------------------------------------------------------ */

/**
 * Permissive symbol registry. Maps mint pubkey → symbol + decimals so the
 * Assets surface and the Overview cockpit's Assets tile can render
 * human-readable balances. Unknown mints fall back to the truncated mint
 * pubkey in the UI.
 *
 * Mainnet USDC: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals).
 *
 * Localnet USDC: `BscBtSVDbZCzSHikQSwmCuszX4f4nbESdnfrFYkbv3F3` (6 decimals).
 * Used by local demos and tests so the cockpit tile and Assets surface can
 * render a familiar token label for non-empty treasury balances.
 */
export const TOKEN_REGISTRY: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  BscBtSVDbZCzSHikQSwmCuszX4f4nbESdnfrFYkbv3F3: { symbol: "USDC", decimals: 6 },
};

export function lookupTokenMeta(mint: PublicKey | string): {
  symbol: string | null;
  decimals: number | null;
} {
  const key = typeof mint === "string" ? mint : mint.toBase58();
  const hit = TOKEN_REGISTRY[key];
  if (!hit) return { symbol: null, decimals: null };
  return { symbol: hit.symbol, decimals: hit.decimals };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Fetch the COMPANY's treasury vault descriptor — both PDAs (always
 * derivable from `trustPda`) plus the on-chain `TreasuryModuleState`
 * account if the treasury module has been initialized.
 *
 * Returns the two PDAs unconditionally so the UI can display the
 * deposit address even before the module is initialized (the chain
 * accepts deposits to the ATA derived from the vault authority PDA
 * regardless — the `deposit` instruction wraps that for indexer
 * events; raw transfers from a Solana wallet bypass the program and
 * still land in the same ATA).
 */
export async function readTreasuryModuleState(
  trustPda: string | PublicKey,
): Promise<TreasuryVault> {
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const moduleStatePda = deriveTreasuryModuleStatePda(pda);
  const vaultAuthorityPda = deriveTreasuryVaultAuthorityPda(pda);

  const program = getTreasuryProgram();
  const moduleState = (await program.account.treasuryModuleState.fetchNullable(
    moduleStatePda,
  )) as TreasuryModuleStateAccount | null;

  return { moduleStatePda, vaultAuthorityPda, moduleState };
}

/**
 * Enumerate every SPL token account owned by the COMPANY's vault
 * authority PDA across both token programs. Two parallel
 * `getTokenAccountsByOwner` calls — Token-2022 for AEQI-issued mints,
 * legacy SPL Token for USDC and most external assets.
 *
 * Empty balances are kept in the result on purpose: a zero balance on a
 * mint the COMPANY has historically held is still meaningful context.
 * Filtering happens at the UI layer.
 */
export async function readVaultHoldings(vaultAuthorityPda: PublicKey): Promise<VaultHolding[]> {
  const conn = getConnection();

  const [legacy, token2022] = await Promise.all([
    conn.getTokenAccountsByOwner(vaultAuthorityPda, { programId: TOKEN_PROGRAM_ID }),
    conn.getTokenAccountsByOwner(vaultAuthorityPda, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  // The standard 165-byte SPL token account and base Token-2022 account are
  // byte-compatible for the first 165 bytes (mint + owner + amount + ...);
  // extensions are tacked on after, so decoding the first 165 bytes is safe.
  const decode = (rawAccountInfo: {
    pubkey: PublicKey;
    account: { data: Buffer; owner: PublicKey };
  }): VaultHolding | null => {
    const data = rawAccountInfo.account.data;
    if (data.length < ACCOUNT_SIZE) return null;
    const decoded = decodeTokenAccount(data.subarray(0, ACCOUNT_SIZE));
    return {
      tokenAccount: rawAccountInfo.pubkey,
      mint: new PublicKey(decoded.mint),
      amount: decoded.amount,
      programId: rawAccountInfo.account.owner,
    };
  };

  return [
    ...legacy.value.map(decode).filter((h): h is VaultHolding => h !== null),
    ...token2022.value.map(decode).filter((h): h is VaultHolding => h !== null),
  ];
}

/**
 * List every Budget account scoped to one COMPANY. Wrapped in a try by
 * the caller: a Foundation-shaped COMPANY may not have `aeqi_budget`
 * adopted, in which case the call returns `[]` (no accounts match the
 * filter — not an error).
 *
 * Layout: `[discriminator(8)][company(32)][budget_id(32)][grantor(32)]…`
 * — memcmp at offset 8 with the company pubkey scopes the scan.
 */
export async function readBudgets(trustPda: string | PublicKey): Promise<BudgetAccountWithPda[]> {
  const program = getBudgetProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.budget.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as BudgetAccount,
  }));
}

/**
 * COUNT only — return the number of `VestingPosition` accounts for the
 * COMPANY. The Assets tile per task #14 surfaces just the headline ("N
 * positions outstanding"); per-position detail is deferred. Same memcmp
 * pattern: company pubkey at offset 8.
 */
export async function readVestingCount(trustPda: string | PublicKey): Promise<number> {
  const program = getVestingProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.vestingPosition.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.length;
}

/**
 * List every VestingPosition scoped to one COMPANY, across ALL mints.
 * Same memcmp pattern as `readVestingCount` but returns the decoded
 * account data so the Assets surface can render per-recipient detail
 * (claimed vs total, status, FDV milestone, contribution gate).
 *
 * Note: this returns positions across every mint the COMPANY has granted
 * against. The equity-side `readVestingPositions` in `./equity.ts`
 * filters to the cap-table mint only — keep both: Assets is treasury-wide,
 * Equity is share-only.
 */
export async function readAllVestingPositions(
  trustPda: string | PublicKey,
): Promise<VestingPositionWithPda[]> {
  const program = getVestingProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.vestingPosition.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as VestingPositionAccount,
  }));
}
