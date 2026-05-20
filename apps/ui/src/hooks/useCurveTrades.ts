/**
 * `useCurveTrades` — shared fetcher for `/api/curves/{trustId}/state`.
 *
 * Iter-6 functional gap: prior to this hook the curve state was fetched
 * in two independent places — once at `EquityGenesisCurveSection` (so
 * the chart marker reacts to Buy/Sell) and once at the page level (so
 * the `HolderDrawer` can render per-holder recent activity). Each
 * fetcher owned its own request, its own loading state, and its own
 * cache, which meant:
 *
 *   1. A successful Buy refreshed the chart but left the drawer's
 *      activity stream stale until the next page navigation.
 *   2. Switching tabs and back paid for two network round-trips on a
 *      single Equity render even though both consumers wanted the same
 *      payload.
 *
 * This hook collapses both into one fetcher keyed by `trustId` +
 * `refreshTick`. The genesis curve section drives the tick after every
 * successful trade, the page hands the tick to the cap-table section,
 * and the drawer reads from the same hook output. Curve activity that
 * lands in the indexer is now visible everywhere on the same fetch.
 *
 * Why not React Query? The rest of the equity surface already mixes
 * `useEquity` (RQ-based) with bespoke `useState` fetchers (curve section
 * + page-level effect). A single hook with the same shape keeps the
 * surface internally consistent without forcing a wider migration.
 * Future iters can promote this to RQ if a second consumer surfaces.
 *
 * Soft-fails: 409 `curve_not_provisioned` (Foundation TRUSTs,
 * partially-provisioned ventures, ledger-reset stranded placements) is
 * NOT an error — it's the absence of a curve. The hook flags it
 * separately so the consumer can render an empty state without painting
 * a generic failure.
 */
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { CurveTrade } from "@/components/equity/RecentTradesLog";

export type CurveState = Awaited<ReturnType<typeof api.getCurveState>>;

export interface UseCurveTradesResult {
  /** Last successful curve state, or null while loading / when missing. */
  state: CurveState | null;
  /** Trades projected by the indexer. Empty when offline or pre-genesis. */
  trades: CurveTrade[];
  /** True when the curve PDA isn't provisioned (quiet empty state). */
  missing: boolean;
  /** Non-409 fetch error, or null. */
  error: string | null;
  /** True while the initial fetch is in flight. */
  isLoading: boolean;
  /** True when the indexer projection is offline (state is good, log isn't). */
  tradesUnavailable: boolean;
}

/**
 * Subscribe to the live curve state for a TRUST. Re-fetches whenever
 * `trustId` or `refreshTick` changes — `refreshTick` is the consumer's
 * lever for "I just landed a Buy/Sell, refresh now".
 *
 * Returns a stable shape so downstream `useMemo`s can depend on
 * individual fields rather than recomputing on every render.
 */
export function useCurveTrades(trustId: string, refreshTick: number = 0): UseCurveTradesResult {
  const [state, setState] = useState<CurveState | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!trustId) {
      setState(null);
      setMissing(false);
      setError(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        const next = await api.getCurveState(trustId);
        if (cancelled) return;
        setState(next);
        setMissing(false);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "";
        if (message.includes("curve_not_provisioned")) {
          setMissing(true);
          setError(null);
        } else {
          setError(message || "Failed to load curve state.");
        }
        setState(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustId, refreshTick]);

  return {
    state,
    trades: state?.recent_trades ?? [],
    missing,
    error,
    isLoading,
    tradesUnavailable: state?.recent_trades_unavailable === true,
  };
}
