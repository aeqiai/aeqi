/**
 * Quorum surface — recent-activity ticker.
 *
 * Iter-6 affordance: a single-line "what just happened" row that sits
 * directly under the KPI strip on a TRUST that already has activity. It
 * surfaces the last N proposal lifecycle events (proposed / succeeded /
 * executed / canceled) with relative timestamps, so an operator dropping
 * onto the page mid-day immediately sees whether anything moved since
 * they last looked — without scanning every row's status badge.
 *
 * Honest scope: the on-chain VoteRecord struct does not carry a
 * timestamp, so per-vote "Alice voted For 5m ago" entries are out of
 * scope until the indexer ships event-stream backing. Proposal-level
 * timestamps (`voteStart`, `succeededAt`, derived executedAt via
 * `succeededAt + executionDelay`) are canonical on-chain and drive every
 * row here.
 *
 * No new tokens — the ticker paints through the canonical
 * `--quorum-accent-*` family already declared in the module CSS.
 */
import { useMemo } from "react";

import type { ProposalWithPda } from "@/solana";
import { Inline } from "@/components/ui";
import styles from "./QuorumPage.module.css";
import { bytesToHex, formatTimestamp, relativeTimeLabel, shortBytes32 } from "./QuorumPage.format";

type TickerKind = "proposed" | "succeeded" | "executed" | "canceled";

interface TickerEntry {
  kind: TickerKind;
  proposalId: Uint8Array | number[];
  /**
   * Unix-seconds timestamp the event fired. `null` means we couldn't
   * derive one (e.g. a canceled proposal — the IDL has no canceled_at
   * field). Entries with null timestamps sort to the tail.
   */
  timestamp: number | null;
}

const MAX_ENTRIES = 6;
const TICKER_TONE: Record<TickerKind, "in_progress" | "in_review" | "done" | "neutral"> = {
  proposed: "in_review",
  succeeded: "done",
  executed: "done",
  canceled: "neutral",
};

const TICKER_VERB: Record<TickerKind, string> = {
  proposed: "Proposed",
  succeeded: "Succeeded",
  executed: "Executed",
  canceled: "Canceled",
};

/**
 * Walk every proposal once and emit canonical lifecycle events as ticker
 * entries. The on-chain primitives we have:
 *
 *   - `voteStart` (i64): when the proposal opened. Always present.
 *   - `succeededAt` (i64): set when execute_proposal runs and quorum +
 *     support pass. Zero means "still pending or defeated".
 *   - `executed` (bool) + `executionDelay` (i64): an executed proposal
 *     fired its ix at `succeededAt + executionDelay` at earliest.
 *   - `canceled` (bool): no associated timestamp on-chain.
 *
 * Each proposal can emit 1-3 entries (proposed + succeeded + executed),
 * which is the honest read of what happened. Canceled emits a single
 * tail entry (no timestamp).
 */
function buildEntries(proposals: ProposalWithPda[]): TickerEntry[] {
  const out: TickerEntry[] = [];
  for (const p of proposals) {
    const acct = p.account;
    const voteStart = Number(acct.voteStart.toString());
    if (Number.isFinite(voteStart) && voteStart > 0) {
      out.push({ kind: "proposed", proposalId: acct.proposalId, timestamp: voteStart });
    }
    const succeededAt = Number(acct.succeededAt.toString());
    if (Number.isFinite(succeededAt) && succeededAt > 0) {
      out.push({ kind: "succeeded", proposalId: acct.proposalId, timestamp: succeededAt });
    }
    if (acct.executed) {
      const execDelay = Number(acct.executionDelay.toString());
      // executed-at is bounded BELOW by succeededAt + execDelay. We don&apos;t
      // have a separate executed_at field on the canonical IDL, so use
      // the earliest plausible moment. The ticker label reads "Executed"
      // either way; the timestamp is illustrative for ordering.
      const ts =
        Number.isFinite(succeededAt) && Number.isFinite(execDelay) && succeededAt > 0
          ? succeededAt + execDelay
          : null;
      out.push({ kind: "executed", proposalId: acct.proposalId, timestamp: ts });
    }
    if (acct.canceled) {
      // The IDL has no canceled_at — emit without a timestamp; the row
      // sorts to the tail and renders the absolute time as "—".
      out.push({ kind: "canceled", proposalId: acct.proposalId, timestamp: null });
    }
  }
  return out;
}

/**
 * Recent-activity ticker — renders the top {@link MAX_ENTRIES} most-
 * recent lifecycle events. Sorts by timestamp DESC; timeless entries
 * (canceled) drop to the tail. Returns `null` (collapses gracefully)
 * when nothing has happened on this TRUST yet — the caller chooses
 * whether to render a wrapper or omit the strip entirely.
 */
export function ActivityTicker({
  proposals,
  nowSeconds,
}: {
  proposals: ProposalWithPda[];
  /** Cluster-now in unix seconds. Pass the same value used by row countdowns. */
  nowSeconds: number;
}) {
  const entries = useMemo(() => {
    const all = buildEntries(proposals);
    all.sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return 0;
      if (a.timestamp === null) return 1;
      if (b.timestamp === null) return -1;
      return b.timestamp - a.timestamp;
    });
    return all.slice(0, MAX_ENTRIES);
  }, [proposals]);

  if (entries.length === 0) return null;

  return (
    <div
      className={`${styles.scope} ${styles.activityTicker}`}
      role="region"
      aria-label="Recent governance activity"
    >
      <span className={styles.activityLabel}>Recent activity</span>
      <Inline gap="3" wrap>
        {entries.map((entry, idx) => (
          <TickerItem
            key={`${entry.kind}-${bytesToHex(entry.proposalId)}-${idx}`}
            entry={entry}
            nowSeconds={nowSeconds}
          />
        ))}
      </Inline>
    </div>
  );
}

function TickerItem({ entry, nowSeconds }: { entry: TickerEntry; nowSeconds: number }) {
  const tone = TICKER_TONE[entry.kind];
  const verb = TICKER_VERB[entry.kind];
  const idLabel = shortBytes32(entry.proposalId);
  const relative = entry.timestamp !== null ? relativeTimeLabel(entry.timestamp, nowSeconds) : null;
  const absolute = entry.timestamp !== null ? formatTimestamp(entry.timestamp) : null;
  const tooltip = absolute ? `${verb} · ${absolute}` : verb;
  return (
    <span className={styles.activityItem} title={tooltip} aria-label={tooltip}>
      <span className={styles.activityDot} data-tone={tone} aria-hidden="true" />
      <span className={styles.activityVerb}>{verb}</span>
      <span className={styles.activityId}>{idLabel}</span>
      <span className={styles.activityWhen}>{relative ?? "—"}</span>
    </span>
  );
}
