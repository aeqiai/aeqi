/**
 * `useEquityVesting` — shared vesting subscriber for the Equity surface.
 *
 * Iter-7 functional gap: the equity page already lifted curve state into
 * `useCurveTrades` (iter-6), so HolderDrawer activity + RecentTradesLog +
 * the chart all refresh in lockstep after a successful trade. Vesting
 * stayed split:
 *
 *   - VestingSection rendered the per-row Schedule chart from the
 *     positions array the page passed it.
 *   - HolderDrawer rolled the same positions array into a per-holder
 *     "claimable now" total.
 *   - A successful Claim posted to `api.vestingClaim(...)` but only
 *     updated the row's own ephemeral `RowState` (✓ Claimed message).
 *     The on-chain claimed amount + the schedule chart fill + the drawer
 *     rollup stayed stale until full page navigation refetched.
 *
 * This hook collapses the contract: it owns the vesting list (delegated
 * to React Query under the `useEquity` key so we don't double-fetch),
 * exposes a `refresh()` action that invalidates the same RQ cache, and
 * carries a `refreshTick` consumers can depend on for memo-friendly
 * change detection.
 *
 * Why not pass a callback directly into VestingSection? Two consumers
 * need the refresh on a Claim (the per-row chart inside the section AND
 * the page-level HolderDrawer mounted by CapTableSection). Forcing one
 * to "lift a callback" through prop drilling would re-spread the same
 * problem the hook was added to solve. A single hook keyed on
 * `companyAddress` makes both consumers read from the same cache.
 *
 * Mirrors the `useCurveTrades` shape so the two share a mental model:
 *  - `positions`/`trades` is the canonical list
 *  - `isLoading` is true on the initial load
 *  - `refresh()` is the consumer-fired lever after a write settles
 *  - `tick` increments on every refresh so memo dependencies pick it up
 */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { VestingPositionWithPda } from "@/solana";

export interface UseEquityVestingResult {
  /** Canonical vesting list — same array the page renders. */
  positions: VestingPositionWithPda[];
  /** Monotonic tick that increments after every successful refresh. */
  tick: number;
  /** Force a re-fetch of vesting positions for the configured COMPANY. */
  refresh(): void;
}

/**
 * Subscribe to the vesting list for a COMPANY and expose a refresh lever.
 *
 * The hook does NOT re-fetch on mount — the page already has the
 * positions loaded via `useEquity`. It exists to:
 *   1. Provide a single `refresh()` entry point both VestingSection and
 *      HolderDrawer can call after a Claim resolves.
 *   2. Increment a `tick` so downstream `useMemo`s (Schedule chart fill,
 *      drawer rollup) re-evaluate even when the array reference is
 *      identical (RQ returns the same object reference on stale-while-
 *      revalidate cache hits).
 */
export function useEquityVesting(
  companyAddress: string | null | undefined,
  positions: VestingPositionWithPda[],
): UseEquityVestingResult {
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    // The vesting query in `useEquity` is keyed on
    //   ["equity", "vesting", companyAddress, mintAddress]
    // Invalidating the partial prefix forces RQ to re-fetch every
    // vesting fetcher for this COMPANY regardless of which mint address
    // the page has resolved.
    void queryClient.invalidateQueries({
      queryKey: ["equity", "vesting", companyAddress ?? null],
    });
    // The cap-table mint reads claimed_amount via the holders query
    // (claimed tokens land in the recipient's ATA); refresh that too so
    // the cap-table reflects the new balance before the next 30s
    // staleTime window expires.
    void queryClient.invalidateQueries({
      queryKey: ["equity", "holders"],
    });
    setTick((t) => t + 1);
  }, [queryClient, companyAddress]);

  return { positions, tick, refresh };
}
