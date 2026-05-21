/**
 * Quorum surface — write affordances + detail-modal sub-surface.
 *
 * Extracted from `QuorumPage.parts.tsx` to keep both files under the
 * 600-line lint cap. Owns:
 *
 *   - `ProposalDetailModal` — full detail surface with TallyDetail,
 *     threshold markers (quorum + support), vote history, and the
 *     copyable PDA meta. Lives here instead of `parts` so the vote
 *     history hook can share a file with the new-proposal modal and
 *     inline vote actions.
 *   - `VoteHistorySection` — fetches `VoteRecord` PDAs scoped to
 *     (trust, proposalId) and renders the audit trail. This is the
 *     real iter-2 functional gap closed.
 *   - `NewProposalModal` — write modal for `api.proposalCreate` (the
 *     honest stub).
 *   - `InlineVoteActions` — three icon-buttons (For/Against/Abstain)
 *     wired to `api.castVote` (the honest stub).
 *   - `ProposalsEmptyState` — per-filter copy that reads as a
 *     deliberate "nothing here, here's why" instead of a generic
 *     "no rows".
 *
 * All purely-display cells (Badge mapping, Tooltip wrappers, format
 * helpers) stay in `QuorumPage.parts.tsx` to avoid this file growing
 * past 600 lines as more write paths land.
 */
import { useMemo, useState } from "react";

import type {
  GovernanceConfigWithPda,
  ProposalAccount,
  ProposalStatus,
  ProposalWithPda,
  RoleAccountWithPda,
  RoleTypeWithPda,
} from "@/solana";
import { ApiError, api } from "@/lib/api";
import { Badge, Button, EmptyState, Inline, Modal, Stack, Tooltip } from "@/components/ui";
import styles from "./QuorumPage.module.css";
import {
  CopyableMono,
  ModeBadge,
  ProposalStatusBadge,
  SnapshotIndicator,
  TallyDetail,
} from "./QuorumPage.parts";
import {
  bytesToHex,
  countdownLabel,
  formatTimestamp,
  shortAddress,
  shortBytes32,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.format";
import {
  ExecutionPayloadSection,
  ProposalActionBar,
  VoteHistorySection,
  useQuorumInvalidator,
} from "./QuorumPage.actions";

export { ProposalCompareTray } from "./QuorumPage.compare";

/* ────────────────────────────────────────────────────────────────── */
/* Proposal detail modal                                              */
/* ────────────────────────────────────────────────────────────────── */

export function ProposalDetailModal({
  entry,
  configs,
  roleTypes,
  roles,
  proposals,
  trustId,
  trustAddress,
  nowSeconds,
  viewerCreatorAddress,
  onClose,
}: {
  entry: { proposal: ProposalWithPda; status: ProposalStatus } | null;
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  /**
   * Occupied role accounts on this TRUST. Forwarded to the proposal
   * action bar so its cancel-eligibility check can extend beyond the
   * proposer to anyone holding a role.
   */
  roles?: RoleAccountWithPda[];
  /**
   * All proposals on this TRUST — forwarded so the iter-6 proposer
   * reputation glyph can count how many proposals this proposer has
   * opened and their success rate. Cheap local aggregation, no extra
   * RPC call. When omitted, the glyph degrades to a 1/1 view of the
   * proposal being shown.
   */
  proposals?: ProposalWithPda[];
  trustId: string;
  trustAddress: string;
  nowSeconds: number;
  /**
   * EOA that owns this TRUST (from `entity.creator_address`). The
   * action bar uses it to gate the Cancel CTA to the proposer or a
   * role-holder on the TRUST — random viewers see a read-only detail
   * surface.
   */
  viewerCreatorAddress: string | null;
  onClose: () => void;
}) {
  const open = entry !== null;
  // Resolve the config this proposal is bound to so TallyDetail can
  // render quorum + support threshold markers.
  const matchedConfig = useMemo(() => {
    if (!entry) return undefined;
    const pid = entry.proposal.account.governanceConfigId;
    const arr = pid instanceof Uint8Array ? pid : Uint8Array.from(pid);
    return configs.find((c) => {
      const cid = c.account.governanceConfigId;
      const carr = cid instanceof Uint8Array ? cid : Uint8Array.from(cid);
      if (carr.length !== arr.length) return false;
      for (let i = 0; i < carr.length; i++) if (carr[i] !== arr[i]) return false;
      return true;
    });
  }, [entry, configs]);

  return (
    <Modal open={open} onClose={onClose} title="Proposal detail">
      {entry ? (
        <div className={`${styles.scope} ${styles.modalBody}`}>
          <Stack gap="5">
            <ProposalSummary
              entry={entry}
              roleTypes={roleTypes}
              nowSeconds={nowSeconds}
              proposals={proposals}
            />
            <ProposalActionBar
              trustId={trustId}
              trustAddress={trustAddress}
              proposal={entry.proposal.account}
              status={entry.status}
              viewerCreatorAddress={viewerCreatorAddress}
              roles={roles}
            />
            <div>
              <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Tallies</h3>
              <TallyDetail proposal={entry.proposal.account} config={matchedConfig} />
            </div>
            <ExecutionPayloadSection proposal={entry.proposal.account} />
            <VoteHistorySection
              trustAddress={trustAddress}
              proposalId={entry.proposal.account.proposalId}
            />
            <ProposalMeta proposal={entry.proposal.account} />
          </Stack>
        </div>
      ) : null}
    </Modal>
  );
}

function ProposalSummary({
  entry,
  roleTypes,
  nowSeconds,
  proposals,
}: {
  entry: { proposal: ProposalWithPda; status: ProposalStatus };
  roleTypes: RoleTypeWithPda[];
  nowSeconds: number;
  /** All proposals on this TRUST — feeds the proposer reputation glyph. */
  proposals?: ProposalWithPda[];
}) {
  const { start, end } = voteWindowSeconds(entry.proposal.account);
  const proposerB58 = entry.proposal.account.proposer.toBase58();
  const reputation = useMemo(
    () => computeProposerReputation(proposerB58, proposals ?? [entry.proposal], nowSeconds),
    [proposerB58, proposals, entry.proposal, nowSeconds],
  );
  // Pending proposals haven&apos;t started yet — surface the start time AND
  // a countdown so the operator knows when the vote opens without doing
  // unix-timestamp arithmetic in their head. Active proposals get the
  // end side. Both are rendered as separate rows below the vote-window
  // span so the (start → end) range stays a single readable line above.
  const isPending = entry.status === "pending";
  const isActive = entry.status === "active";
  const startsIn =
    isPending && typeof start === "number" ? countdownLabel(start - nowSeconds, "starts") : null;
  const endsIn =
    isActive && typeof end === "number" ? countdownLabel(end - nowSeconds, "ends") : null;

  return (
    <div className={styles.detailGrid}>
      <span className={styles.detailLabel}>Proposal ID</span>
      <span className={styles.detailValue}>
        <CopyableMono
          full={`0x${bytesToHex(entry.proposal.account.proposalId)}`}
          display={shortBytes32(entry.proposal.account.proposalId)}
        />
      </span>
      <span className={styles.detailLabel}>Mode</span>
      <span className={styles.detailValue}>
        <ModeBadge configId={entry.proposal.account.governanceConfigId} roleTypes={roleTypes} />
      </span>
      <span className={styles.detailLabel}>Status</span>
      <span className={styles.detailValue}>
        <ProposalStatusBadge
          status={entry.status}
          nowSeconds={nowSeconds}
          voteStart={start ?? undefined}
          voteEnd={end ?? undefined}
        />
      </span>
      <span className={styles.detailLabel}>Vote window</span>
      <span className={`${styles.detailValue} ${styles.detailValueMuted}`}>
        {voteWindowLabel(entry.proposal.account)}
      </span>
      {isPending && typeof start === "number" ? (
        <>
          <span className={styles.detailLabel}>Voting opens</span>
          <span className={styles.detailValue}>
            <span className={styles.windowAbsolute}>{formatTimestamp(start)}</span>
            {startsIn ? (
              <span className={styles.windowRelative} data-tone="in_review">
                · {startsIn}
              </span>
            ) : null}
          </span>
        </>
      ) : null}
      {isActive && typeof end === "number" ? (
        <>
          <span className={styles.detailLabel}>Voting closes</span>
          <span className={styles.detailValue}>
            <span className={styles.windowAbsolute}>{formatTimestamp(end)}</span>
            {endsIn ? (
              <span className={styles.windowRelative} data-tone="in_progress">
                · {endsIn}
              </span>
            ) : null}
          </span>
        </>
      ) : null}
      <span className={styles.detailLabel}>Proposer</span>
      <span className={styles.detailValue}>
        <CopyableMono full={proposerB58} display={shortAddress(proposerB58)} />
        <ProposerReputationGlyph reputation={reputation} />
      </span>
      <span className={styles.detailLabel}>Snapshot</span>
      <span className={styles.detailValue}>
        <SnapshotIndicator proposal={entry.proposal.account} />
      </span>
    </div>
  );
}

function ProposalMeta({ proposal }: { proposal: ProposalAccount }) {
  return (
    <div className={styles.detailGrid}>
      <span className={styles.detailLabel}>TRUST</span>
      <span className={styles.detailValue}>
        <CopyableMono
          full={proposal.trust.toBase58()}
          display={shortAddress(proposal.trust.toBase58())}
        />
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposer reputation — iter-6 glyph next to detail-modal proposer    */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Aggregate stats for a proposer on this TRUST. Computed locally from
 * the proposals already loaded by `useQuorum` — no extra RPC call.
 *
 * `settled` counts every proposal that has reached a terminal state at
 * the current cluster clock (succeeded / executed / defeated / canceled).
 * Active and pending proposals do NOT contribute to the success rate
 * because they haven&apos;t resolved yet; counting them as failures would
 * read as "this proposer is bad" the moment they open something, which
 * isn&apos;t honest.
 *
 * `successRate` is `(succeeded + executed) / settled` — a proposer with
 * 2 executed + 1 defeated reads as 67% success.
 */
interface ProposerReputation {
  total: number;
  settled: number;
  succeeded: number;
  successRate: number | null;
}

function computeProposerReputation(
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
    // We can&apos;t import `deriveProposalStatus` here without forming a
    // cycle through parts.tsx, so inline the terminal-state check using
    // the same on-chain fields.
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

/**
 * Compact glyph rendered next to the proposer address. Reads as:
 *
 *   "3 proposals · 67% success"      ← settled cohort exists
 *   "1 proposal · pending"           ← only the current proposal, nothing settled yet
 *
 * Tone follows the canonical lifecycle accent family — green when the
 * rate is at or above 50%, amber when below, neutral when no signal
 * exists yet.
 */
function ProposerReputationGlyph({ reputation }: { reputation: ProposerReputation }) {
  if (reputation.total === 0) return null;
  const noun = reputation.total === 1 ? "proposal" : "proposals";
  if (reputation.successRate === null) {
    return (
      <span
        className={styles.reputationGlyph}
        data-tone="defeated"
        aria-label={`${reputation.total} ${noun} by this proposer, none settled yet`}
      >
        <span className={styles.reputationCount}>
          {reputation.total} {noun}
        </span>
        <span className={styles.reputationSeparator}>·</span>
        <span className={styles.reputationRate}>pending</span>
      </span>
    );
  }
  const pct = Math.round(reputation.successRate * 100);
  const tone = pct >= 50 ? "done" : "in_review";
  return (
    <span
      className={styles.reputationGlyph}
      data-tone={tone}
      aria-label={`${reputation.total} ${noun} by this proposer · ${reputation.succeeded} of ${reputation.settled} settled succeeded (${pct}%)`}
    >
      <span className={styles.reputationCount}>
        {reputation.total} {noun}
      </span>
      <span className={styles.reputationSeparator}>·</span>
      <span className={styles.reputationRate}>{pct}% success</span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* New proposal — moved to `./QuorumPage.new-proposal` for line cap   */
/* ────────────────────────────────────────────────────────────────── */
//
// The iter-5 IPFS pre-pin path pushed `NewProposalModal` past the
// 600-line lint cap on this file. It now lives in the sibling
// `./QuorumPage.new-proposal` and is re-exported here so `QuorumPage.tsx`
// keeps a single import surface.

export { NewProposalModal } from "./QuorumPage.new-proposal";

/* ────────────────────────────────────────────────────────────────── */
/* Inline vote-cast — visible on active rows only                     */
/* ────────────────────────────────────────────────────────────────── */

/**
 * `InlineVoteActions` — three icon-buttons (For / Against / Abstain)
 * rendered on the right side of active proposal rows. Wires to the
 * `castVote` honest stub; surfaces the TBD state to the operator if
 * the platform handler returns 404.
 *
 * Click is stopPropagation'd so it doesn't open the detail modal
 * alongside the row click. Once a vote is in flight the row sticks
 * with a small inline status — the parent doesn't navigate away.
 *
 * iter-6: a successful cast now exposes a "View receipt" button that
 * opens a print-ready modal carrying the TRUST + proposal id + vote +
 * weight + signature + timestamp + verifier hint. This is the audit
 * artifact a board member or accountant would file when reconciling.
 */
export function InlineVoteActions({
  trustId,
  trustAddress,
  proposalIdHex,
  proposalIdBytes,
}: {
  trustId: string;
  trustAddress: string;
  proposalIdHex: string;
  proposalIdBytes: Uint8Array | number[];
}) {
  const invalidate = useQuorumInvalidator(trustAddress);
  const [pending, setPending] = useState<null | "for" | "against" | "abstain">(null);
  const [done, setDone] = useState<
    | null
    | { tone: "tbd" | "err"; msg: string }
    | {
        tone: "ok";
        msg: string;
        receipt: VoteReceipt;
      }
  >(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const fire = async (choice: 0 | 1 | 2, label: "for" | "against" | "abstain") => {
    setPending(label);
    setDone(null);
    try {
      const result = await api.castVote({
        entity_id: trustId,
        proposal_id_hex: proposalIdHex,
        choice,
      });
      if (result.platform_side_tbd) {
        setDone({ tone: "tbd", msg: "TBD" });
      } else {
        setDone({
          tone: "ok",
          msg: "Voted",
          receipt: {
            trustAddress,
            proposalIdHex,
            choice,
            weight: result.weight,
            signature: result.signature_b58,
            voteRecordPubkey: result.vote_record_pubkey_b58,
            castAtUnix: Math.floor(Date.now() / 1000),
          },
        });
        // Wire write to read: the vote-records query for this proposal
        // refetches immediately so the detail-modal audit trail and the
        // row tallies stay in sync with the cluster.
        invalidate({ proposalId: proposalIdBytes, kind: "vote" });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setDone({ tone: "tbd", msg: "TBD" });
      } else {
        setDone({ tone: "err", msg: err instanceof Error ? err.message : "Failed" });
      }
    } finally {
      setPending(null);
    }
  };

  if (done) {
    if (done.tone === "ok") {
      return (
        <>
          <Inline gap="2" align="center">
            <Badge variant="success" size="sm">
              {done.msg}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setReceiptOpen(true);
              }}
              aria-label="View vote receipt"
            >
              View receipt
            </Button>
          </Inline>
          <VoteReceiptModal
            open={receiptOpen}
            receipt={done.receipt}
            onClose={() => setReceiptOpen(false)}
          />
        </>
      );
    }
    return (
      <Tooltip
        content={
          done.tone === "tbd"
            ? "Platform-side TBD: /api/solana/proposal-vote isn't live yet."
            : done.msg
        }
      >
        <Badge variant={done.tone === "tbd" ? "warning" : "error"} size="sm">
          {done.msg}
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Inline gap="1">
      <Tooltip content="Vote For">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={(e) => {
            e.stopPropagation();
            void fire(1, "for");
          }}
          aria-label="Vote for"
        >
          <span className={styles.voteGlyph} data-tone="for" aria-hidden="true">
            ▲
          </span>
        </Button>
      </Tooltip>
      <Tooltip content="Vote Against">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={(e) => {
            e.stopPropagation();
            void fire(0, "against");
          }}
          aria-label="Vote against"
        >
          <span className={styles.voteGlyph} data-tone="against" aria-hidden="true">
            ▼
          </span>
        </Button>
      </Tooltip>
      <Tooltip content="Abstain">
        <Button
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={(e) => {
            e.stopPropagation();
            void fire(2, "abstain");
          }}
          aria-label="Abstain"
        >
          <span className={styles.voteGlyph} data-tone="abstain" aria-hidden="true">
            —
          </span>
        </Button>
      </Tooltip>
    </Inline>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Vote receipt — iter-6 printable artifact                            */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Self-contained receipt data captured at cast-time. Lives entirely on
 * the success branch of {@link InlineVoteActions} — never persisted to
 * local storage because the canonical record is the on-chain VoteRecord
 * PDA. The modal is a render of this struct.
 */
interface VoteReceipt {
  trustAddress: string;
  proposalIdHex: string;
  choice: 0 | 1 | 2;
  weight: string;
  signature: string;
  voteRecordPubkey: string;
  castAtUnix: number;
}

const CHOICE_LABEL_FOR_RECEIPT: Record<0 | 1 | 2, "For" | "Against" | "Abstain"> = {
  0: "Against",
  1: "For",
  2: "Abstain",
};

const CHOICE_TONE_FOR_RECEIPT: Record<0 | 1 | 2, "for" | "against" | "abstain"> = {
  0: "against",
  1: "for",
  2: "abstain",
};

/**
 * Print-ready vote receipt. Opens as a Modal but the inner card carries
 * its own self-contained layout + print-friendly styles in the CSS
 * module so the operator can hit "Print" and get a clean single-page
 * artifact — what a CFO would slip into a board folder.
 *
 * No external network calls; everything renders from the in-memory
 * receipt struct captured at cast-time.
 */
function VoteReceiptModal({
  open,
  receipt,
  onClose,
}: {
  open: boolean;
  receipt: VoteReceipt;
  onClose: () => void;
}) {
  const choiceLabel = CHOICE_LABEL_FOR_RECEIPT[receipt.choice];
  const choiceTone = CHOICE_TONE_FOR_RECEIPT[receipt.choice];
  const castAtLabel = formatTimestamp(receipt.castAtUnix);
  const handlePrint = () => {
    // window.print() is the cheapest print path that doesn&apos;t require
    // popping a new tab. The @media print rules in the css module strip
    // the modal chrome so only `.receiptCard` reaches the page.
    window.print();
  };
  return (
    <Modal open={open} onClose={onClose} title="Vote receipt">
      <div className={`${styles.scope} ${styles.modalBody} ${styles.receiptModal}`}>
        <div className={styles.receiptCard} role="document" aria-label="Vote receipt">
          <div className={styles.receiptHeader}>
            <span className={styles.receiptKicker}>aeqi · vote receipt</span>
            <h2 className={styles.receiptTitle}>
              {choiceLabel} · weight {receipt.weight}
            </h2>
          </div>
          <div className={styles.receiptGrid}>
            <span className={styles.receiptGridLabel}>Vote</span>
            <span
              className={`${styles.receiptGridValue} ${styles.receiptChoice}`}
              data-tone={choiceTone}
            >
              {choiceLabel}
            </span>
            <span className={styles.receiptGridLabel}>Weight</span>
            <span className={styles.receiptGridValue}>{receipt.weight}</span>
            <span className={styles.receiptGridLabel}>TRUST</span>
            <span className={styles.receiptGridValue}>{receipt.trustAddress}</span>
            <span className={styles.receiptGridLabel}>Proposal ID</span>
            <span className={styles.receiptGridValue}>{receipt.proposalIdHex}</span>
            <span className={styles.receiptGridLabel}>Vote record</span>
            <span className={styles.receiptGridValue}>{receipt.voteRecordPubkey}</span>
            <span className={styles.receiptGridLabel}>Signature</span>
            <span className={styles.receiptGridValue}>{receipt.signature}</span>
            <span className={styles.receiptGridLabel}>Cast at</span>
            <span className={styles.receiptGridValue}>
              {castAtLabel} · unix {receipt.castAtUnix}
            </span>
          </div>
          <p className={styles.receiptVerifier}>
            Verify on-chain by fetching the VoteRecord PDA at the address above. The signature
            references the Solana transaction that opened the VoteRecord; any cluster explorer (e.g.
            solscan.io, solanafm.com) will resolve it to the cast_vote ix and confirm the choice +
            weight match this receipt.
          </p>
        </div>
        <Inline gap="2" justify="end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" onClick={handlePrint} aria-label="Print receipt">
            Print
          </Button>
        </Inline>
      </div>
    </Modal>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Per-filter empty state — deliberate, not generic                   */
/* ────────────────────────────────────────────────────────────────── */

export type FilterKey =
  | "all"
  | "active"
  | "pending"
  | "succeeded"
  | "defeated"
  | "executed"
  | "canceled";

/**
 * Map a `FilterKey` to a tailored EmptyState (headline + body) that
 * reads as a deliberate "nothing here, here's why" instead of a generic
 * "no rows". Each variant carries the canonical lifecycle accent for
 * the cohort being filtered, so the visual stays coherent with the
 * dot+chip family already on the page.
 */
export function ProposalsEmptyState({ filter }: { filter: FilterKey }) {
  const variant = EMPTY_STATE_BY_FILTER[filter];
  return <EmptyState title={variant.title} description={variant.description} />;
}

const EMPTY_STATE_BY_FILTER: Record<FilterKey, { title: string; description: string }> = {
  all: {
    title: "No proposals opened against this TRUST",
    description:
      "When a proposer opens a proposal — by quest decision, role-mode multisig, or token-mode vote — the full audit trail lands here.",
  },
  active: {
    title: "No live votes right now",
    description:
      "Nothing is in its vote window. Open a proposal above to put one on the floor, or check Pending to see proposals queued to start.",
  },
  pending: {
    title: "Nothing queued to start",
    description:
      "Pending proposals are between propose() and vote_start — none are scheduled. Once a proposer queues one with a future start, it'll appear here.",
  },
  succeeded: {
    title: "No successes awaiting execution",
    description:
      "Succeeded proposals passed quorum + support but haven't been executed yet. Move to Executed to see the lifetime list of settled work.",
  },
  defeated: {
    title: "No proposals have been defeated",
    description:
      "Defeated = vote window closed with for-votes ≤ against-votes. None on the books, which is a healthy signal for new TRUSTs.",
  },
  executed: {
    title: "Nothing has been executed yet",
    description:
      "Once a proposal succeeds and the execution timelock elapses, anyone can call execute() and it lands here as the immutable record.",
  },
  canceled: {
    title: "No proposals have been canceled",
    description:
      "Cancellations are rare — typically only the proposer (or a privileged role) can pull a proposal mid-window.",
  },
};
