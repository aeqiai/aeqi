/**
 * `useAssets` — React Query wrapper around the server-side Assets
 * snapshot the surface needs:
 *
 *   1. Treasury vault descriptor (module-state PDA + vault authority
 *      PDA — derivable without RPC — + the on-chain module-state
 *      account if registered).
 *   2. Vault holdings (SPL token accounts owned by the vault authority
 *      PDA, across both token programs).
 *   3. Budgets per role (scoped scan of `aeqi_budget`).
 *   4. Vesting position count (scoped scan of `aeqi_vesting`).
 *
 * Modules (3) and (4) are optional: a Foundation-shaped COMPANY adopts
 * only role/governance/treasury, so budget/vesting scans return `[]`/0
 * cleanly. The hook never errors when those modules are absent.
 *
 * Stale time matches Incorporation (30s) — holdings, budgets, and
 * positions change on operator action, not every block. The user
 * notices a missed refresh of a deposit later than 30s — but a real
 * "did my deposit land?" check should manually refetch from the UI
 * (`refetch()` returned below).
 */
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";

import { api } from "@/lib/api";
import type {
  BudgetAccountWithPda,
  TreasuryVault,
  VaultHolding,
  VestingPositionWithPda,
} from "@/solana/assets";

const STALE_TIME_MS = 30_000;

export interface UseAssetsResult {
  vault: TreasuryVault | undefined;
  holdings: VaultHolding[] | undefined;
  budgets: BudgetAccountWithPda[] | undefined;
  /** Full per-position vesting list — drives the Vesting table. */
  vestingPositions: VestingPositionWithPda[] | undefined;
  /** Count-only headline, kept for backward compatibility. Equal to
   *  `vestingPositions?.length ?? undefined`. */
  vestingCount: number | undefined;
  isLoading: boolean;
  /** True iff the most recent refetch is in-flight. Drives the
   *  "Refresh" affordance's disabled state. */
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Resolve a COMPANY's on-chain Assets state.
 *
 * Pass the base58-encoded Company PDA (matches `entity.company_address` on
 * the platform-side Company record). When `companyAddress` is null/empty
 * every query stays disabled — useful for the pre-bridge state where
 * the entity has no on-chain mirror yet.
 *
 * Holdings depends on the vault descriptor (we need the vault authority
 * PDA before we can ask the chain for its token accounts), so it's
 * gated on the vault query's data. Both budgets and vesting count
 * scans run in parallel with the vault descriptor — neither needs
 * vault data to start.
 */
export function useAssets(companyAddress: string | null | undefined): UseAssetsResult {
  const enabled = !!companyAddress;

  const snapshotQuery = useQuery({
    queryKey: ["assets", "snapshot", companyAddress ?? null],
    queryFn: async () =>
      decodeAssetsSnapshot(await api.getCompanyAssetsByAddress(companyAddress as string)),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const refetch = () => {
    void snapshotQuery.refetch();
  };

  return {
    vault: snapshotQuery.data?.vault,
    holdings: snapshotQuery.data?.holdings,
    budgets: snapshotQuery.data?.budgets,
    vestingPositions: snapshotQuery.data?.vestingPositions,
    vestingCount: snapshotQuery.data?.vestingPositions.length,
    isLoading: enabled && snapshotQuery.isLoading,
    isFetching: enabled && snapshotQuery.isFetching,
    error: (snapshotQuery.error as Error | null) ?? null,
    refetch,
  };
}

type RawAssetsSnapshot = Awaited<ReturnType<typeof api.getCompanyAssetsByAddress>>;

function decodeAssetsSnapshot(raw: RawAssetsSnapshot): {
  vault: TreasuryVault;
  holdings: VaultHolding[];
  budgets: BudgetAccountWithPda[];
  vestingPositions: VestingPositionWithPda[];
} {
  return {
    vault: {
      moduleStatePda: new PublicKey(raw.vault.module_state_pda),
      vaultAuthorityPda: new PublicKey(raw.vault.vault_authority_pda),
      moduleState: raw.vault.module_state
        ? ({
            company: new PublicKey(raw.vault.module_state.company),
            treasuryAuthority: new PublicKey(raw.vault.module_state.treasury_authority),
            bump: raw.vault.module_state.bump,
          } as TreasuryVault["moduleState"])
        : null,
    },
    holdings: raw.holdings.map((h) => ({
      tokenAccount: new PublicKey(h.token_account),
      mint: new PublicKey(h.mint),
      amount: BigInt(h.amount),
      programId: new PublicKey(h.program_id),
    })),
    budgets: raw.budgets.map((b) => ({
      publicKey: new PublicKey(b.public_key),
      account: {
        company: new PublicKey(b.account.company),
        budgetId: b.account.budget_id,
        grantor: new PublicKey(b.account.grantor),
        targetRoleId: b.account.target_role_id,
        parentBudgetId: b.account.parent_budget_id,
        amount: BigInt(b.account.amount),
        spent: BigInt(b.account.spent),
        expiry: BigInt(b.account.expiry),
        frozen: b.account.frozen,
        bump: b.account.bump,
      },
    })) as BudgetAccountWithPda[],
    vestingPositions: raw.vesting_positions.map((p) => ({
      publicKey: new PublicKey(p.public_key),
      account: {
        company: new PublicKey(p.account.company),
        positionId: p.account.position_id,
        recipient: new PublicKey(p.account.recipient),
        mint: new PublicKey(p.account.mint),
        grantor: new PublicKey(p.account.grantor),
        totalAmount: BigInt(p.account.total_amount),
        claimedAmount: BigInt(p.account.claimed_amount),
        startTime: BigInt(p.account.start_time),
        cliffTime: BigInt(p.account.cliff_time),
        endTime: BigInt(p.account.end_time),
        fdvMilestoneUnlocked: p.account.fdv_milestone_unlocked,
        contributionRequired: BigInt(p.account.contribution_required),
        contributionPaid: p.account.contribution_paid,
        contributionMint: new PublicKey(p.account.contribution_mint),
        bump: p.account.bump,
      },
    })) as VestingPositionWithPda[],
  };
}
