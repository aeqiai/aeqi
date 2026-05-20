/**
 * Quorum surface — KPI strip + helpers.
 *
 * Extracted from `QuorumPage.parts.tsx` to keep both files under the
 * 600-line lint cap as iter-5 added the voter-turnout tile + sparkline.
 *
 * Owns:
 *   - `KpiTile` / `KpiGrid` — the lifecycle-tinted tile primitive used by
 *     the four-up strip above the proposals table.
 *   - `KpiSparkline` — the four-bar micro-chart that hangs under the
 *     turnout tile's value.
 *   - `KpiStrip` — the canonical strip composition. Computes turnout
 *     from `voteRecords` against the rolling 30d window.
 *
 * No new tokens, no new chart deps — everything paints through the
 * canonical `--quorum-accent-*` family already declared in the module
 * css, and the sparkline is plain CSS bars.
 */
import { useMemo } from "react";

import { deriveProposalStatus } from "@/solana";
import type { GovernanceConfigWithPda, ProposalWithPda, VoteRecordWithPda } from "@/solana";
import { formatInteger } from "@/lib/i18n";
import styles from "./QuorumPage.module.css";

/* ────────────────────────────────────────────────────────────────── */
/* KPI tile primitives                                                 */
/* ────────────────────────────────────────────────────────────────── */

export interface KpiTileProps {
  label: string;
  value: number;
  tone: "in_progress" | "in_review" | "done" | "neutral";
  hint?: string;
  /**
   * Optional micro-sparkline rendered below the value. Each entry is a
   * normalized bucket count; the tile draws four small bars from oldest
   * (left) to newest (right). Used by the "Voter turnout (30d)" tile so
   * an operator can see whether participation is trending up or down
   * without leaving the page header.
   */
  sparkline?: number[];
}

/**
 * Headline KPI tile — used for the four-up Governance health strip
 * above the configs table. Tone drives the inset accent rail per the
 * canonical lifecycle family.
 */
export function KpiTile({ label, value, tone, hint, sparkline }: KpiTileProps) {
  return (
    <div className={`${styles.scope} ${styles.kpiTile}`} data-tone={tone}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{formatInteger(value)}</span>
      {sparkline && sparkline.length > 0 ? <KpiSparkline buckets={sparkline} tone={tone} /> : null}
      {hint ? <span className={styles.kpiHint}>{hint}</span> : null}
    </div>
  );
}

/**
 * Four tiny bars from oldest → newest, height scaled to the max bucket.
 * Pure CSS bars — no SVG, no charting library, no new tokens. Tone maps
 * onto the same lifecycle-accent variables the rest of the strip uses.
 */
function KpiSparkline({
  buckets,
  tone,
}: {
  buckets: number[];
  tone: "in_progress" | "in_review" | "done" | "neutral";
}) {
  const max = Math.max(1, ...buckets);
  return (
    <div className={styles.kpiSparkline} aria-hidden="true" data-tone={tone}>
      {buckets.map((b, i) => {
        const pct = Math.max(8, Math.round((b / max) * 100));
        const vars = { "--bar-height": `${pct}%` } as Record<string, string>;
        return (
          <span
            key={i}
            className={styles.kpiSparkBar}
            style={vars as React.CSSProperties}
            data-empty={b === 0 ? "true" : undefined}
          />
        );
      })}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.kpiGrid}>{children}</div>;
}

/* ────────────────────────────────────────────────────────────────── */
/* KPI strip composition + turnout aggregation                          */
/* ────────────────────────────────────────────────────────────────── */

const SECONDS_PER_DAY = 86_400;
const TURNOUT_WINDOW_DAYS = 30;
const TURNOUT_WINDOW_SECONDS = TURNOUT_WINDOW_DAYS * SECONDS_PER_DAY;
const TURNOUT_BUCKETS = 4;

/**
 * KPI strip — four tiles above the proposals table. Headline cohorts:
 *
 *   - Active / Pending / Executed — counted off the derived status of
 *     each Proposal at the current cluster clock.
 *   - Voter turnout (30d) — unique voters across vote records whose
 *     proposal opened in the last 30 days. Sparkline below the value
 *     plots the weekly bucket count so an operator can see the trend
 *     without leaving the page header.
 *
 * `voteRecords` is optional — when it isn't supplied (e.g. an older
 * caller before the iter-5 wiring) the tile falls back to a `Configs`
 * count so the grid stays four-wide.
 */
export function KpiStrip({
  proposals,
  configs,
  voteRecords,
}: {
  proposals: ProposalWithPda[];
  configs: GovernanceConfigWithPda[];
  voteRecords?: VoteRecordWithPda[];
}) {
  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), []);
  const tally = useMemo(() => {
    let active = 0;
    let pending = 0;
    let executed = 0;
    for (const p of proposals) {
      const status = deriveProposalStatus(p.account, nowSeconds);
      if (status === "active") active += 1;
      else if (status === "pending") pending += 1;
      else if (status === "executed") executed += 1;
    }
    return { active, pending, executed };
  }, [proposals, nowSeconds]);

  // Turnout: walk the proposals once to find the in-window ones, then
  // walk vote records once and join by proposalId. Each side is O(n);
  // joining via a Set<string> avoids a quadratic inner loop. Unique
  // voters are counted across all in-window proposals (a voter who hit
  // 3 active votes counts once, not three times).
  const turnout = useMemo(() => {
    if (!voteRecords || voteRecords.length === 0) {
      return { uniqueVoters: 0, buckets: [0, 0, 0, 0] as number[], totalVotes: 0 };
    }
    const cutoff = nowSeconds - TURNOUT_WINDOW_SECONDS;
    const inWindowProposalIds = new Set<string>();
    for (const p of proposals) {
      const start = Number(p.account.voteStart.toString());
      if (Number.isFinite(start) && start >= cutoff) {
        inWindowProposalIds.add(proposalIdKey(p.account.proposalId));
      }
    }
    const uniqueVoterSet = new Set<string>();
    let totalVotes = 0;
    const buckets = new Array<number>(TURNOUT_BUCKETS).fill(0);
    const bucketSpan = Math.floor(TURNOUT_WINDOW_SECONDS / TURNOUT_BUCKETS);
    const seenByBucket: Array<Set<string>> = Array.from(
      { length: TURNOUT_BUCKETS },
      () => new Set<string>(),
    );
    const proposalIdToStart = new Map<string, number>();
    for (const p of proposals) {
      proposalIdToStart.set(
        proposalIdKey(p.account.proposalId),
        Number(p.account.voteStart.toString()),
      );
    }
    for (const rec of voteRecords) {
      const pid = proposalIdKey(rec.account.proposalId);
      if (!inWindowProposalIds.has(pid)) continue;
      const voter = rec.account.voter.toBase58();
      uniqueVoterSet.add(voter);
      totalVotes += 1;
      const start = proposalIdToStart.get(pid);
      if (typeof start === "number" && Number.isFinite(start)) {
        const offset = nowSeconds - start;
        let idx = TURNOUT_BUCKETS - 1 - Math.floor(offset / bucketSpan);
        if (idx < 0) idx = 0;
        if (idx > TURNOUT_BUCKETS - 1) idx = TURNOUT_BUCKETS - 1;
        const seen = seenByBucket[idx];
        if (!seen.has(voter)) {
          seen.add(voter);
          buckets[idx] += 1;
        }
      }
    }
    return { uniqueVoters: uniqueVoterSet.size, buckets, totalVotes };
  }, [proposals, voteRecords, nowSeconds]);

  const turnoutHint = useMemo(() => {
    if (turnout.uniqueVoters === 0) return "no votes 30d";
    return `${turnout.totalVotes} votes 30d`;
  }, [turnout]);

  return (
    <KpiGrid>
      <KpiTile
        label="Active"
        value={tally.active}
        tone="in_progress"
        hint={tally.active === 0 ? "no live votes" : "in vote window"}
      />
      <KpiTile
        label="Pending"
        value={tally.pending}
        tone="in_review"
        hint={tally.pending === 0 ? "none queued" : "pre-vote"}
      />
      <KpiTile
        label="Executed"
        value={tally.executed}
        tone="done"
        hint={tally.executed === 0 ? "none settled" : "lifetime"}
      />
      {voteRecords ? (
        <KpiTile
          label="Voter turnout"
          value={turnout.uniqueVoters}
          tone="neutral"
          hint={turnoutHint}
          sparkline={turnout.buckets}
        />
      ) : (
        <KpiTile
          label="Configs"
          value={configs.length}
          tone="neutral"
          hint={configs.length === 1 ? "voting mode" : "voting modes"}
        />
      )}
    </KpiGrid>
  );
}

/**
 * Cheap stable key for a 32-byte proposalId — needed because we can't
 * use a `Uint8Array | number[]` as a `Set` key directly. Hex is the
 * canonical handshake elsewhere on the page.
 */
function proposalIdKey(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}
