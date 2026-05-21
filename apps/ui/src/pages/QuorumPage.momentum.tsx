/**
 * Quorum surface — TallyDetail momentum sparkline + linear-extrapolation
 * outcome forecast.
 *
 * Iter-8 closes the iter-7 NEXT item: a per-proposal momentum sparkline
 * beneath the For/Against tracks inside TallyDetail. The on-chain
 * `VoteRecord` PDA does NOT carry a `created_at` field, so the data flow
 * is:
 *
 *   1. `VoteHistorySection` (sibling) already fetches vote records via
 *      `readVoteRecords(trust, proposalId)`. The detail-modal vote
 *      history is wired and cached.
 *   2. This component re-uses those same records and resolves a per-PDA
 *      `getSignaturesForAddress(votePda, { limit: 1 })` via the
 *      `useProposalMomentum` hook. Each PDA result is cached separately
 *      so flipping between proposals is cheap once warm.
 *   3. The cumulative for/against series is bucketed across the vote
 *      window and rendered as two stacked thin tracks.
 *   4. The same hook backs the iter-8 outcome forecast — a faint
 *      "would pass" / "would fail" verdict line + tooltip extrapolated
 *      from the current For/Against trajectory into the remaining
 *      window.
 *
 * Scope discipline: the actual rendering of the For/Against threshold
 * markers stays inside `TallyDetail` (parts.tsx). This file only owns
 * the sparkline track + the verdict pill; both are mounted as a single
 * `<TallyMomentumStrip />` JSX block underneath the existing rows.
 */
import { useMemo, useState } from "react";

import type { GovernanceConfigWithPda, ProposalAccount, VoteRecordWithPda } from "@/solana";
import { ChipClose, Tooltip } from "@/components/ui";
import {
  MOMENTUM_BUCKETS,
  projectMomentumForecast,
  useProposalMomentum,
  type ProposalMomentum,
} from "@/hooks/useProposalMomentum";
import styles from "./QuorumPage.module.css";
import { formatTimestamp } from "./QuorumPage.format";

/**
 * Mount-point inside `TallyDetail` — renders the momentum sparkline AND
 * the outcome forecast pill. Both surfaces share the same hook so the
 * RPC round-trips happen once per (trust, proposal) tuple.
 *
 * When `voteRecords` is empty the sparkline degrades to a flat baseline
 * (zero-cum across every bucket) and the forecast hides the verdict (no
 * signal yet, surfacing `would pass` on a zero-tally proposal would be
 * dishonest).
 */
export function TallyMomentumStrip({
  proposal,
  config,
  trustAddress,
  voteRecords,
  nowSeconds,
}: {
  proposal: ProposalAccount;
  /** When provided we can render the support-threshold line on the
   *  forecast; without it the verdict still computes against `0` (no
   *  threshold known) and renders as `unknown`. */
  config?: GovernanceConfigWithPda;
  trustAddress: string;
  voteRecords: VoteRecordWithPda[] | undefined;
  nowSeconds: number;
}) {
  const voteStart = Number(proposal.voteStart.toString());
  const voteDuration = Number(proposal.voteDuration.toString());
  const voteEnd = voteStart + voteDuration;

  const { data: momentum, isLoading } = useProposalMomentum({
    voteRecords,
    voteStart,
    voteEnd,
    trustAddress,
  });

  const forecast = useMemo(
    () =>
      projectMomentumForecast(momentum, {
        voteStart,
        voteEnd,
        nowSeconds,
        supportBps: config ? config.account.supportBps : 0,
      }),
    [momentum, voteStart, voteEnd, nowSeconds, config],
  );

  // Sparkline geometry. The track widths come from `MOMENTUM_BUCKETS`
  // bars sized via flex-grow — no inline width math required, the CSS
  // module owns the layout.
  const { forBars, againstBars, peak } = useMemo(() => {
    if (!momentum || momentum.buckets.length === 0) {
      return {
        forBars: new Array(MOMENTUM_BUCKETS).fill(0) as number[],
        againstBars: new Array(MOMENTUM_BUCKETS).fill(0) as number[],
        peak: 0,
      };
    }
    // Normalize against the cumulative peak across both tracks so the
    // visual reflects relative momentum — a proposal that's mostly
    // against still gets a comparable-height against track.
    let peak = 0n;
    for (const b of momentum.buckets) {
      const f = BigInt(b.forCum);
      const a = BigInt(b.againstCum);
      if (f > peak) peak = f;
      if (a > peak) peak = a;
    }
    if (peak === 0n) {
      return {
        forBars: new Array(momentum.buckets.length).fill(0) as number[],
        againstBars: new Array(momentum.buckets.length).fill(0) as number[],
        peak: 0,
      };
    }
    // BigInt → 0..100 percent via the `* 1000n / peak` trick to keep
    // precision on u128 supplies, then back to number for CSS.
    const forBars = momentum.buckets.map((b) => Number((BigInt(b.forCum) * 1000n) / peak) / 10);
    const againstBars = momentum.buckets.map(
      (b) => Number((BigInt(b.againstCum) * 1000n) / peak) / 10,
    );
    return { forBars, againstBars, peak: Number(peak > 1_000_000_000n ? 1 : peak) };
  }, [momentum]);

  const noSignal =
    !isLoading && (momentum === undefined || (momentum.resolved === 0 && momentum.pending === 0));

  // iter-10: tap-to-pin. The hover tooltip on the strip explains what
  // the sparkline shows in aggregate; clicking a bucket pins its precise
  // For/Against readout into the header so an operator can compare
  // adjacent buckets without holding the cursor steady. Mirrors the
  // Equity bonding-curve tap-to-pin pattern.
  const [pinnedBucketIndex, setPinnedBucketIndex] = useState<number | null>(null);
  // Pinned readout becomes stale if the underlying bucket count shifts
  // (the proposal account itself is immutable, but a fresh momentum
  // resolve can mean the previously-pinned bucket no longer exists). We
  // clear the pin when the index falls out of range.
  const bucketsLen = momentum?.buckets.length ?? MOMENTUM_BUCKETS;
  const effectivePinnedIndex =
    pinnedBucketIndex !== null && pinnedBucketIndex < bucketsLen ? pinnedBucketIndex : null;
  const togglePin = (i: number) => {
    setPinnedBucketIndex((prev) => (prev === i ? null : i));
  };

  const forecastNode = renderForecastPill(forecast);
  const pinReadout =
    effectivePinnedIndex !== null ? formatPinnedBucket(momentum, effectivePinnedIndex) : null;

  // Tooltip caption — explains what the sparkline shows AND what slice
  // of the vote record set we successfully time-attributed.
  const caption = (() => {
    if (isLoading) return "Resolving vote timestamps from chain…";
    if (!momentum) return "No vote timestamps available yet.";
    const total = momentum.resolved + momentum.pending;
    if (total === 0) return "No votes cast yet — sparkline is the floor.";
    if (momentum.pending === 0) return `Based on all ${momentum.resolved} cast votes.`;
    return `Based on ${momentum.resolved} of ${total} cast votes (others pending block-time backfill).`;
  })();

  // Decide which bar accepts the click — when there are no resolved
  // votes the bars are decorative (flat baseline) and clicking them
  // wouldn't show meaningful pinned data. Disable interaction in that
  // case so we don't paint a hover affordance that produces an empty
  // readout.
  const interactive = !noSignal && momentum !== undefined;

  return (
    <div className={styles.momentumStrip}>
      <div className={styles.momentumHeader}>
        <span className={styles.momentumLabel}>Momentum</span>
        <div className={styles.momentumHeaderRight}>
          {pinReadout ? (
            <span
              className={styles.momentumPinReadout}
              aria-live="polite"
              aria-label={`Pinned bucket: ${pinReadout.label}`}
            >
              <span className={styles.momentumPinTime}>{pinReadout.label}</span>
              <span className={styles.momentumPinFor} data-tone="for">
                For {pinReadout.forPct}%
              </span>
              <span className={styles.momentumPinAgainst} data-tone="against">
                Against {pinReadout.againstPct}%
              </span>
              <ChipClose
                className={styles.momentumPinClear}
                onClick={() => setPinnedBucketIndex(null)}
                label="Clear pinned bucket"
              />
            </span>
          ) : null}
          {forecastNode}
        </div>
      </div>
      <Tooltip content={caption}>
        <div className={styles.momentumTracks} aria-label={caption}>
          {/* `For` track grows upward from the midline. */}
          <div className={styles.momentumTrack} data-tone="for" aria-hidden="true">
            {forBars.map((pct, i) => (
              <span
                key={`for-${i}`}
                className={styles.momentumBar}
                data-tone="for"
                data-empty={pct < 1 ? "true" : "false"}
                data-pinned={effectivePinnedIndex === i ? "true" : "false"}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={interactive ? `Pin bucket ${i + 1} of ${forBars.length}` : undefined}
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation();
                        togglePin(i);
                      }
                    : undefined
                }
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          togglePin(i);
                        }
                      }
                    : undefined
                }
                style={{ "--momentum-h": `${Math.max(pct, 2)}%` } as React.CSSProperties}
              />
            ))}
          </div>
          {/* `Against` track grows downward from the midline. */}
          <div className={styles.momentumTrack} data-tone="against" aria-hidden="true">
            {againstBars.map((pct, i) => (
              <span
                key={`against-${i}`}
                className={styles.momentumBar}
                data-tone="against"
                data-empty={pct < 1 ? "true" : "false"}
                data-pinned={effectivePinnedIndex === i ? "true" : "false"}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-label={
                  interactive ? `Pin bucket ${i + 1} of ${againstBars.length}` : undefined
                }
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation();
                        togglePin(i);
                      }
                    : undefined
                }
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          togglePin(i);
                        }
                      }
                    : undefined
                }
                style={{ "--momentum-h": `${Math.max(pct, 2)}%` } as React.CSSProperties}
              />
            ))}
          </div>
        </div>
      </Tooltip>
      {noSignal ? (
        <span className={styles.momentumFootnote}>
          No vote timestamps resolved yet — momentum will populate as the RPC backfills.
        </span>
      ) : null}
      {interactive ? (
        <span className={styles.momentumFootnote}>
          Tap a bar to pin its readout. {effectivePinnedIndex !== null ? "Tap again to clear." : ""}
        </span>
      ) : null}
      {/* Hidden but accessible: total tally peak used for the normalize.
          This keeps the strip self-describing under screen-reader review. */}
      <span className={styles.srOnly}>
        Sparkline normalized against the peak cumulative weight, currently {peak}.
      </span>
    </div>
  );
}

/**
 * Format a pinned bucket's For/Against ratio + bucket-start timestamp
 * for the inline readout. Uses BigInt math against the cumulative
 * counts so the percentages stay accurate on u128-scale supplies.
 */
function formatPinnedBucket(
  momentum: ProposalMomentum | undefined,
  i: number,
): { label: string; forPct: number; againstPct: number } | null {
  if (!momentum || i < 0 || i >= momentum.buckets.length) return null;
  const bucket = momentum.buckets[i];
  const forCum = BigInt(bucket.forCum);
  const againstCum = BigInt(bucket.againstCum);
  const sum = forCum + againstCum;
  if (sum === 0n) {
    return { label: formatTimestamp(bucket.t), forPct: 0, againstPct: 0 };
  }
  const forPct = Math.round(Number((forCum * 10000n) / sum) / 100);
  const againstPct = Math.max(0, 100 - forPct);
  return { label: formatTimestamp(bucket.t), forPct, againstPct };
}

/**
 * Render the verdict pill — a small chip that reads "Trending: pass" /
 * "Trending: fail" / hides on `unknown`. The confidence ratio drives the
 * opacity tier so an early-window forecast is visibly tentative compared
 * to a late-window one.
 */
function renderForecastPill(forecast: ReturnType<typeof projectMomentumForecast>): React.ReactNode {
  if (forecast.verdict === "unknown") return null;
  const verdictLabel = forecast.verdict === "would_pass" ? "Trending pass" : "Trending fail";
  const verdictTone = forecast.verdict === "would_pass" ? "done" : "defeated";
  const projectedPct = Math.round(forecast.projectedForShare * 100);
  const supportPct = Math.round(forecast.supportShare * 100);
  // Three confidence tiers map to data attributes the CSS uses to fade
  // the pill — low (early), medium (mid-window), strong (late).
  const tier: "low" | "medium" | "strong" =
    forecast.confidence < 0.25 ? "low" : forecast.confidence < 0.6 ? "medium" : "strong";
  const caption =
    forecast.verdict === "would_pass"
      ? `If the current trajectory holds: For ${projectedPct}% ≥ support ${supportPct}% at vote-end. ${Math.round(
          forecast.confidence * 100,
        )}% of the window elapsed.`
      : `If the current trajectory holds: For ${projectedPct}% < support ${supportPct}% at vote-end. ${Math.round(
          forecast.confidence * 100,
        )}% of the window elapsed.`;
  return (
    <Tooltip content={caption}>
      <span
        className={styles.momentumVerdict}
        data-tone={verdictTone}
        data-tier={tier}
        aria-label={caption}
      >
        {verdictLabel}
      </span>
    </Tooltip>
  );
}
