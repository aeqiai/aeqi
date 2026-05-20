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
  RoleTypeWithPda,
} from "@/solana";
import { ApiError, api } from "@/lib/api";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Inline,
  Input,
  Modal,
  Select,
  Stack,
  Textarea,
  Tooltip,
} from "@/components/ui";
import styles from "./QuorumPage.module.css";
import {
  CopyableMono,
  ModeBadge,
  ProposalStatusBadge,
  SnapshotIndicator,
  TallyDetail,
} from "./QuorumPage.parts";
import {
  bpsLabel,
  bytesToHex,
  configIdLabel,
  durationLabel,
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

/* ────────────────────────────────────────────────────────────────── */
/* Proposal detail modal                                              */
/* ────────────────────────────────────────────────────────────────── */

export function ProposalDetailModal({
  entry,
  configs,
  roleTypes,
  trustId,
  trustAddress,
  nowSeconds,
  viewerCreatorAddress,
  onClose,
}: {
  entry: { proposal: ProposalWithPda; status: ProposalStatus } | null;
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  trustId: string;
  trustAddress: string;
  nowSeconds: number;
  /**
   * EOA that owns this TRUST (from `entity.creator_address`). The
   * action bar uses it to gate the Cancel CTA to the proposer or the
   * TRUST creator — random viewers see a read-only detail surface.
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
            <ProposalSummary entry={entry} roleTypes={roleTypes} nowSeconds={nowSeconds} />
            <ProposalActionBar
              trustId={trustId}
              trustAddress={trustAddress}
              proposal={entry.proposal.account}
              status={entry.status}
              viewerCreatorAddress={viewerCreatorAddress}
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
}: {
  entry: { proposal: ProposalWithPda; status: ProposalStatus };
  roleTypes: RoleTypeWithPda[];
  nowSeconds: number;
}) {
  const { start, end } = voteWindowSeconds(entry.proposal.account);
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
      <span className={styles.detailLabel}>Proposer</span>
      <span className={styles.detailValue}>
        <CopyableMono
          full={entry.proposal.account.proposer.toBase58()}
          display={shortAddress(entry.proposal.account.proposer.toBase58())}
        />
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
/* New proposal — header CTA opening a write-modal                    */
/* ────────────────────────────────────────────────────────────────── */

/**
 * `NewProposalModal` — opens a proposal against a registered config.
 *
 * Honest-stub contract: the platform endpoint `/api/solana/proposal-create`
 * does not exist yet. The modal POSTs to the canonical path; the
 * platform returns 404 / `endpoint_unimplemented` until shipped. When
 * that happens we surface "platform-side TBD" plainly inside the modal
 * instead of pretending the request succeeded — the operator should
 * never close the modal thinking a proposal opened when one didn't.
 */
export function NewProposalModal({
  open,
  trustId,
  trustAddress,
  configs,
  roleTypes,
  onClose,
  onSuccess,
  initialConfigIdHex,
}: {
  open: boolean;
  trustId: string;
  trustAddress: string;
  configs: GovernanceConfigWithPda[];
  roleTypes: RoleTypeWithPda[];
  onClose: () => void;
  onSuccess?: () => void;
  /** Optional pre-selection — used by the config switcher chip row. */
  initialConfigIdHex?: string;
}) {
  const invalidate = useQuorumInvalidator(trustAddress);
  const [configIdHex, setConfigIdHex] = useState<string>(() => {
    if (initialConfigIdHex) return initialConfigIdHex;
    return configs.length > 0 ? configIdHexFor(configs[0].account.governanceConfigId) : "";
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [voteHours, setVoteHours] = useState("72");
  const [execDelayHours, setExecDelayHours] = useState("24");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tbdNote, setTbdNote] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const configOptions = useMemo(
    () =>
      configs.map((c) => ({
        value: configIdHexFor(c.account.governanceConfigId),
        label: configIdLabel(c.account.governanceConfigId, roleTypes),
      })),
    [configs, roleTypes],
  );

  // Look up the chosen config so we can render its quorum / support /
  // voting-period inline below the Select. The proposer is signing up
  // for these thresholds; surfacing them BEFORE submit lets them choose
  // a different config or adjust the description (e.g. "needs 50% quorum
  // — please show up").
  const selectedConfig = useMemo(() => {
    if (!configIdHex) return undefined;
    return configs.find((c) => configIdHexFor(c.account.governanceConfigId) === configIdHex);
  }, [configIdHex, configs]);

  const titleValid = title.trim().length >= 3 && title.trim().length <= 120;
  const descValid = description.trim().length >= 10 && description.trim().length <= 4000;
  const hoursValid =
    Number.isFinite(Number(voteHours)) &&
    Number(voteHours) > 0 &&
    Number.isFinite(Number(execDelayHours)) &&
    Number(execDelayHours) >= 0;
  const canSubmit = !!configIdHex && titleValid && descValid && hoursValid && !submitting;

  const reset = () => {
    setTitle("");
    setDescription("");
    setVoteHours("72");
    setExecDelayHours("24");
    setError(null);
    setTbdNote(null);
    setSuccess(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setTbdNote(null);
    setSuccess(null);
    try {
      const result = await api.proposalCreate({
        entity_id: trustId,
        governance_config_id_hex: configIdHex,
        title: title.trim(),
        description: description.trim(),
        vote_duration_seconds: Math.round(Number(voteHours) * 3600),
        execution_delay_seconds: Math.round(Number(execDelayHours) * 3600),
      });
      if (result.platform_side_tbd) {
        setTbdNote(
          "Proposal request shaped + accepted, but the platform handler hasn't shipped — no on-chain proposal yet.",
        );
      } else {
        setSuccess(`Proposal opened · ${result.signature_b58.slice(0, 12)}…`);
        // Wire write to read: when the proposal lands on-chain the
        // proposals query re-fires immediately so the list updates
        // without the 30s staleTime gate.
        invalidate({ kind: "propose" });
      }
      onSuccess?.();
    } catch (err) {
      // The platform returns 404 `endpoint_unimplemented` until shipped.
      // Surface that as a "platform-side TBD" message — it's not a bug,
      // it's the documented stub state.
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setTbdNote(
          "Platform-side TBD: the `/api/solana/proposal-create` endpoint is owned by a sibling quest and isn't live yet. The form shape matches the contract that will ship.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Couldn't open proposal.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Open a new proposal"
    >
      <div className={`${styles.scope} ${styles.modalBody}`}>
        <Stack gap="4">
          {configs.length === 0 ? (
            <Banner kind="warning">
              No voting configs registered. Register one before opening a proposal.
            </Banner>
          ) : (
            <>
              <label className={styles.proposalFieldLabel}>
                <span>Voting config</span>
                <Select
                  options={configOptions}
                  value={configIdHex}
                  onChange={setConfigIdHex}
                  placeholder="Select a voting config"
                  size="md"
                  fullWidth
                  aria-label="Voting config"
                />
              </label>
              {selectedConfig ? (
                <div
                  className={styles.configPreview}
                  aria-label="Selected voting config thresholds"
                >
                  <div className={styles.configPreviewRow}>
                    <span className={styles.configPreviewLabel}>Quorum</span>
                    <span className={styles.configPreviewValue}>
                      {bpsLabel(selectedConfig.account.quorumBps)}
                    </span>
                  </div>
                  <div className={styles.configPreviewRow}>
                    <span className={styles.configPreviewLabel}>Support</span>
                    <span className={styles.configPreviewValue}>
                      {bpsLabel(selectedConfig.account.supportBps)}
                    </span>
                  </div>
                  <div className={styles.configPreviewRow}>
                    <span className={styles.configPreviewLabel}>Voting period</span>
                    <span className={styles.configPreviewValue}>
                      {durationLabel(selectedConfig.account.votingPeriod)}
                    </span>
                  </div>
                </div>
              ) : null}
              <Input
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is this proposal about?"
                size="md"
                hint="3-120 characters. Surfaces on the proposal row."
                error={title.length > 0 && !titleValid ? "Title must be 3-120 chars." : undefined}
              />
              <Textarea
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Full rationale, links, on-chain effects."
                hint="10-4000 characters. Pinned to IPFS as the proposal's ipfs_cid."
                error={
                  description.length > 0 && !descValid
                    ? "Description must be 10-4000 chars."
                    : undefined
                }
              />
              <Inline gap="3" wrap>
                <Input
                  label="Vote window (hours)"
                  type="number"
                  min={1}
                  step={1}
                  value={voteHours}
                  onChange={(e) => setVoteHours(e.target.value)}
                  size="md"
                  hint="How long voting stays open."
                />
                <Input
                  label="Execution delay (hours)"
                  type="number"
                  min={0}
                  step={1}
                  value={execDelayHours}
                  onChange={(e) => setExecDelayHours(e.target.value)}
                  size="md"
                  hint="Timelock between success and execute."
                />
              </Inline>
            </>
          )}
          {error ? <Banner kind="error">{error}</Banner> : null}
          {tbdNote ? <Banner kind="warning">{tbdNote}</Banner> : null}
          {success ? <Banner kind="success">{success}</Banner> : null}
          <Inline gap="2" justify="end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {submitting ? "Opening…" : "Open proposal"}
            </Button>
          </Inline>
        </Stack>
      </div>
    </Modal>
  );
}

/**
 * Convert an Anchor-decoded `governance_config_id` (Uint8Array OR
 * number[], length 32) into a 0x-prefixed lowercase-hex string suitable
 * for the platform's `governance_config_id_hex` field.
 */
function configIdHexFor(bytes: Uint8Array | number[]): string {
  return `0x${bytesToHex(bytes)}`;
}

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
  const [done, setDone] = useState<null | { tone: "ok" | "tbd" | "err"; msg: string }>(null);

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
        setDone({ tone: "ok", msg: "Voted" });
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
    return (
      <Tooltip
        content={
          done.tone === "tbd"
            ? "Platform-side TBD: /api/solana/proposal-vote isn't live yet."
            : done.tone === "ok"
              ? "Vote cast."
              : done.msg
        }
      >
        <Badge
          variant={done.tone === "ok" ? "success" : done.tone === "tbd" ? "warning" : "error"}
          size="sm"
        >
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
