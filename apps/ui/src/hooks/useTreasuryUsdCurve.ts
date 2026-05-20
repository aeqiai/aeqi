/**
 * `useTreasuryUsdCurve` — replay the decoded vault activity backwards
 * from current stablecoin balance to produce a per-day USD curve across
 * a 30-day window.
 *
 * Iter-5 closes the gap left by `useVaultActivity`'s sparkline: that
 * one counts on-chain signatures, which is useful as a "busy / quiet"
 * signal but not as a treasury value curve. Once decoded deposits and
 * withdraws carry a `mint` + `amount`, we can:
 *
 *   1. Compute today's stablecoin USD from current holdings (par-value).
 *   2. Walk the decoded rows oldest → newest in reverse, undoing each
 *      stablecoin deposit/withdraw to recover the USD balance at the
 *      block-time of each event.
 *   3. Snap each event to a day bucket; for empty days, carry forward
 *      the prior day's balance so the curve doesn't dip to zero on
 *      quiet days.
 *
 * Honest scope:
 *   - Only registered stablecoin mints contribute. AEQI-issued shares
 *     and unknown SPLs are ignored — we have no price oracle and faking
 *     a price would lie to the operator.
 *   - The curve is bounded by `useDecodedVaultActivity`'s `DECODE_LIMIT`
 *     (12 by default). Older deposits beyond the decode window are
 *     invisible; the curve floor approaches "current balance minus the
 *     net of decoded movements", which is the honest reading.
 *   - Internal transfers (vault → vault ATA shuffles) net to zero so
 *     they don't move the curve.
 *
 * Returns the daily series in the same shape `useVaultActivity` uses
 * (length = windowDays, oldest first) so the existing sparkline component
 * can render either source by swapping the prop.
 */
import { useMemo } from "react";

import type { DecodedActivity } from "@/hooks/useDecodedVaultActivity";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import { isStableSymbol, rawToFloat } from "@/pages/AssetsSections";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface TreasuryUsdCurve {
  /** Daily USD balance, oldest first, length = windowDays. */
  series: number[];
  /** Did any decoded row contribute to the curve? Used by the host to
   *  decide between USD-curve and signature-count rendering. */
  hasStableEvents: boolean;
  /** Current stablecoin USD (the curve's right edge). */
  currentUsd: number;
}

export function useTreasuryUsdCurve(
  decoded: DecodedActivity[],
  currentStableUsd: number,
  metas: Record<string, ResolvedTokenMeta>,
  windowDays: number = 30,
): TreasuryUsdCurve {
  return useMemo<TreasuryUsdCurve>(() => {
    const todayStart = startOfDay(Date.now());
    // Translate each decoded row into a signed USD delta (deposit → +,
    // withdraw → -). Internal transfers and non-stable mints contribute 0.
    type Event = { dayDelta: number; deltaUsd: number };
    const events: Event[] = [];
    let hasStableEvents = false;

    for (const row of decoded) {
      if (row.blockTime === null) continue;
      if (row.amount === null) continue;
      if (row.kind !== "deposit" && row.kind !== "withdraw") continue;
      const mint = row.mint;
      if (!mint) continue;
      const meta = metas[mint];
      if (!meta?.symbol || !isStableSymbol(meta.symbol) || meta.decimals === null) continue;
      const usd = rawToFloat(row.amount, meta.decimals);
      if (!Number.isFinite(usd) || usd <= 0) continue;
      const dayDelta = Math.floor((todayStart - startOfDay(row.blockTime * 1000)) / DAY_MS);
      if (dayDelta < 0 || dayDelta >= windowDays * 4) continue;
      events.push({ dayDelta, deltaUsd: row.kind === "deposit" ? usd : -usd });
      hasStableEvents = true;
    }

    if (!hasStableEvents) {
      return {
        series: new Array(windowDays).fill(currentStableUsd),
        hasStableEvents: false,
        currentUsd: currentStableUsd,
      };
    }

    // Sort events newest → oldest, accumulate a running "balance at end
    // of that day" map by undoing each event from the current balance.
    events.sort((a, b) => a.dayDelta - b.dayDelta);

    // Working balance: end-of-today USD. Each event's delta tells us how
    // the balance changed *on* that day; undoing it gives us the balance
    // at the end of the day *before* the event.
    const endOfDayUsd = new Array<number | null>(windowDays).fill(null);
    let runningUsd = currentStableUsd;
    // Index `windowDays - 1` is today (right edge), index 0 is windowDays-1 days ago.
    endOfDayUsd[windowDays - 1] = runningUsd;

    // Group events by dayDelta so a day with multiple flows nets correctly.
    const byDay = new Map<number, number>();
    for (const e of events) {
      byDay.set(e.dayDelta, (byDay.get(e.dayDelta) ?? 0) + e.deltaUsd);
    }
    const sortedDayDeltas = [...byDay.keys()].sort((a, b) => a - b);

    // Walk recent → ancient, undoing the net day delta as we move back.
    // After undoing day D's delta, `runningUsd` holds the balance at the
    // end of day D-1 (yesterday in that frame). Snap that into the slot
    // matching D+1 days ago, carrying forward where we have no event.
    for (const dayDelta of sortedDayDeltas) {
      const dayNet = byDay.get(dayDelta) ?? 0;
      runningUsd -= dayNet;
      const idx = windowDays - 1 - (dayDelta + 1);
      if (idx >= 0 && idx < windowDays) {
        endOfDayUsd[idx] = runningUsd;
      }
    }

    // Fill gaps forwards then backwards so every slot has a value.
    let last: number | null = null;
    for (let i = windowDays - 1; i >= 0; i -= 1) {
      if (endOfDayUsd[i] === null) {
        endOfDayUsd[i] = last;
      } else {
        last = endOfDayUsd[i] as number;
      }
    }
    let head: number | null = null;
    for (let i = 0; i < windowDays; i += 1) {
      if (endOfDayUsd[i] === null) {
        endOfDayUsd[i] = head ?? currentStableUsd;
      } else {
        head = endOfDayUsd[i] as number;
      }
    }

    const series = endOfDayUsd.map((v) => Math.max(0, v ?? 0));
    return { series, hasStableEvents: true, currentUsd: currentStableUsd };
  }, [decoded, currentStableUsd, metas, windowDays]);
}
