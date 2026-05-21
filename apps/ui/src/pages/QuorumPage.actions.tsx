/**
 * Quorum surface — late-lifecycle write affordances + execution-payload
 * surface. Extracted from `QuorumPage.write.tsx` to keep both files
 * under the 600-line soft-cap.
 *
 * Owns:
 *
 *   - `useQuorumInvalidator` — small hook that returns an invalidation
 *     function callers fire after a successful write so the React Query
 *     caches behind `useQuorum` and the detail-modal vote history
 *     refetch immediately instead of waiting for the 30s staleTime. This
 *     is the iter-3 functional gap: previously a cast vote left the UI
 *     out-of-date for up to 30s.
 *   - `ProposalActionBar` — Execute CTA on `succeeded` proposals and a
 *     Cancel button on `pending`/`active` ones. Both are honest stubs
 *     wired to platform endpoints that don't ship yet; the modal banner
 *     surfaces the TBD state to the operator.
 *   - `ExecutionPayloadSection` — surfaces the `ipfsCid` field on the
 *     on-chain Proposal account. The on-chain primitive does NOT carry
 *     calldata; the proposal's execution intent lives in the IPFS-pinned
 *     payload referenced by this CID. Decodes the 64-byte field as ASCII
 *     (the canonical layout), copies the full CID, and links to the
 *     public gateway when present.
 *   - `VoteWeightBar` — horizontal bar visualizing a single vote's
 *     weight against the proposal's max-weight vote, so it's a one-glance
 *     read of who's tipping the scale.
 */
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  VOTE_CHOICE_LABEL,
  type ProposalAccount,
  type ProposalStatus,
  type RoleAccountWithPda,
} from "@/solana";
import { ApiError, api } from "@/lib/api";
import { Banner, Button, Inline, Modal, Stack, Textarea, Tooltip } from "@/components/ui";
import { formatInteger } from "@/lib/i18n";
import { useProposalVoteRecords } from "@/hooks/useProposalVoteRecords";
import styles from "./QuorumPage.module.css";
import { CopyableMono } from "./QuorumPage.parts";
import { bytesToHex, relativeTimeLabel, shortAddress } from "./QuorumPage.format";

/* ────────────────────────────────────────────────────────────────── */
/* React Query invalidation — wire writes to reads                     */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Return a function that invalidates every Quorum-scoped query for a
 * given (trustAddress, proposalId?) tuple. After a successful vote, the
 * caller passes the proposalId to invalidate that proposal's vote
 * records too; after a successful propose/execute/cancel the proposal
 * list itself is invalidated.
 *
 * React Query's `invalidateQueries` matches by query-key prefix, so a
 * single `["quorum", "proposals", trustAddress]` invalidate refetches
 * the on-chain proposal list, and `["quorum", "voteRecords", ...]`
 * refetches the detail-modal vote audit.
 */
export function useQuorumInvalidator(trustAddress: string) {
  const qc = useQueryClient();
  return useCallback(
    (opts?: {
      proposalId?: Uint8Array | number[];
      kind?: "vote" | "propose" | "execute" | "cancel";
    }) => {
      // The voteRecords cache is keyed by the proposalId hex string —
      // so reuse `bytesToHex` to derive the same key the read uses.
      if (opts?.proposalId) {
        const idKey = bytesToHex(opts.proposalId);
        void qc.invalidateQueries({ queryKey: ["quorum", "voteRecords", trustAddress, idKey] });
      }
      void qc.invalidateQueries({ queryKey: ["quorum", "proposals", trustAddress] });
      // configs only change on register_config; only refetch them when a
      // brand-new proposal opens (the platform may have shipped a config
      // alongside in a sibling quest), not on every vote.
      if (opts?.kind === "propose") {
        void qc.invalidateQueries({ queryKey: ["quorum", "configs", trustAddress] });
      }
    },
    [qc, trustAddress],
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Vote weight bar — relative-to-max visualization                     */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Horizontal bar visualizing a single vote's weight against the
 * `maxWeight` of any vote on the proposal. Both inputs are BigInt-as-
 * string (Anchor u128); we ratio in BigInt to avoid Number-precision
 * loss on large supplies and map to a 0-100 percent for CSS.
 *
 * Tone follows the canonical lifecycle-accent family so a glance at the
 * audit trail reads For=jade, Against=ember, Abstain=muted.
 */
export function VoteWeightBar({
  weight,
  maxWeight,
  tone,
}: {
  weight: bigint;
  maxWeight: bigint;
  tone: "for" | "against" | "abstain" | "unknown";
}) {
  // BigInt math: clamp to 0..100 in three steps to keep precision on
  // u128-scale supplies. (weight * 1000n) / maxWeight gives 0..1000.
  const pctTenths = maxWeight === 0n ? 0 : Number((weight * 1000n) / maxWeight);
  const pct = Math.min(100, Math.max(0, pctTenths / 10));
  const vars = { "--vote-weight-pct": `${pct}%` } as Record<string, string>;
  return (
    <div className={styles.voteWeightTrack} style={vars as React.CSSProperties} aria-hidden="true">
      <div className={styles.voteWeightFill} data-tone={tone} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Vote history — VoteRecord PDAs scoped to (trust, proposalId)        */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Pull `VoteRecord` PDAs scoped to (trust, proposalId) and render the
 * audit trail. The row tallies show the aggregate, but operators need
 * to see WHO voted WHAT to spot delegation patterns, missed signers,
 * or coordination concerns. The RPC cost is one `getProgramAccounts`
 * call with a 2-filter memcmp.
 *
 * Each row carries a weight bar relative to the heaviest vote on the
 * proposal so influence concentration reads at a glance.
 */
export function VoteHistorySection({
  trustAddress,
  proposalId,
  blockTimes,
  signatures,
  nowSeconds,
}: {
  trustAddress: string;
  proposalId: Uint8Array | number[];
  /** iter-9: per-PDA blockTime map produced by `useProposalMomentum`. The
   *  hook fetches one signature per vote_record PDA via
   *  `getSignaturesForAddress` to plot momentum buckets; that exact map
   *  threads through here to back the "When" column. Omitted entries
   *  render as "—" (timestamp still resolving or RPC backfill gap). */
  blockTimes?: Record<string, number>;
  /** iter-9: per-PDA signature map; threads into the CSV export so
   *  operators can pivot from the audit row to the explorer. */
  signatures?: Record<string, string>;
  /** Wall clock — anchors the relative time labels so a re-render with
   *  a stale `nowSeconds` doesn't flash the column with "in 3m" while
   *  the rest of the modal still reads "ends in 2h". */
  nowSeconds: number;
}) {
  const { data, isLoading, error } = useProposalVoteRecords(trustAddress, proposalId);

  // Sort by weight DESC then voter address — gives the highest-impact
  // signer first, which is what an operator actually wants to scan for.
  const sortedRecords = useMemo(() => {
    const records = data ?? [];
    return [...records].sort((a, b) => {
      const aw = BigInt(a.account.weight.toString());
      const bw = BigInt(b.account.weight.toString());
      if (aw === bw) {
        return a.account.voter.toBase58().localeCompare(b.account.voter.toBase58());
      }
      return bw > aw ? 1 : -1;
    });
  }, [data]);

  const maxWeight = useMemo(() => {
    let m = 0n;
    for (const rec of sortedRecords) {
      const w = BigInt(rec.account.weight.toString());
      if (w > m) m = w;
    }
    return m;
  }, [sortedRecords]);

  // iter-9: CSV export. The audit table is the canonical "who voted what
  // with how much weight" surface. Operators investigating a tally
  // dispute, archiving a settled proposal, or feeding the record into a
  // spreadsheet shouldn't have to copy each row by hand. The download
  // includes every column the surface already shows plus the signature
  // (when known) so an auditor can pivot to the explorer.
  const csvHref = useMemo(() => {
    if (sortedRecords.length === 0) return null;
    return buildVoteRecordsCsv(sortedRecords, {
      blockTimes: blockTimes ?? {},
      signatures: signatures ?? {},
    });
  }, [sortedRecords, blockTimes, signatures]);

  const csvFilename = useMemo(() => {
    const idHex = bytesToHex(proposalId).slice(0, 8);
    return `vote-records-${idHex}.csv`;
  }, [proposalId]);

  return (
    <div>
      <Inline gap="2" align="center" justify="between" wrap>
        <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Vote history</h3>
        {csvHref ? (
          <Tooltip content="Download every vote record on this proposal as CSV (voter, choice, weight, when, signature).">
            <a
              href={csvHref}
              download={csvFilename}
              className={styles.voteHistoryExport}
              aria-label={`Export ${sortedRecords.length} vote records as CSV`}
            >
              Export CSV
            </a>
          </Tooltip>
        ) : null}
      </Inline>
      {isLoading ? (
        <span className={styles.voteHistoryMuted}>Loading vote records…</span>
      ) : error ? (
        <span className={styles.voteHistoryMuted}>
          {(error as Error).message || "Couldn't read vote records."}
        </span>
      ) : sortedRecords.length === 0 ? (
        <span className={styles.voteHistoryMuted}>No votes cast yet.</span>
      ) : (
        <div
          className={styles.voteHistoryTable}
          data-has-when="true"
          role="table"
          aria-label="Vote records"
        >
          <div className={styles.voteHistoryRow} role="row" data-header="true">
            <span role="columnheader">Voter</span>
            <span role="columnheader">Choice</span>
            <span role="columnheader" aria-label="Relative weight" />
            <span role="columnheader" className={styles.voteHistoryWeight}>
              Weight
            </span>
            <span role="columnheader" className={styles.voteHistoryWhen}>
              When
            </span>
          </div>
          {sortedRecords.map((rec) => {
            const choice = (VOTE_CHOICE_LABEL[rec.account.choice] ?? "?") as
              | "For"
              | "Against"
              | "Abstain"
              | "?";
            const tone: "for" | "against" | "abstain" | "unknown" =
              choice === "For"
                ? "for"
                : choice === "Against"
                  ? "against"
                  : choice === "Abstain"
                    ? "abstain"
                    : "unknown";
            const weight = BigInt(rec.account.weight.toString());
            const weightStr = formatInteger(Number(weight));
            const pda = rec.publicKey.toBase58();
            const blockTime = blockTimes?.[pda];
            const whenLabel = blockTime ? relativeTimeLabel(blockTime, nowSeconds) : "—";
            const whenTooltip = blockTime
              ? new Date(blockTime * 1000).toISOString()
              : "Timestamp still resolving from the chain.";
            return (
              <div key={pda} className={styles.voteHistoryRow} role="row">
                <CopyableMono
                  full={rec.account.voter.toBase58()}
                  display={shortAddress(rec.account.voter.toBase58())}
                />
                <span className={styles.voteHistoryChoice} data-tone={tone}>
                  {choice}
                </span>
                <VoteWeightBar weight={weight} maxWeight={maxWeight} tone={tone} />
                <span className={styles.voteHistoryWeight}>{weightStr}</span>
                <Tooltip content={whenTooltip}>
                  <span
                    className={styles.voteHistoryWhen}
                    data-empty={blockTime ? "false" : "true"}
                    aria-label={whenTooltip}
                  >
                    {whenLabel}
                  </span>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* CSV export — vote records as a downloadable artifact                */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Build a `data:` URL containing the CSV body. Returning a URL (rather
 * than triggering a download imperatively) keeps the function pure and
 * lets the consuming `<a download>` element handle the click-to-save
 * affordance natively — works inside Modal stacks without focus
 * gymnastics and survives screen-reader navigation.
 *
 * Columns:
 *   1. voter — base58 EOA that cast the vote
 *   2. choice — `For` / `Against` / `Abstain` / `?` (label form, not raw u8)
 *   3. weight — integer u128-as-decimal, no thousand separator (parsers prefer this)
 *   4. block_time_iso — ISO-8601 UTC, blank when chain timestamp unresolved
 *   5. block_time_unix — unix seconds, blank when unresolved
 *   6. signature — base58 tx signature that created the vote_record PDA, blank when unknown
 *   7. vote_record_pda — base58 PDA address for cross-reference
 *
 * Every cell is RFC-4180 quoted unconditionally — base58 never contains
 * a comma or double-quote, but quoting everything keeps the parser story
 * trivial for arbitrary spreadsheet importers.
 */
function buildVoteRecordsCsv(
  records: Array<{
    publicKey: { toBase58(): string };
    account: {
      voter: { toBase58(): string };
      choice: number;
      weight: { toString(): string };
    };
  }>,
  ctx: {
    blockTimes: Record<string, number>;
    signatures: Record<string, string>;
  },
): string {
  const header = [
    "voter",
    "choice",
    "weight",
    "block_time_iso",
    "block_time_unix",
    "signature",
    "vote_record_pda",
  ];
  const lines: string[] = [header.map(csvCell).join(",")];
  for (const rec of records) {
    const pda = rec.publicKey.toBase58();
    const blockTime = ctx.blockTimes[pda];
    const signature = ctx.signatures[pda] ?? "";
    const choice = VOTE_CHOICE_LABEL[rec.account.choice] ?? "?";
    const row = [
      rec.account.voter.toBase58(),
      choice,
      rec.account.weight.toString(),
      blockTime ? new Date(blockTime * 1000).toISOString() : "",
      blockTime ? blockTime.toString() : "",
      signature,
      pda,
    ];
    lines.push(row.map(csvCell).join(","));
  }
  const body = lines.join("\r\n");
  // `encodeURIComponent` keeps unicode safe even though every column we
  // currently emit is ASCII; future-proofing for proposer-supplied names.
  return `data:text/csv;charset=utf-8,${encodeURIComponent(body)}`;
}

/** RFC-4180 CSV cell: wrap in quotes, double up any embedded quotes. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/* ────────────────────────────────────────────────────────────────── */
/* Execution payload — IPFS CID surface for the on-chain proposal      */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Surface the proposal's IPFS-pinned execution payload. The on-chain
 * Proposal account carries a 64-byte `ipfs_cid` field — the canonical
 * layout is ASCII (the CIDv1 base32 representation), null-padded on the
 * right. We:
 *
 *   - Decode the leading ASCII run (stop at the first NUL or non-ASCII
 *     byte). An all-zero field means the proposal opened without a
 *     pinned payload — render the "no payload pinned" copy.
 *   - Show the decoded CID as a copyable mono string + a gateway link.
 *   - Show a raw-hex toggle for proposals whose CID isn't valid ASCII.
 *
 * This is the "what does executing this proposal actually DO" entrypoint.
 * The full ix-decoded preview lives downstream when the platform's
 * proposal-payload endpoint ships.
 */
export function ExecutionPayloadSection({ proposal }: { proposal: ProposalAccount }) {
  const decoded = useMemo(() => decodeIpfsCid(proposal.ipfsCid), [proposal.ipfsCid]);
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div>
      <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Execution payload</h3>
      {decoded.kind === "empty" ? (
        <p className={styles.payloadMuted}>
          No payload pinned. This proposal opened without an off-chain payload — its execution
          intent lives in the title + description only.
        </p>
      ) : decoded.kind === "ascii" ? (
        <Stack gap="2">
          <Inline gap="2" align="center" wrap>
            <span className={styles.payloadLabel}>IPFS CID</span>
            <CopyableMono full={decoded.cid} display={decoded.cid} />
          </Inline>
          <Inline gap="2" wrap>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                window.open(
                  `https://ipfs.io/ipfs/${encodeURIComponent(decoded.cid)}`,
                  "_blank",
                  "noopener",
                )
              }
            >
              Open on ipfs.io
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide" : "Show"} raw bytes
            </Button>
          </Inline>
          {showRaw ? (
            <pre className={styles.payloadHex} aria-label="Raw ipfs_cid bytes">
              0x{bytesToHex(proposal.ipfsCid)}
            </pre>
          ) : null}
        </Stack>
      ) : (
        <Stack gap="2">
          <p className={styles.payloadMuted}>
            The `ipfs_cid` field isn't valid ASCII — the raw 64-byte value is shown below.
          </p>
          <pre className={styles.payloadHex} aria-label="Raw ipfs_cid bytes">
            0x{bytesToHex(proposal.ipfsCid)}
          </pre>
        </Stack>
      )}
    </div>
  );
}

type DecodedCid = { kind: "empty" } | { kind: "ascii"; cid: string } | { kind: "binary" };

/**
 * Decode the 64-byte `ipfs_cid` slot. Returns the ASCII string up to the
 * first NUL, or `binary` if the run hits a non-printable byte before
 * any printable run. The on-chain canonical layout is ASCII; this
 * decoder degrades safely if a proposer ever writes raw bytes.
 */
function decodeIpfsCid(bytes: Uint8Array | number[]): DecodedCid {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (arr.length === 0) return { kind: "empty" };
  // All-zero ⇒ explicit "no payload" sentinel.
  let allZero = true;
  for (const b of arr) {
    if (b !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return { kind: "empty" };

  let asciiLen = 0;
  let sawNonAscii = false;
  for (const b of arr) {
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) {
      asciiLen += 1;
      continue;
    }
    sawNonAscii = true;
    break;
  }
  if (asciiLen >= 4 && !sawNonAscii) {
    const cid = new TextDecoder("ascii").decode(arr.slice(0, asciiLen));
    return { kind: "ascii", cid };
  }
  return { kind: "binary" };
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposal action bar — Execute / Cancel honest stubs                 */
/* ────────────────────────────────────────────────────────────────── */

/**
 * `ProposalActionBar` — terminal-lifecycle write affordances.
 *
 *   - `succeeded` → Execute (honest stub to `/api/solana/proposal-execute`)
 *   - `pending` / `active` → Cancel (honest stub to `/api/solana/proposal-cancel`)
 *   - everything else → no actions (executed / defeated / canceled are
 *     terminal)
 *
 * Both endpoints return 404 `endpoint_unimplemented` until the sibling
 * quests ship them; the bar surfaces TBD plainly inside its inline
 * banner instead of pretending the request succeeded. On success the
 * cache invalidator fires and the modal's list/vote-history refresh
 * within one render cycle.
 */
/**
 * On-chain Role.status values from `aeqi_role`. The Anchor IDL stores
 * the discriminant as a u8 — Occupied is the "actually holds a seat"
 * state and is the only one we extend the cancel allowlist for. Vacant
 * roles aren't bound to a signer; Resigned/Archived (future states) are
 * audit-trail markers that shouldn't grant the affordance.
 */
const ROLE_STATUS_OCCUPIED = 1;

export function ProposalActionBar({
  trustId,
  trustAddress,
  proposal,
  status,
  viewerCreatorAddress,
  roles,
  onAction,
}: {
  trustId: string;
  trustAddress: string;
  proposal: ProposalAccount;
  status: ProposalStatus;
  /**
   * EOA that owns the TRUST (from `entity.creator_address`). When
   * present, the Cancel CTA only renders if it matches the on-chain
   * `proposer` field on the proposal — keeps random viewers from
   * accidentally firing a cancel against a proposal they didn&apos;t open.
   * `null` falls back to the prior permissive behaviour so the surface
   * stays usable on TRUSTs whose creator address isn&apos;t yet recorded.
   */
  viewerCreatorAddress: string | null;
  /**
   * Occupied role accounts on this TRUST. Iter-5 extends the cancel
   * allowlist beyond the proposer-only check: if the viewer&apos;s EOA
   * matches the `account` pubkey on any Occupied role, they also see the
   * Cancel CTA. The on-chain ix still gates the actual signature, this
   * is a UX gate to keep board / multisig members from being locked out
   * of the affordance on proposals they didn&apos;t personally open.
   */
  roles?: RoleAccountWithPda[];
  onAction?: () => void;
}) {
  const invalidate = useQuorumInvalidator(trustAddress);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState<null | "execute" | "cancel">(null);
  const [banner, setBanner] = useState<null | {
    kind: "success" | "warning" | "error";
    message: string;
  }>(null);

  const proposalIdHex = `0x${bytesToHex(proposal.proposalId)}`;

  const fireExecute = async () => {
    setBusy("execute");
    setBanner(null);
    try {
      const result = await api.proposalExecute({
        entity_id: trustId,
        proposal_id_hex: proposalIdHex,
      });
      if (result.platform_side_tbd) {
        setBanner({
          kind: "warning",
          message:
            "Platform-side TBD: `/api/solana/proposal-execute` isn't live yet. The on-chain `execute_proposal` ix ships in a sibling quest.",
        });
      } else {
        setBanner({
          kind: "success",
          message: `Executed · ${result.signature_b58.slice(0, 12)}…`,
        });
      }
      invalidate({ proposalId: proposal.proposalId, kind: "execute" });
      onAction?.();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setBanner({
          kind: "warning",
          message:
            "Platform-side TBD: `/api/solana/proposal-execute` isn't live yet. The form shape matches the contract that will ship.",
        });
      } else {
        setBanner({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't execute proposal.",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const fireCancel = async () => {
    setBusy("cancel");
    setBanner(null);
    try {
      const result = await api.proposalCancel({
        entity_id: trustId,
        proposal_id_hex: proposalIdHex,
        reason: cancelReason.trim() || undefined,
      });
      if (result.platform_side_tbd) {
        setBanner({
          kind: "warning",
          message:
            "Platform-side TBD: `/api/solana/proposal-cancel` isn't live yet. The cancel ix itself ships in a sibling quest.",
        });
      } else {
        setBanner({
          kind: "success",
          message: `Canceled · ${result.signature_b58.slice(0, 12)}…`,
        });
      }
      invalidate({ proposalId: proposal.proposalId, kind: "cancel" });
      setCancelOpen(false);
      setCancelReason("");
      onAction?.();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setBanner({
          kind: "warning",
          message:
            "Platform-side TBD: `/api/solana/proposal-cancel` isn't live yet. The form shape matches the contract that will ship.",
        });
      } else {
        setBanner({
          kind: "error",
          message: err instanceof Error ? err.message : "Couldn't cancel proposal.",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const canExecute = status === "succeeded";

  // Cancel allowlist — iter-5 extends beyond proposer-only:
  //   1. viewerCreatorAddress is null — the entity record didn&apos;t carry
  //      a creator address. Fall back to the prior permissive behaviour
  //      so the surface stays usable; tooltip on the button calls out
  //      the broader restriction.
  //   2. viewerCreatorAddress is set — compare against the proposer
  //      pubkey on the proposal first. Then, if the viewer isn&apos;t the
  //      proposer, walk Occupied roles on the TRUST and grant the
  //      affordance if any role&apos;s `account` matches the viewer EOA.
  //      That covers the board / multisig case from the brief: a role
  //      holder reviewing someone else&apos;s proposal can pull it.
  //
  // This is a UX gate, not an authorization gate — the on-chain cancel
  // ix itself enforces the signer constraint (proposer-only today; a
  // sibling quest will add `proposal_cancel` grants on roles). Hiding
  // the button just keeps non-aligned viewers from clicking through a
  // TBD banner that doesn&apos;t explain why their cancel would fail.
  const proposerB58 = proposal.proposer.toBase58();
  const viewer = viewerCreatorAddress?.trim() ?? null;
  const isProposer = viewer !== null && viewer === proposerB58;
  const holdsOccupiedRole = useMemo(() => {
    if (viewer === null || !roles || roles.length === 0) return false;
    for (const r of roles) {
      if (r.account.status !== ROLE_STATUS_OCCUPIED) continue;
      if (r.account.account.toBase58() === viewer) return true;
    }
    return false;
  }, [viewer, roles]);
  const ownershipKnown = viewer !== null;
  const allowedSigner = isProposer || holdsOccupiedRole;
  const canCancel =
    (status === "pending" || status === "active") && (allowedSigner || !ownershipKnown);
  // Compose a precise tooltip so the operator knows WHY they have the
  // affordance — a role-holder pulling someone else&apos;s proposal should
  // see the broader rule rather than the proposer-only one.
  const cancelTooltip = isProposer
    ? "Cancel withdraws the proposal. The on-chain cancel ix only accepts the proposer&apos;s signature."
    : holdsOccupiedRole
      ? "Cancel withdraws the proposal. You hold a role on this TRUST — the proposed cancel grant lets role-holders pull proposals during pending/active."
      : "Cancel withdraws the proposal. Restricted to the proposer or a role-holder on this TRUST.";

  if (!canExecute && !canCancel && !banner) return null;

  return (
    <Stack gap="3">
      {canExecute || canCancel ? (
        <Inline gap="2" wrap>
          {canExecute ? (
            <Tooltip content="Execute marks the proposal as enacted on-chain. Anyone can call it once succeeded.">
              <Button
                variant="primary"
                size="sm"
                onClick={fireExecute}
                disabled={busy !== null}
                aria-label="Execute proposal"
              >
                {busy === "execute" ? "Executing…" : "Execute"}
              </Button>
            </Tooltip>
          ) : null}
          {canCancel ? (
            <Tooltip content={cancelTooltip}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCancelOpen(true)}
                disabled={busy !== null}
                aria-label="Cancel proposal"
              >
                Cancel proposal
              </Button>
            </Tooltip>
          ) : null}
        </Inline>
      ) : null}
      {banner ? <Banner kind={banner.kind}>{banner.message}</Banner> : null}
      <Modal
        open={cancelOpen}
        onClose={() => {
          if (busy === "cancel") return;
          setCancelOpen(false);
          setCancelReason("");
        }}
        title="Cancel this proposal"
      >
        <div className={`${styles.scope} ${styles.modalBody}`}>
          <Stack gap="4">
            <p className={styles.configsEmptyBody}>
              Cancellation is non-reversible — the proposal stays in the audit trail with the{" "}
              <strong>Canceled</strong> tag. Add a short note so signers reviewing the history know
              why.
            </p>
            <Textarea
              label="Reason (optional)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Withdrawing pending updated budget proposal."
              hint="Pinned alongside the on-chain cancel event."
            />
            <Inline gap="2" justify="end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCancelOpen(false);
                  setCancelReason("");
                }}
                disabled={busy === "cancel"}
              >
                Keep proposal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={fireCancel}
                disabled={busy === "cancel"}
                aria-label="Confirm cancel proposal"
              >
                {busy === "cancel" ? "Canceling…" : "Cancel proposal"}
              </Button>
            </Inline>
          </Stack>
        </div>
      </Modal>
    </Stack>
  );
}
