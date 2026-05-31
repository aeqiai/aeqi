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
 *     (company, proposalId) and renders the audit trail. This is the
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
  VoteRecordWithPda,
} from "@/solana";
import { ApiError, api } from "@/lib/api";
import { Badge, Button, EmptyState, Inline, Modal, Popover, Stack, Tooltip } from "@/components/ui";
import { useProposalVoteRecords } from "@/hooks/useProposalVoteRecords";
import styles from "./QuorumPage.module.css";
import {
  CopyableMono,
  ModeBadge,
  ProposalStatusBadge,
  SnapshotIndicator,
  TallyDetail,
} from "./QuorumPage.parts";
import { TallyMomentumStrip } from "./QuorumPage.momentum";
import { useProposalMomentum } from "@/hooks/useProposalMomentum";
import {
  bytesToHex,
  countdownLabel,
  formatTimestamp,
  shortAddress,
  shortBytes32,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.format";
import { VoteReceiptModal, type VoteReceipt } from "./QuorumPage.receipt";
import {
  ExecutionPayloadSection,
  ProposalActionBar,
  VoteHistorySection,
  useQuorumInvalidator,
} from "./QuorumPage.actions";
import {
  computeProposerReputation,
  recentProposalsBy,
  type ProposerReputation,
  type RecentProposalSummary,
} from "./QuorumPage.reputation";
import {
  ProposalDependencyChain,
  ShareProposalRow,
  TopVotersSection,
} from "./QuorumPage.detail-extras";

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
  voteRecords,
  companyId,
  companyAddress,
  nowSeconds,
  viewerCreatorAddress,
  onClose,
}: {
  entry: { proposal: ProposalWithPda; status: ProposalStatus } | null;
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  /**
   * Occupied role accounts on this COMPANY. Forwarded to the proposal
   * action bar so its cancel-eligibility check can extend beyond the
   * proposer to anyone holding a role.
   */
  roles?: RoleAccountWithPda[];
  /**
   * All proposals on this COMPANY — forwarded so the iter-6 proposer
   * reputation glyph can count how many proposals this proposer has
   * opened and their success rate. Cheap local aggregation, no extra
   * RPC call. When omitted, the glyph degrades to a 1/1 view of the
   * proposal being shown.
   */
  proposals?: ProposalWithPda[];
  /**
   * Every VoteRecord PDA on this COMPANY (already cached by `useQuorum`).
   * iter-10 uses it to aggregate per-voter participation across the
   * whole COMPANY so the modal can surface a "Top voters" subsection
   * inside the detail view — operators reviewing one proposal can spot
   * the signers who consistently show up across the cap table.
   */
  voteRecords?: VoteRecordWithPda[];
  companyId: string;
  companyAddress: string;
  nowSeconds: number;
  /**
   * EOA that owns this COMPANY (from `entity.creator_address`). The
   * action bar uses it to gate the Cancel CTA to the proposer or a
   * role-holder on the COMPANY — random viewers see a read-only detail
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

  // iter-8: share the vote-record query between the momentum sparkline
  // and the existing VoteHistorySection. Both consume the same query
  // key so the RPC round-trip happens once per (company, proposal).
  // `useProposalVoteRecords` is a no-op until we have a proposalId, so
  // we pass an empty array sentinel when the modal is closed.
  const proposalIdForRecords: Uint8Array | number[] = entry
    ? entry.proposal.account.proposalId
    : new Uint8Array(32);
  const { data: voteRecordsForMomentum } = useProposalVoteRecords(
    companyAddress,
    proposalIdForRecords,
  );

  // iter-9: reuse the same `useProposalMomentum` query (cached by
  // (company, pdaKey, voteStart, voteEnd)) that the sparkline mounts. The
  // hook resolves a `getSignaturesForAddress(votePda, { limit: 1 })`
  // per PDA — the resulting `blockTimes` + `signatures` maps thread
  // straight into `VoteHistorySection` to render the "When" column and
  // the CSV export, costing zero extra RPC because the strip and the
  // table share the React Query key.
  const voteStart = entry ? Number(entry.proposal.account.voteStart.toString()) : 0;
  const voteDuration = entry ? Number(entry.proposal.account.voteDuration.toString()) : 0;
  const { data: momentumForAudit } = useProposalMomentum({
    voteRecords: voteRecordsForMomentum,
    voteStart,
    voteEnd: voteStart + voteDuration,
    companyAddress,
  });

  return (
    <Modal open={open} onClose={onClose} title="Proposal detail">
      {entry ? (
        <div className={`${styles.scope} ${styles.modalBody}`}>
          <Stack gap="5">
            <ShareProposalRow proposal={entry.proposal.account} />
            <ProposalSummary
              entry={entry}
              roleTypes={roleTypes}
              nowSeconds={nowSeconds}
              proposals={proposals}
            />
            <ProposalActionBar
              companyId={companyId}
              companyAddress={companyAddress}
              proposal={entry.proposal.account}
              status={entry.status}
              viewerCreatorAddress={viewerCreatorAddress}
              roles={roles}
            />
            <div>
              <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Tallies</h3>
              <TallyDetail proposal={entry.proposal.account} config={matchedConfig} />
              <TallyMomentumStrip
                proposal={entry.proposal.account}
                config={matchedConfig}
                companyAddress={companyAddress}
                voteRecords={voteRecordsForMomentum}
                nowSeconds={nowSeconds}
              />
            </div>
            <ExecutionPayloadSection proposal={entry.proposal.account} />
            <ProposalDependencyChain
              proposal={entry.proposal.account}
              proposals={proposals ?? [entry.proposal]}
              nowSeconds={nowSeconds}
            />
            <VoteHistorySection
              companyAddress={companyAddress}
              proposalId={entry.proposal.account.proposalId}
              blockTimes={momentumForAudit?.blockTimes}
              signatures={momentumForAudit?.signatures}
              nowSeconds={nowSeconds}
            />
            <TopVotersSection
              voteRecords={voteRecords}
              proposalsCount={(proposals ?? [entry.proposal]).length}
              currentProposalId={entry.proposal.account.proposalId}
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
  /** All proposals on this COMPANY — feeds the proposer reputation glyph. */
  proposals?: ProposalWithPda[];
}) {
  const { start, end } = voteWindowSeconds(entry.proposal.account);
  const proposerB58 = entry.proposal.account.proposer.toBase58();
  const reputation = useMemo(
    () => computeProposerReputation(proposerB58, proposals ?? [entry.proposal], nowSeconds),
    [proposerB58, proposals, entry.proposal, nowSeconds],
  );
  // iter-7: pre-compute the proposer's last 5 proposals so the glyph
  // popover can render them without re-walking `proposals` on hover.
  const recentProposals = useMemo(
    () => recentProposalsBy(proposerB58, proposals ?? [entry.proposal], nowSeconds, 5),
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
        <ProposerReputationGlyph reputation={reputation} recentProposals={recentProposals} />
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
      <span className={styles.detailLabel}>COMPANY</span>
      <span className={styles.detailValue}>
        <CopyableMono
          full={proposal.company.toBase58()}
          display={shortAddress(proposal.company.toBase58())}
        />
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposer reputation — iter-6 glyph next to detail-modal proposer    */
/* ────────────────────────────────────────────────────────────────── */
//
// iter-8: `computeProposerReputation` / `recentProposalsBy` moved to
// `./QuorumPage.reputation.ts` so the proposals-table proposer cell
// can render the same hover preview without forming an import cycle
// through this file's modal exports.

/**
 * Compact glyph rendered next to the proposer address. Reads as:
 *
 *   "3 proposals · 67% success"      ← settled cohort exists
 *   "1 proposal · pending"           ← only the current proposal, nothing settled yet
 *
 * Tone follows the canonical lifecycle accent family — green when the
 * rate is at or above 50%, amber when below, neutral when no signal
 * exists yet.
 *
 * iter-7: clickable — opens a popover listing the proposer's last 5
 * proposals on this COMPANY with outcome glyphs, so an operator reviewing
 * a fresh proposal can audit who's behind it without leaving the page.
 */
function ProposerReputationGlyph({
  reputation,
  recentProposals,
}: {
  reputation: ProposerReputation;
  recentProposals: RecentProposalSummary[];
}) {
  if (reputation.total === 0) return null;
  const noun = reputation.total === 1 ? "proposal" : "proposals";
  const ariaLabel =
    reputation.successRate === null
      ? `${reputation.total} ${noun} by this proposer, none settled yet`
      : `${reputation.total} ${noun} by this proposer · ${reputation.succeeded} of ${reputation.settled} settled succeeded (${Math.round(
          reputation.successRate * 100,
        )}%)`;

  const tone =
    reputation.successRate === null
      ? "defeated"
      : Math.round(reputation.successRate * 100) >= 50
        ? "done"
        : "in_review";

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className={styles.reputationGlyph}
      data-tone={tone}
      aria-label={ariaLabel}
    >
      <span className={styles.reputationCount}>
        {reputation.total} {noun}
      </span>
      <span className={styles.reputationSeparator}>·</span>
      <span className={styles.reputationRate}>
        {reputation.successRate === null
          ? "pending"
          : `${Math.round(reputation.successRate * 100)}% success`}
      </span>
    </Button>
  );

  return (
    <Popover trigger={trigger} placement="bottom-start">
      <Stack gap="2" className={styles.reputationPanel}>
        <span className={styles.reputationPanelHeading}>Recent proposals</span>
        {recentProposals.length === 0 ? (
          <span className={styles.reputationPanelFootnote}>
            No earlier proposals from this proposer on this COMPANY.
          </span>
        ) : (
          <div className={styles.reputationPanelList} role="list">
            {recentProposals.map((p) => (
              <div key={p.id} className={styles.reputationPanelRow} role="listitem">
                <span
                  className={styles.reputationPanelGlyph}
                  data-tone={p.tone}
                  aria-hidden="true"
                />
                <span className={styles.reputationPanelId} title={p.id}>
                  {p.idShort}
                </span>
                <span className={styles.reputationPanelStatus} data-tone={p.tone}>
                  {p.label}
                </span>
              </div>
            ))}
          </div>
        )}
        <span className={styles.reputationPanelFootnote}>
          Showing the {Math.min(recentProposals.length, 5)} most recent. Counts include the current
          proposal.
        </span>
      </Stack>
    </Popover>
  );
}

// `recentProposalsBy` + supporting helpers moved to
// `./QuorumPage.reputation.ts` so the table-row proposer hover preview
// can reuse them. The detail-modal glyph re-imports them at the top.

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
 * opens a print-ready modal carrying the COMPANY + proposal id + vote +
 * weight + signature + timestamp + verifier hint. This is the audit
 * artifact a board member or accountant would file when reconciling.
 */
export function InlineVoteActions({
  companyId,
  companyAddress,
  proposalIdHex,
  proposalIdBytes,
}: {
  companyId: string;
  companyAddress: string;
  proposalIdHex: string;
  proposalIdBytes: Uint8Array | number[];
}) {
  const invalidate = useQuorumInvalidator(companyAddress);
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
        entity_id: companyId,
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
            companyAddress,
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
    title: "No proposals opened against this COMPANY",
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
      "Defeated = vote window closed with for-votes ≤ against-votes. None on the books, which is a healthy signal for new Companies.",
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
