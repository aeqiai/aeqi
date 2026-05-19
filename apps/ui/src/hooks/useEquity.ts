/**
 * `useEquity` — React Query wrapper around the four on-chain reads the
 * Equity surface needs:
 *
 *   1. `TokenModuleState` PDA — drives the Foundation-vs-Venture branch.
 *   2. Token-2022 mint (supply, decimals, freeze authority).
 *   3. Cap-table holders via `getProgramAccounts(TOKEN_2022_PROGRAM_ID)`.
 *   4. Vesting positions via `aeqi_vesting.account.vestingPosition.all`.
 *
 * Reads (2)-(4) gate on (1): if `TokenModuleState` is null (Foundation
 * TRUSTs, or pre-bridge TRUSTs) the heavy reads stay disabled — no
 * point hitting the network for accounts we know don't exist.
 *
 * 30s `staleTime` matches Incorporation. Cap tables and vesting
 * positions only change on operator actions through aeqi-platform
 * (mint, transfer, vesting create) — not every block.
 */
import { useQuery } from "@tanstack/react-query";
import type { Mint } from "@solana/spl-token";

import {
  deriveCapTableMintPda,
  readHolders,
  readMint,
  readTokenModuleState,
  readVestingPositions,
  type TokenHolder,
  type TokenModuleStateAccount,
  type VestingPositionWithPda,
} from "@/solana/equity";

const STALE_TIME_MS = 30_000;

export interface UseEquityResult {
  /** `TokenModuleState` PDA, or null when the TRUST is Foundation-shape. */
  tokenModuleState: TokenModuleStateAccount | null | undefined;
  /** Token-2022 mint (supply / decimals / authorities), null if absent. */
  mint: Mint | null | undefined;
  /** Base58-encoded cap-table mint address (always derivable). */
  mintAddress: string | null;
  /** Cap-table holders sorted by amount desc. Empty when no token module. */
  holders: TokenHolder[] | undefined;
  /** Vesting positions tied to the cap-table mint. Empty when none. */
  vesting: VestingPositionWithPda[] | undefined;
  /** True while ANY enabled query is loading. */
  isLoading: boolean;
  /** First non-null error from any query, or null. */
  error: Error | null;
  /**
   * True when the TRUST has no `TokenModuleState` (Foundation-shape).
   * The page uses this to render the "no equity module" empty state
   * without falling through to the cap-table sections.
   */
  isFoundation: boolean;
}

/**
 * Resolve a TRUST's on-chain Equity state.
 *
 * Pass the base58-encoded Trust PDA (matches `entity.trust_address`).
 * When `trustAddress` is null/empty all queries stay disabled — useful
 * for the pre-bridge state.
 */
export function useEquity(trustAddress: string | null | undefined): UseEquityResult {
  const enabled = !!trustAddress;
  const mintAddress = enabled ? deriveCapTableMintPda(trustAddress as string).toBase58() : null;

  // (1) TokenModuleState — Foundation discriminator. Drives subsequent queries.
  const moduleStateQuery = useQuery({
    queryKey: ["equity", "tokenModuleState", trustAddress ?? null],
    queryFn: () => readTokenModuleState(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const hasTokenModule = moduleStateQuery.data != null;
  const heavyEnabled = enabled && hasTokenModule && !!mintAddress;

  // (2) Token-2022 mint — supply, decimals.
  const mintQuery = useQuery({
    queryKey: ["equity", "mint", mintAddress],
    queryFn: () => readMint(mintAddress as string),
    enabled: heavyEnabled,
    staleTime: STALE_TIME_MS,
  });

  // (3) Cap-table holders — sorted by amount desc.
  const holdersQuery = useQuery({
    queryKey: ["equity", "holders", mintAddress],
    queryFn: async () => {
      const rows = await readHolders(mintAddress as string);
      return [...rows].sort((a, b) => {
        // Sort by raw amount desc — bigint comparison via subtraction
        // would overflow Number; compare directly.
        if (a.amount === b.amount) return 0;
        return a.amount > b.amount ? -1 : 1;
      });
    },
    enabled: heavyEnabled,
    staleTime: STALE_TIME_MS,
  });

  // (4) Vesting positions tied to this mint. Soft-fail: when aeqi_vesting
  // isn't deployed (or no positions exist) we want an empty section, not
  // a page-level error. We surface the error in the hook for diagnostics
  // but the page treats `vesting = []` and `vesting = undefined-with-error`
  // the same way.
  const vestingQuery = useQuery({
    queryKey: ["equity", "vesting", trustAddress ?? null, mintAddress],
    queryFn: () => readVestingPositions(trustAddress as string, mintAddress as string),
    enabled: heavyEnabled,
    staleTime: STALE_TIME_MS,
  });

  const firstError =
    (moduleStateQuery.error as Error | null) ??
    (mintQuery.error as Error | null) ??
    (holdersQuery.error as Error | null) ??
    null;

  return {
    tokenModuleState: moduleStateQuery.data,
    mint: mintQuery.data,
    mintAddress,
    holders: holdersQuery.data,
    vesting: vestingQuery.data,
    isLoading:
      moduleStateQuery.isLoading ||
      (heavyEnabled && (mintQuery.isLoading || holdersQuery.isLoading || vestingQuery.isLoading)),
    error: firstError,
    isFoundation:
      enabled && !moduleStateQuery.isLoading && !moduleStateQuery.error && !hasTokenModule,
  };
}
