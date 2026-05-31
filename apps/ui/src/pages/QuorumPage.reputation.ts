/**
 * Quorum surface — proposer reputation aggregation helpers.
 *
 * Extracted from `QuorumPage.write.tsx` so the iter-8 table-row hover
 * preview can reuse the same predicate logic as the detail-modal glyph.
 * Keeping the math in one place means the two surfaces can't drift —
 * a "67% success" rate on the table row always matches the value the
 * detail modal shows for the same proposer.
 *
 * The math is intentionally tied to local on-chain fields (executed,
 * canceled, succeededAt, voteStart, voteDuration) so it stays in sync
 * with `deriveProposalStatus` without forming an import cycle through
 * `parts.tsx` / `write.tsx`.
 */
import type { ProposalAccount, ProposalWithPda } from "@/solana";

export interface ProposerReputation {
  total: number;
  settled: number;
  succeeded: number;
  successRate: number | null;
}

/**
 * Aggregate stats for a proposer on a COMPANY. Walks every proposal once
 * and counts settled outcomes only — active/pending proposals don't
 * shift the success rate because they haven't resolved yet.
 */
export function computeProposerReputation(
  proposer: string,
  proposals: ProposalWithPda[],
  nowSeconds: number,
): ProposerReputation {
  let total = 0;
  let settled = 0;
  let succeeded = 0;
  for (const p of proposals) {
    if (p.account.proposer.toBase58() !== proposer) continue;
    total += 1;
    const isExecuted = p.account.executed;
    const isCanceled = p.account.canceled;
    const succeededAt = Number(p.account.succeededAt.toString());
    const voteEnd =
      Number(p.account.voteStart.toString()) + Number(p.account.voteDuration.toString());
    const voteClosed = Number.isFinite(voteEnd) && nowSeconds >= voteEnd;
    if (isExecuted || isCanceled || voteClosed) {
      settled += 1;
      if (isExecuted || (succeededAt > 0 && !isCanceled)) {
        succeeded += 1;
      }
    }
  }
  const successRate = settled > 0 ? succeeded / settled : null;
  return { total, settled, succeeded, successRate };
}

export interface RecentProposalSummary {
  id: string;
  idShort: string;
  tone: "in_progress" | "in_review" | "done" | "defeated" | "canceled";
  label: string;
}

const TONE_AND_LABEL_BY_STATE: Record<
  "active" | "pending" | "succeeded" | "defeated" | "executed" | "canceled",
  { tone: RecentProposalSummary["tone"]; label: string }
> = {
  active: { tone: "in_progress", label: "Active" },
  pending: { tone: "in_review", label: "Pending" },
  succeeded: { tone: "done", label: "Succeeded" },
  defeated: { tone: "defeated", label: "Defeated" },
  executed: { tone: "done", label: "Executed" },
  canceled: { tone: "canceled", label: "Canceled" },
};

export function recentProposalsBy(
  proposer: string,
  proposals: ProposalWithPda[],
  nowSeconds: number,
  limit: number,
): RecentProposalSummary[] {
  const owned = proposals.filter((p) => p.account.proposer.toBase58() === proposer);
  owned.sort(
    (a, b) => Number(b.account.voteStart.toString()) - Number(a.account.voteStart.toString()),
  );
  const slice = owned.slice(0, limit);
  return slice.map((p) => {
    const idHex = bytesToHexFromAccount(p.account.proposalId);
    const state = deriveLifecycleStateLocal(p.account, nowSeconds);
    const meta = TONE_AND_LABEL_BY_STATE[state];
    return {
      id: `0x${idHex}`,
      idShort: shortHexId(idHex),
      tone: meta.tone,
      label: meta.label,
    };
  });
}

/** Tone hint for the table-row proposer glyph. We surface the same
 *  lifecycle accent family used elsewhere on the page so the visual
 *  language stays coherent: `done` (jade) on healthy proposers, `in_review`
 *  (warmth) on mixed, `defeated` (muted) on poor / unsettled cohorts. */
export function reputationToneForGlyph(
  reputation: ProposerReputation,
): "done" | "in_review" | "defeated" | null {
  if (reputation.total === 0) return null;
  if (reputation.successRate === null) return "defeated";
  return Math.round(reputation.successRate * 100) >= 50 ? "done" : "in_review";
}

function bytesToHexFromAccount(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

function shortHexId(hex: string): string {
  if (hex.length <= 12) return `0x${hex}`;
  return `0x${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

function deriveLifecycleStateLocal(
  account: ProposalAccount,
  nowSeconds: number,
): "active" | "pending" | "succeeded" | "defeated" | "executed" | "canceled" {
  if (account.executed) return "executed";
  if (account.canceled) return "canceled";
  const voteStart = Number(account.voteStart.toString());
  const voteDuration = Number(account.voteDuration.toString());
  const voteEnd = voteStart + voteDuration;
  if (nowSeconds < voteStart) return "pending";
  if (nowSeconds <= voteEnd) return "active";
  const forVotes = BigInt(account.forVotes.toString());
  const againstVotes = BigInt(account.againstVotes.toString());
  return forVotes > againstVotes ? "succeeded" : "defeated";
}
