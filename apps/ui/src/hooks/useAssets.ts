/**
 * `useAssets` — React Query wrapper around the four on-chain reads the
 * Assets surface needs:
 *
 *   1. Treasury vault descriptor (module-state PDA + vault authority
 *      PDA — derivable without RPC — + the on-chain module-state
 *      account if registered).
 *   2. Vault holdings (SPL token accounts owned by the vault authority
 *      PDA, across both token programs).
 *   3. Budgets per role (scoped scan of `aeqi_budget`).
 *   4. Vesting position count (scoped scan of `aeqi_vesting`).
 *
 * Modules (3) and (4) are optional: a Foundation-shaped TRUST adopts
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

import {
  readAllVestingPositions,
  readBudgets,
  readTreasuryModuleState,
  readVaultHoldings,
} from "@/solana/assets";
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
 * Resolve a TRUST's on-chain Assets state.
 *
 * Pass the base58-encoded Trust PDA (matches `entity.trust_address` on
 * the platform-side Trust record). When `trustAddress` is null/empty
 * every query stays disabled — useful for the pre-bridge state where
 * the entity has no on-chain mirror yet.
 *
 * Holdings depends on the vault descriptor (we need the vault authority
 * PDA before we can ask the chain for its token accounts), so it's
 * gated on the vault query's data. Both budgets and vesting count
 * scans run in parallel with the vault descriptor — neither needs
 * vault data to start.
 */
export function useAssets(trustAddress: string | null | undefined): UseAssetsResult {
  const enabled = !!trustAddress;

  const vaultQuery = useQuery({
    queryKey: ["assets", "vault", trustAddress ?? null],
    queryFn: () => readTreasuryModuleState(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const holdingsQuery = useQuery({
    queryKey: ["assets", "holdings", vaultQuery.data?.vaultAuthorityPda?.toBase58() ?? null],
    queryFn: () => readVaultHoldings(vaultQuery.data!.vaultAuthorityPda),
    enabled: enabled && !!vaultQuery.data,
    staleTime: STALE_TIME_MS,
  });

  const budgetsQuery = useQuery({
    queryKey: ["assets", "budgets", trustAddress ?? null],
    queryFn: async () => {
      try {
        return await readBudgets(trustAddress as string);
      } catch {
        // Treasury without budget-module is a real shape (Foundation
        // TRUSTs). Swallow scan errors so the surface degrades to "no
        // budgets" instead of "couldn't load assets".
        return [];
      }
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const vestingQuery = useQuery({
    queryKey: ["assets", "vesting-positions", trustAddress ?? null],
    queryFn: async () => {
      try {
        return await readAllVestingPositions(trustAddress as string);
      } catch {
        // Treasury without vesting-module is a real shape (Foundation
        // TRUSTs). Swallow scan errors so the surface degrades to "no
        // positions" instead of "couldn't load assets".
        return [] as VestingPositionWithPda[];
      }
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const refetch = () => {
    void vaultQuery.refetch();
    void holdingsQuery.refetch();
    void budgetsQuery.refetch();
    void vestingQuery.refetch();
  };

  return {
    vault: vaultQuery.data,
    holdings: holdingsQuery.data,
    budgets: budgetsQuery.data,
    vestingPositions: vestingQuery.data,
    vestingCount: vestingQuery.data?.length,
    isLoading:
      enabled &&
      (vaultQuery.isLoading ||
        holdingsQuery.isLoading ||
        budgetsQuery.isLoading ||
        vestingQuery.isLoading),
    isFetching:
      enabled &&
      (vaultQuery.isFetching ||
        holdingsQuery.isFetching ||
        budgetsQuery.isFetching ||
        vestingQuery.isFetching),
    error:
      (vaultQuery.error as Error | null) ??
      (holdingsQuery.error as Error | null) ??
      (budgetsQuery.error as Error | null) ??
      (vestingQuery.error as Error | null) ??
      null,
    refetch,
  };
}
