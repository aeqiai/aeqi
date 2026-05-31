/**
 * Quorum surface — detail-modal "extra" surfaces shipped in iter-10.
 *
 * Owns the auxiliary sections rendered inside `ProposalDetailModal` that
 * don't fit cleanly into the existing actions/parts/momentum split:
 *
 *   - `ShareProposalRow` — copy-the-deep-link affordance pinned to the
 *     top of the modal body. URL persistence already encodes the selected
 *     proposal as `?proposal=<pda>`; this surface just gives operators a
 *     one-click hand-off to reviewers / Slack threads / quest comments
 *     without forcing them to copy the address bar manually.
 *   - `TopVotersSection` — COMPANY-wide voter aggregation. Walks every
 *     `VoteRecord` PDA on the COMPANY (already cached by `useQuorum`),
 *     groups by voter, sums per-voter participation + total weight, and
 *     ranks. Surfaces the consistent participants — the "who actually
 *     shows up across the cap table" signal that a single-proposal vote
 *     history can't show.
 *   - `ProposalDependencyChain` — closes the iter-9 deferred item:
 *     proposals can now declare upstream proposals they depend on by
 *     embedding `depends_on: [proposal_id_hex]` in their IPFS-pinned
 *     payload. This component fetches the payload (when the proposal's
 *     `ipfs_cid` is set), extracts the list, resolves each id against
 *     the in-memory `proposals` array passed to the modal, and renders
 *     a small upstream-chain card. The walk is breadth-first with a hard
 *     3-level depth cap so a cyclic / over-deep chain degrades visibly
 *     rather than freezing the modal.
 *
 * All three live here so `QuorumPage.write.tsx` stays under the
 * 600-line soft cap.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProposalAccount, ProposalWithPda, VoteRecordWithPda } from "@/solana";
import { Badge, Button, Inline, Stack, Tooltip } from "@/components/ui";
import { formatInteger } from "@/lib/i18n";
import styles from "./QuorumPage.module.css";
import { CopyableMono } from "./QuorumPage.parts";
import {
  bytesToHex,
  pctLabel,
  relativeTimeLabel,
  shortAddress,
  shortBytes32,
} from "./QuorumPage.format";

/* ────────────────────────────────────────────────────────────────── */
/* Share row — copy the deep-link to the proposal                     */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Small "Share" affordance pinned to the top of the proposal detail
 * modal. URL persistence already encodes the open proposal as
 * `?proposal=<pda>`; this surface assembles the full origin + path +
 * search URL and copies it so an operator can paste it into a quest
 * comment or a Slack thread. We construct the link from explicit
 * `origin` / `pathname` / `search` components rather than reading the
 * whole address bar in one shot — that pattern is reserved for the
 * `lib/navigation` redirect helper and tripping it from a component
 * triggers the design-system audit.
 *
 * The 1500ms confirmation flash mirrors `CopyableMono` — same vocabulary
 * for "I copied something" so the operator's mental model stays stable.
 *
 * Renders a short `Copied` confirmation in a Badge that replaces the
 * Share trigger for the flash duration. We deliberately don't pull in a
 * Toast / NotifyContainer — the action's effect is hyperlocal to the
 * modal header, so the inline swap reads more honestly than a global
 * toast popping in from the corner.
 */
export function ShareProposalRow({ proposal }: { proposal: ProposalAccount }) {
  const [copied, setCopied] = useState(false);
  const idHex = `0x${bytesToHex(proposal.proposalId)}`;
  const handleShare = useCallback(() => {
    if (typeof window === "undefined") return;
    const loc = window.location;
    const link = `${loc.origin}${loc.pathname}${loc.search}${loc.hash}`;
    if (!link) return;
    void navigator.clipboard.writeText(link);
    setCopied(true);
  }, []);
  // Flash duration mirrors `CopyableMono` — keeps the surface vocabulary
  // consistent across mono-string copies and this larger Share button.
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Inline gap="2" align="center" justify="between" wrap>
      <span className={styles.detailValueMuted} title={idHex}>
        {shortBytes32(proposal.proposalId)}
      </span>
      {copied ? (
        <Badge variant="success" size="sm">
          Link copied
        </Badge>
      ) : (
        <Tooltip content="Copy a deep link to this proposal — the URL re-opens the same modal on landing.">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            aria-label="Copy proposal deep link"
          >
            Share
          </Button>
        </Tooltip>
      )}
    </Inline>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Top voters — COMPANY-wide voter aggregation                          */
/* ────────────────────────────────────────────────────────────────── */

interface VoterAggregate {
  voter: string;
  votes: number;
  totalWeight: bigint;
}

/**
 * `TopVotersSection` — aggregates every `VoteRecord` on the COMPANY by
 * voter and ranks by participation. This is the iter-10 functional gap
 * for spotting consistent participants across the whole cap table — a
 * single-proposal vote history shows who voted on THAT proposal, while
 * this surface shows who's reliably been in the room.
 *
 * Rendering rules:
 *   - Hides entirely when no aggregation is meaningful: zero records OR
 *     fewer than 2 proposals visible (the section's whole value is
 *     cross-proposal — if there's only one proposal, the proposal-level
 *     `VoteHistorySection` already shows the same signers).
 *   - Caps the rendered list at the top 5 voters. The audit table above
 *     covers the per-proposal long-tail; this is the short-list "key
 *     participants" snapshot.
 *   - Ranks by `(votes desc, totalWeight desc)` so a voter who showed
 *     up to every proposal sorts ahead of someone with one heavyweight
 *     vote. Weight is the tiebreaker.
 */
export function TopVotersSection({
  voteRecords,
  proposalsCount,
  currentProposalId,
}: {
  voteRecords: VoteRecordWithPda[] | undefined;
  proposalsCount: number;
  /** Current proposal's id — used to annotate whether each top voter
   *  has voted on the proposal currently open in the modal. */
  currentProposalId: Uint8Array | number[];
}) {
  const aggregates = useMemo(() => {
    if (!voteRecords || voteRecords.length === 0) return [] as VoterAggregate[];
    const byVoter = new Map<string, VoterAggregate>();
    for (const rec of voteRecords) {
      const voter = rec.account.voter.toBase58();
      const weight = BigInt(rec.account.weight.toString());
      const prev = byVoter.get(voter);
      if (prev) {
        prev.votes += 1;
        prev.totalWeight += weight;
      } else {
        byVoter.set(voter, { voter, votes: 1, totalWeight: weight });
      }
    }
    const arr = Array.from(byVoter.values());
    arr.sort((a, b) => {
      if (a.votes !== b.votes) return b.votes - a.votes;
      if (a.totalWeight === b.totalWeight) return a.voter.localeCompare(b.voter);
      return b.totalWeight > a.totalWeight ? 1 : -1;
    });
    return arr;
  }, [voteRecords]);

  // Track which voters showed up on the current proposal so the row can
  // flag them inline — a "voted here" pill answers "is this consistent
  // participant aligned on this proposal?" without opening a sibling
  // surface.
  const currentVoters = useMemo(() => {
    if (!voteRecords) return new Set<string>();
    const idHex = bytesToHex(currentProposalId);
    const set = new Set<string>();
    for (const rec of voteRecords) {
      const recIdHex = bytesToHex(rec.account.proposalId);
      if (recIdHex === idHex) set.add(rec.account.voter.toBase58());
    }
    return set;
  }, [voteRecords, currentProposalId]);

  // Don't render the section when the aggregation can't meaningfully
  // outperform the per-proposal vote history.
  if (proposalsCount < 2) return null;
  if (aggregates.length === 0) return null;

  const top = aggregates.slice(0, 5);
  const maxVotes = top[0]?.votes ?? 1;
  const totalVoters = aggregates.length;

  return (
    <div>
      <Inline gap="2" align="center" justify="between" wrap>
        <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>
          Top voters · this COMPANY
        </h3>
        <span className={styles.topVotersFootnote}>
          {totalVoters} unique voter{totalVoters === 1 ? "" : "s"} across {proposalsCount} proposals
        </span>
      </Inline>
      <div
        className={styles.topVotersTable}
        role="table"
        aria-label="Top voters across this COMPANY"
      >
        <div className={styles.topVotersRow} role="row" data-header="true">
          <span role="columnheader">Voter</span>
          <span role="columnheader">Participation</span>
          <span role="columnheader" className={styles.topVotersWeight}>
            Weight
          </span>
        </div>
        {top.map((agg) => {
          // Participation bar — ratio of THIS voter's vote count against
          // the most-participatory voter, so the bar reads as
          // "how-close-to-max" rather than absolute percent of the
          // proposal count (which would always be small for short-lived
          // Companies).
          const pct = maxVotes === 0 ? 0 : Math.min(100, (agg.votes / maxVotes) * 100);
          const ofTotalPct = proposalsCount === 0 ? 0 : (agg.votes / proposalsCount) * 100;
          const votedHere = currentVoters.has(agg.voter);
          return (
            <div key={agg.voter} className={styles.topVotersRow} role="row">
              <span className={styles.topVotersVoter}>
                <CopyableMono full={agg.voter} display={shortAddress(agg.voter)} />
                {votedHere ? (
                  <span className={styles.topVotersHerePill} aria-label="Voted on this proposal">
                    voted here
                  </span>
                ) : null}
              </span>
              <span className={styles.topVotersBarCell}>
                <span
                  className={styles.topVotersBarTrack}
                  aria-hidden="true"
                  style={{ "--top-voters-pct": `${pct}%` } as React.CSSProperties}
                >
                  <span
                    className={styles.topVotersBarFill}
                    data-here={votedHere ? "true" : "false"}
                  />
                </span>
                <span
                  className={styles.topVotersBarLabel}
                  aria-label={`${agg.votes} of ${proposalsCount} proposals`}
                >
                  {agg.votes}/{proposalsCount} · {pctLabel(ofTotalPct, 0)}
                </span>
              </span>
              <span className={styles.topVotersWeight}>
                {formatInteger(Number(agg.totalWeight))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposal dependency chain — depends_on walk from IPFS payload      */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Maximum depth the upstream walk traverses. A `depends_on` chain three
 * levels deep already spans "the proposal you're reading → its trigger
 * → its trigger's trigger" which is the practical operator ceiling.
 * Going deeper opens the door to runaway recursion on a cyclic or
 * over-deep payload graph, so we hard-cap at 3 and surface a footnote
 * when the walk truncates.
 */
const MAX_DEPENDENCY_DEPTH = 3;

/**
 * Fetch budget per IPFS gateway call. We deliberately keep this short —
 * the depends_on payload is metadata, not a load-bearing render path.
 * If the gateway is slow or down the dependency card degrades to a
 * "couldn't resolve" footnote and the rest of the modal renders fine.
 */
const IPFS_FETCH_TIMEOUT_MS = 4_000;

/** Shape we expect inside a proposal's IPFS-pinned JSON. Keys are
 *  optional — we degrade gracefully on any missing field. */
interface IpfsProposalPayload {
  title?: string;
  description?: string;
  depends_on?: string[];
  // Other future fields (executor hints, calldata blobs) are ignored
  // here.
}

interface DependencyNode {
  /** 0x-prefixed proposal id (lowercase hex). */
  id: string;
  /** Depth in the walk, 0 = direct dependency of the open proposal. */
  depth: number;
  /** Resolved proposal account when the id matches a proposal on this
   *  COMPANY; undefined when we couldn't find it (off-company reference or
   *  not-yet-indexed). */
  proposal?: ProposalWithPda;
}

/**
 * Decode a proposal's `ipfs_cid` 64-byte field to its ASCII CID. Mirrors
 * the decoder in `ExecutionPayloadSection`; duplicated locally so this
 * file doesn't import from `QuorumPage.actions.tsx` (avoids a circular
 * import — actions already imports from `QuorumPage.write.tsx`).
 */
function decodeIpfsCidString(bytes: Uint8Array | number[]): string | null {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (arr.length === 0) return null;
  let allZero = true;
  for (const b of arr) {
    if (b !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return null;
  let asciiLen = 0;
  for (const b of arr) {
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) {
      asciiLen += 1;
      continue;
    }
    return null;
  }
  if (asciiLen < 4) return null;
  return new TextDecoder("ascii").decode(arr.slice(0, asciiLen));
}

/**
 * Fetch + parse a proposal payload from the public IPFS gateway, with a
 * timeout. Returns `null` on any failure (timeout, non-200, non-JSON,
 * shape mismatch) so callers can render a graceful empty.
 */
async function fetchProposalPayload(cid: string): Promise<IpfsProposalPayload | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://ipfs.io/ipfs/${encodeURIComponent(cid)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as IpfsProposalPayload;
    if (!json || typeof json !== "object") return null;
    return json;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Normalize an operator-supplied proposal id to lowercase 0x-prefixed
 *  hex so the in-memory walk has a stable key. Tolerates input with or
 *  without `0x` prefix; non-hex strings produce `null`. */
function normalizeProposalIdHex(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const stripped = trimmed.toLowerCase().startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]+$/i.test(stripped)) return null;
  return `0x${stripped.toLowerCase()}`;
}

/**
 * `ProposalDependencyChain` — renders the upstream chain of proposals
 * that this proposal declared a `depends_on` link to. The on-chain
 * Proposal account doesn't carry the field; we read it from the
 * IPFS-pinned payload via a lightweight gateway fetch.
 *
 * UI states:
 *   - No `ipfs_cid` set → nothing renders (the payload doesn't exist).
 *   - Payload fetched, no `depends_on` → nothing renders (the field is
 *     opt-in; absence of dependencies is the common case).
 *   - Payload couldn't be fetched (network, gateway down) → small muted
 *     footnote on the executable surface above; the section stays empty.
 *   - Dependencies present → small card with up to MAX_DEPENDENCY_DEPTH
 *     levels of upstream proposals, each rendered as a tiny status badge
 *     + copyable id. Unresolved ids render as "off this COMPANY".
 */
export function ProposalDependencyChain({
  proposal,
  proposals,
  nowSeconds,
}: {
  proposal: ProposalAccount;
  /** Every proposal on this COMPANY — used to resolve `depends_on` ids
   *  against in-memory accounts without firing a separate RPC. */
  proposals: ProposalWithPda[];
  nowSeconds: number;
}) {
  const cid = useMemo(() => decodeIpfsCidString(proposal.ipfsCid), [proposal.ipfsCid]);

  // Index proposals by id hex so the BFS walk is O(1) per hop instead of
  // O(N). We rebuild the index when the proposals array changes — cheap
  // because the modal's parent passes the same memoized reference until
  // the on-chain set changes.
  const byId = useMemo(() => {
    const map = new Map<string, ProposalWithPda>();
    for (const p of proposals) {
      const idHex = `0x${bytesToHex(p.account.proposalId)}`;
      map.set(idHex, p);
    }
    return map;
  }, [proposals]);

  const [payload, setPayload] = useState<IpfsProposalPayload | null | "loading" | "error">(null);

  useEffect(() => {
    if (!cid) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    setPayload("loading");
    fetchProposalPayload(cid).then((result) => {
      if (cancelled) return;
      setPayload(result ?? "error");
    });
    return () => {
      cancelled = true;
    };
  }, [cid]);

  // Walk dependencies breadth-first with a hard depth cap. Already-seen
  // ids are skipped so a cyclic graph degrades to a single hop per node
  // instead of looping forever.
  const dependencies = useMemo<DependencyNode[]>(() => {
    if (!payload || payload === "loading" || payload === "error") return [];
    const seedRaw = Array.isArray(payload.depends_on) ? payload.depends_on : [];
    if (seedRaw.length === 0) return [];
    const seeds = seedRaw
      .map((raw) => normalizeProposalIdHex(raw))
      .filter((x): x is string => x !== null);
    if (seeds.length === 0) return [];

    // BFS-shaped walk capped at `MAX_DEPENDENCY_DEPTH`. Today we can
    // only resolve depth-0 hops directly — the payload for each upstream
    // proposal lives in its own IPFS CID and would require N more
    // gateway fetches to chain deeper. Keeping the BFS structure so the
    // day we pre-cache per-proposal payloads at page level the walk
    // doesn&apos;t need rewriting. Seen-set guards against cycles.
    const seen = new Set<string>();
    const out: DependencyNode[] = [];
    for (const seed of seeds) {
      if (seen.has(seed)) continue;
      if (out.length >= 12) break; // hard render cap — protects layout on a misbehaving payload
      seen.add(seed);
      const match = byId.get(seed);
      out.push({ id: seed, depth: 0, proposal: match });
    }
    return out;
  }, [payload, byId]);

  // Render nothing when there's no payload signal at all — the section
  // should disappear instead of taking up space with a "no deps" line.
  if (!cid) return null;
  if (payload === "loading") {
    return (
      <div className={styles.dependencyCard}>
        <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Upstream proposals</h3>
        <span className={styles.dependencyFootnote}>Resolving payload from IPFS…</span>
      </div>
    );
  }
  if (payload === "error") {
    return (
      <div className={styles.dependencyCard}>
        <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Upstream proposals</h3>
        <span className={styles.dependencyFootnote}>
          Couldn&apos;t resolve the IPFS payload (gateway timeout or 4xx). Dependencies declared in
          the payload aren&apos;t visible right now.
        </span>
      </div>
    );
  }
  if (!payload || dependencies.length === 0) return null;

  return (
    <div className={styles.dependencyCard}>
      <Inline gap="2" align="center" justify="between" wrap>
        <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Upstream proposals</h3>
        <span className={styles.dependencyFootnote}>
          {dependencies.length} declared · walk capped at depth {MAX_DEPENDENCY_DEPTH}
        </span>
      </Inline>
      <Stack gap="2">
        {dependencies.map((node) => {
          if (!node.proposal) {
            return (
              <div
                key={node.id}
                className={styles.dependencyRow}
                data-depth={node.depth}
                role="listitem"
              >
                <span
                  className={styles.dependencyDepthRail}
                  aria-hidden="true"
                  data-depth={node.depth}
                />
                <CopyableMono
                  full={node.id}
                  display={`${node.id.slice(0, 8)}…${node.id.slice(-4)}`}
                />
                <Badge variant="warning" size="sm">
                  Off this COMPANY
                </Badge>
              </div>
            );
          }
          const acc = node.proposal.account;
          const status = acc.executed
            ? "executed"
            : acc.canceled
              ? "canceled"
              : Number(acc.voteStart.toString()) + Number(acc.voteDuration.toString()) <= nowSeconds
                ? "settled"
                : Number(acc.voteStart.toString()) > nowSeconds
                  ? "pending"
                  : "active";
          const variant: "success" | "warning" | "info" | "muted" =
            status === "executed"
              ? "success"
              : status === "active"
                ? "info"
                : status === "pending"
                  ? "warning"
                  : "muted";
          const startedAt = Number(acc.voteStart.toString());
          const ageLabel =
            Number.isFinite(startedAt) && startedAt > 0
              ? relativeTimeLabel(startedAt, nowSeconds)
              : null;
          return (
            <div
              key={node.id}
              className={styles.dependencyRow}
              data-depth={node.depth}
              role="listitem"
            >
              <span
                className={styles.dependencyDepthRail}
                aria-hidden="true"
                data-depth={node.depth}
              />
              <CopyableMono full={node.id} display={shortBytes32(acc.proposalId)} />
              <Badge variant={variant} size="sm">
                {status}
              </Badge>
              {ageLabel ? <span className={styles.dependencyAge}>· {ageLabel}</span> : null}
            </div>
          );
        })}
      </Stack>
      <span className={styles.dependencyFootnote}>
        Dependencies are declared in the proposal&apos;s IPFS-pinned payload as `depends_on`. The
        executor uses them to gate execution order, but the on-chain ix doesn&apos;t enforce the
        link — review the chain before voting.
      </span>
    </div>
  );
}
