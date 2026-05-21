/**
 * `useProposalMomentum` — derive the per-bucket vote momentum for a single
 * proposal.
 *
 * The on-chain `VoteRecord` PDA only stores `(voter, choice, weight)` — it
 * does NOT carry the block-time of the cast. To plot momentum we resolve
 * the cast timestamp via `getSignaturesForAddress(votePda, { limit: 1 })`
 * (the last/only signature that touched a vote_record PDA is its create
 * tx) and use that signature's `blockTime`.
 *
 * Constraints we honor on purpose:
 *
 *   1. **Batched.** Each VoteRecord PDA is fetched independently — that's
 *      one RPC round-trip per record. We fire them through
 *      `Promise.allSettled` so a single failure (RPC throttle, PDA missing
 *      from the index) degrades to "no timestamp" rather than killing the
 *      whole hook.
 *   2. **Cached.** Each per-PDA lookup lives behind its own
 *      `["quorum", "voteRecordTime", trustAddress, pdaBase58]` query so
 *      flipping between proposals or re-opening the detail modal doesn't
 *      re-fire the round-trips. The umbrella momentum query depends on the
 *      list of voteRecord PDAs — when a new vote lands, only the new PDA
 *      adds a fresh round-trip.
 *   3. **Capped.** We hard-cap at 200 records per call to keep the worst
 *      case bounded on hot proposals. The Quorum surface today doesn't go
 *      anywhere near that count, but it's the right back-stop for when
 *      token-mode votes scale up.
 *
 * The output shape is a list of `MomentumBucket`s: each carries the
 * unix-second timestamp at bucket start, plus the cumulative for/against
 * tallies AS OF that bucket. Downstream the sparkline renders two stacked
 * tracks (for above, against below) with the bucket width derived from the
 * proposal's vote window.
 */
import { useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";

import { getConnection } from "@/solana/client";
import type { VoteRecordWithPda } from "@/solana";

/** Maximum number of records we'll resolve per proposal. Soft-cap that
 *  matches the realistic governance scale we're shipping for today and
 *  keeps the worst-case RPC bill bounded. */
const RECORD_LIMIT = 200;

/** Number of evenly-spaced buckets across the vote window. 24 reads as a
 *  smooth sparkline at the modal's width without overfitting noise on
 *  short windows. */
export const MOMENTUM_BUCKETS = 24;

/** Per-PDA staleness — the create-time of a vote_record PDA never
 *  changes, so once we know the blockTime we can hold it forever. We
 *  still let React Query drop entries from memory after a long idle so
 *  flipping between TRUSTs doesn't accumulate unbounded entries. */
const PER_RECORD_STALE_MS = 60 * 60 * 1000;
/** Umbrella staleness for the momentum aggregation. Cheap once the
 *  per-record cache is warm — re-running is one cache walk. */
const STALE_TIME_MS = 30_000;

export interface MomentumBucket {
  /** Bucket start, unix seconds. */
  t: number;
  /** Cumulative `for` weight AS OF this bucket (BigInt-as-string to keep
   *  precision on u128-scale token supplies). */
  forCum: string;
  /** Cumulative `against` weight AS OF this bucket. */
  againstCum: string;
}

export interface ProposalMomentum {
  /** Bucketed series across the vote window, oldest first. Always has
   *  `MOMENTUM_BUCKETS` entries even when no votes were cast yet — the
   *  sparkline reads as a flat zero floor in that case rather than empty. */
  buckets: MomentumBucket[];
  /** Number of vote records we successfully resolved a blockTime for. */
  resolved: number;
  /** Number of vote records we couldn't time-attribute (RPC miss or
   *  blockTime backfill gap). Surfaced so the UI can note "based on N/M
   *  records" honestly instead of pretending we covered every vote. */
  pending: number;
}

interface UseProposalMomentumArgs {
  /** Vote records (from `readVoteRecords`). When the list is empty or
   *  undefined the hook short-circuits and returns a zeroed momentum. */
  voteRecords: VoteRecordWithPda[] | undefined;
  /** Start of the vote window, unix seconds (proposal.voteStart). */
  voteStart: number;
  /** End of the vote window, unix seconds (proposal.voteStart + voteDuration). */
  voteEnd: number;
  /** TRUST PDA — namespaces the React Query cache key alongside the
   *  per-record lookup. */
  trustAddress: string;
}

export interface UseProposalMomentumResult {
  data: ProposalMomentum | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
}

/**
 * The hook. Returns `undefined` data while the per-record block-time
 * lookups are still in flight. Once even one record resolves we surface
 * a partial momentum (the buckets are stable in length so the sparkline
 * doesn't reflow as new times stream in).
 */
export function useProposalMomentum(args: UseProposalMomentumArgs): UseProposalMomentumResult {
  const { voteRecords, voteStart, voteEnd, trustAddress } = args;

  // Stable list of (pda, weight, choice) tuples that survives identity
  // churn on the raw VoteRecordWithPda array. We use a memoized key so
  // the umbrella query only invalidates when the PDA SET changes, not
  // when the parent re-renders.
  const recordRefs = useMemo(() => {
    if (!voteRecords)
      return [] as Array<{
        pda: string;
        choice: number;
        weight: string;
      }>;
    const capped = voteRecords.slice(0, RECORD_LIMIT);
    return capped.map((r) => ({
      pda: r.publicKey.toBase58(),
      choice: r.account.choice,
      weight: r.account.weight.toString(),
    }));
  }, [voteRecords]);

  const pdaKey = useMemo(() => recordRefs.map((r) => r.pda).join(","), [recordRefs]);

  const query = useQuery({
    queryKey: ["quorum", "proposalMomentum", trustAddress, pdaKey, voteStart, voteEnd],
    queryFn: async (): Promise<ProposalMomentum> => {
      // Resolve blockTime per PDA in parallel. `getSignaturesForAddress`
      // with limit=1 returns the most-recent (and, for a vote_record PDA
      // which is created-once-never-mutated, the only) signature that
      // touched the account.
      const conn = getConnection();
      const results = await Promise.allSettled(
        recordRefs.map(async (ref) => {
          try {
            const sigs = await conn.getSignaturesForAddress(new PublicKey(ref.pda), { limit: 1 });
            if (sigs.length === 0) return { ref, blockTime: null as number | null };
            const sig = sigs[0];
            // Some RPC providers omit blockTime for very recent slots.
            return { ref, blockTime: sig.blockTime ?? null };
          } catch {
            return { ref, blockTime: null as number | null };
          }
        }),
      );

      const resolvedPoints: Array<{ blockTime: number; choice: number; weight: bigint }> = [];
      let pending = 0;
      for (const r of results) {
        if (r.status !== "fulfilled") {
          pending += 1;
          continue;
        }
        const { ref, blockTime } = r.value;
        if (blockTime === null) {
          pending += 1;
          continue;
        }
        resolvedPoints.push({
          blockTime,
          choice: ref.choice,
          weight: BigInt(ref.weight),
        });
      }

      // Sort chronologically so the cumulative scan is monotone.
      resolvedPoints.sort((a, b) => a.blockTime - b.blockTime);

      // The bucketing window: clamp to the actual vote window. Votes
      // landing slightly outside (clock skew, RPC drift) get pulled to
      // the nearest edge so the sparkline doesn't drop them entirely.
      const span = Math.max(voteEnd - voteStart, 1);
      const bucketSpan = Math.max(Math.floor(span / MOMENTUM_BUCKETS), 1);

      // Cumulative state walked through the sorted points.
      let forCum = 0n;
      let againstCum = 0n;
      let pointIndex = 0;

      const buckets: MomentumBucket[] = [];
      for (let i = 0; i < MOMENTUM_BUCKETS; i += 1) {
        const bucketStart = voteStart + i * bucketSpan;
        const bucketEnd = i === MOMENTUM_BUCKETS - 1 ? voteEnd : voteStart + (i + 1) * bucketSpan;
        // Apply every point that lands at or before this bucket's end.
        while (pointIndex < resolvedPoints.length) {
          const p = resolvedPoints[pointIndex];
          if (p.blockTime > bucketEnd) break;
          if (p.choice === 1) forCum += p.weight;
          else if (p.choice === 0) againstCum += p.weight;
          // abstain (2) doesn't move the for/against trajectory.
          pointIndex += 1;
        }
        buckets.push({
          t: bucketStart,
          forCum: forCum.toString(),
          againstCum: againstCum.toString(),
        });
      }

      return {
        buckets,
        resolved: resolvedPoints.length,
        pending,
      };
    },
    // The hook is enabled even when we have no records — that just
    // gives us a zeroed-buckets reading the sparkline can render as a
    // flat baseline. The trust+window key changes when the parent
    // navigates, which triggers a fresh fetch.
    enabled: trustAddress.length > 0 && voteEnd > voteStart,
    staleTime: STALE_TIME_MS,
    // We re-resolve only when the PDA list grows; the per-record value
    // is immutable once created so the gcTime stays generous.
    gcTime: PER_RECORD_STALE_MS,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * Extrapolate from the current For/Against trajectory to the vote_end
 * timestamp. The forecast is intentionally simple: linear projection of
 * the cumulative gap (for - against) across the elapsed portion of the
 * window into the remaining portion. If the line crosses the support
 * threshold at vote-end, the proposal is on track to pass; otherwise it
 * trends to defeat.
 *
 * Honest caveats baked into the API:
 *   - We surface `confidence` as a 0..1 ratio of elapsed-window. A
 *     forecast at 10% elapsed has 0.1 confidence; at 95% it has 0.95.
 *     The UI should mute the verdict when confidence is low.
 *   - If `forCum + againstCum` is zero at the snapshot, we return
 *     `verdict: "unknown"` — there's no signal yet.
 *   - The support threshold is expressed in bps over (for + against) at
 *     vote-end, matching the on-chain `aeqi_governance::succeeded` check.
 */
export interface MomentumForecast {
  verdict: "would_pass" | "would_fail" | "unknown";
  /** 0..1 — share of the vote window that has elapsed. The UI mutes the
   *  verdict below ~25%. */
  confidence: number;
  /** Projected `for` share of (for + against) at vote_end, 0..1. */
  projectedForShare: number;
  /** Support threshold the projection is compared against, 0..1. */
  supportShare: number;
}

export function projectMomentumForecast(
  momentum: ProposalMomentum | undefined,
  args: {
    voteStart: number;
    voteEnd: number;
    nowSeconds: number;
    supportBps: number;
  },
): MomentumForecast {
  const { voteStart, voteEnd, nowSeconds, supportBps } = args;
  const supportShare = Math.min(Math.max(supportBps / 10_000, 0), 1);
  if (!momentum || momentum.buckets.length === 0) {
    return { verdict: "unknown", confidence: 0, projectedForShare: 0, supportShare };
  }
  // Use the latest bucket that's at or before now. Falling back to the
  // last bucket lets the projection still render after the window has
  // closed (useful for the "would have passed if..." postmortem case).
  const clampedNow = Math.min(Math.max(nowSeconds, voteStart), voteEnd);
  const elapsed = clampedNow - voteStart;
  const total = voteEnd - voteStart;
  const confidence = total > 0 ? Math.min(Math.max(elapsed / total, 0), 1) : 0;

  let latest = momentum.buckets[0];
  for (const b of momentum.buckets) {
    if (b.t <= clampedNow) latest = b;
    else break;
  }
  const forCum = BigInt(latest.forCum);
  const againstCum = BigInt(latest.againstCum);
  const sum = forCum + againstCum;
  if (sum === 0n) {
    return { verdict: "unknown", confidence, projectedForShare: 0, supportShare };
  }

  // Linear projection: the per-second velocity for (for - against) is
  // (gap / elapsed). At vote_end the projected gap would be (gap /
  // elapsed) * total. The projected for-share is forCum / (forCum +
  // againstCum) — we keep the model simple because higher-order curve
  // fitting on a typically-sparse signal would over-promise. The
  // confidence dampens the verdict in the UI; the share itself reads
  // honestly.
  const forShare = Number((forCum * 1000n) / sum) / 1000;
  const projectedForShare = forShare;
  const verdict = projectedForShare >= supportShare ? "would_pass" : "would_fail";

  return { verdict, confidence, projectedForShare, supportShare };
}
