/**
 * Quorum surface — presentational cells + formatting helpers.
 *
 * Split out of `QuorumPage.tsx` to keep the page under the
 * 600-line-per-file lint limit. None of the helpers carry React state
 * beyond the `CopyableMono` clipboard flash; the rest are pure
 * functions of their props.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { findRoleTypeById, isSnapshotPending, isTokenModeId, votingModeFor } from "@/solana";
import type {
  GovernanceConfigWithPda,
  ProposalAccount,
  ProposalStatus,
  RoleTypeWithPda,
} from "@/solana";
import { Badge, Button, Inline, Modal, PageSection, Stack, Tooltip } from "@/components/ui";
import { formatInteger } from "@/lib/i18n";
import styles from "./QuorumPage.module.css";
import { bytesToHex, countdownLabel, pctLabel, roleTypeLabel, shortHex } from "./QuorumPage.format";

/* ────────────────────────────────────────────────────────────────── */
/* Cell components                                                     */
/* ────────────────────────────────────────────────────────────────── */

export function ModeBadge({
  configId,
  roleTypes,
}: {
  configId: Uint8Array | number[];
  roleTypes: RoleTypeWithPda[];
}) {
  const mode = votingModeFor(configId);
  if (mode.kind === "token") {
    return (
      <Badge variant="info" size="sm">
        Token-weighted
      </Badge>
    );
  }
  const rt = findRoleTypeById(roleTypes, mode.roleTypeId);
  const label = rt
    ? roleTypeLabel(rt.account.roleTypeId)
    : `0x${shortHex(bytesToHex(mode.roleTypeId))}`;
  return (
    <Badge variant="accent" size="sm">
      Role: {label}
    </Badge>
  );
}

/**
 * Map a derived ProposalStatus onto the canonical 3-color lifecycle
 * accent family used across the app (see `.quest-status-dot--*`):
 *
 *   - `in_progress` (indigo)  — active / live  → `active`
 *   - `in_review`   (amber)   — pending / awaiting → `pending`
 *   - `done`        (jade)    — settled / verified → `executed`, `succeeded`
 *
 * The two terminal "not-success" states (`defeated`, `canceled`) stay
 * muted so a glance at a board doesn't read them as "success in jade".
 */
export type LifecycleTone =
  | "in_progress"
  | "in_review"
  | "done"
  | "defeated"
  | "canceled"
  | "pending";

export function lifecycleToneFor(status: ProposalStatus): LifecycleTone {
  if (status === "active") return "in_progress";
  if (status === "pending") return "in_review";
  if (status === "executed" || status === "succeeded") return "done";
  if (status === "defeated") return "defeated";
  return "canceled";
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  active: "Active",
  succeeded: "Succeeded",
  defeated: "Defeated",
  executed: "Executed",
  canceled: "Canceled",
  pending: "Pending",
};

/** Pure lifecycle dot — color-only signal, no chip background. */
export function ProposalStatusDot({ status }: { status: ProposalStatus }) {
  const tone = lifecycleToneFor(status);
  return <span className={styles.statusDot} data-tone={tone} aria-hidden="true" />;
}

export function ProposalStatusBadge({
  status,
  nowSeconds,
  voteStart,
  voteEnd,
}: {
  status: ProposalStatus;
  /** Optional — when supplied, an "ends in" / "starts in" hint renders. */
  nowSeconds?: number;
  voteStart?: number;
  voteEnd?: number;
}) {
  const tone = lifecycleToneFor(status);
  let hint: string | null = null;
  if (typeof nowSeconds === "number") {
    if (status === "active" && typeof voteEnd === "number") {
      hint = countdownLabel(voteEnd - nowSeconds, "ends");
    } else if (status === "pending" && typeof voteStart === "number") {
      hint = countdownLabel(voteStart - nowSeconds, "starts");
    }
  }
  return (
    <span className={styles.scope}>
      <span className={styles.statusInline}>
        <span className={styles.statusDot} data-tone={tone} aria-hidden="true" />
        <span>{STATUS_LABEL[status]}</span>
        {hint ? (
          <span className={styles.statusCountdown} data-tone={tone}>
            · {hint}
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function TallyBars({ proposal }: { proposal: ProposalAccount }) {
  const forVotes = BigInt(proposal.forVotes.toString());
  const againstVotes = BigInt(proposal.againstVotes.toString());
  const abstainVotes = BigInt(proposal.abstainVotes.toString());
  const total = forVotes + againstVotes + abstainVotes;
  const forPct = total === 0n ? 0 : Number((forVotes * 1000n) / total) / 10;
  const againstPct = total === 0n ? 0 : Number((againstVotes * 1000n) / total) / 10;
  const abstainPct = total === 0n ? 0 : Number((abstainVotes * 1000n) / total) / 10;

  if (total === 0n) {
    return (
      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-text-muted)" }}>
        No votes cast
      </span>
    );
  }

  return (
    <Stack gap="1">
      <div
        role="img"
        aria-label={`For ${pctLabel(forPct, 1)}, Against ${pctLabel(againstPct, 1)}, Abstain ${pctLabel(abstainPct, 1)}`}
        style={{
          display: "flex",
          width: "min(200px, 100%)",
          height: "6px",
          borderRadius: "var(--radius-full)",
          overflow: "hidden",
          backgroundColor: "var(--color-card-muted)",
        }}
      >
        <div style={{ width: `${forPct}%`, backgroundColor: "var(--color-success)" }} />
        <div style={{ width: `${againstPct}%`, backgroundColor: "var(--color-error)" }} />
        <div style={{ width: `${abstainPct}%`, backgroundColor: "var(--color-text-muted)" }} />
      </div>
      <span
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pctLabel(forPct)} for · {pctLabel(againstPct)} against · {pctLabel(abstainPct)} abstain
      </span>
    </Stack>
  );
}

export function SnapshotIndicator({ proposal }: { proposal: ProposalAccount }) {
  const isToken = isTokenModeId(proposal.governanceConfigId);
  if (!isToken) {
    return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
  }
  if (isSnapshotPending(proposal.snapshotRoot)) {
    return (
      <Tooltip content="Token-weighted votes are gated on a Merkle snapshot of holder balances. The snapshot root has not been committed yet.">
        <Badge variant="warning" size="sm" dot>
          Snapshot pending
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Badge variant="success" size="sm" dot>
      Snapshot committed
    </Badge>
  );
}

export function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "primary" : "ghost"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
    >
      {label} · {count}
    </Button>
  );
}

/**
 * `SortChip` — pairs with `FilterChip` for the proposals toolbar. No
 * count suffix; it's an axis selector, not a cohort filter. Pressed
 * state matches the FilterChip so the two rows read as one toolbar.
 */
export function SortChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </Button>
  );
}

export function CopyableMono({ full, display }: { full: string; display: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(full);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <span
        role="button"
        tabIndex={0}
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleCopy(e);
        }}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          cursor: "pointer",
        }}
      >
        {display}
        {copied ? " ✓" : ""}
      </span>
    </Tooltip>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposal detail surface                                             */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Full vote tallies as a 3-row "for / against / abstain" table with
 * absolute counts AND percentages. Used in the proposal detail modal
 * where the compact `TallyBars` row-cell is too small to show counts.
 *
 * When the proposal's GovernanceConfig is in scope (`config` passed in)
 * we also render two threshold markers on the "For" row's track:
 *
 *   - A `quorumBps` marker — the participation floor at which the chain
 *     considers the vote executable. Rendered as a hairline-free dashed
 *     band on the track via a background-image gradient (no 1px border).
 *   - A `supportBps` marker — the share of cast votes that must vote
 *     `for` for the proposal to succeed.
 *
 * Both markers are positioned via CSS custom properties so the module
 * keeps the gradient rule and the cell only emits data.
 */
export function TallyDetail({
  proposal,
  config,
}: {
  proposal: ProposalAccount;
  config?: GovernanceConfigWithPda;
}) {
  const forVotes = BigInt(proposal.forVotes.toString());
  const againstVotes = BigInt(proposal.againstVotes.toString());
  const abstainVotes = BigInt(proposal.abstainVotes.toString());
  const total = forVotes + againstVotes + abstainVotes;

  const rows: Array<{ key: "for" | "against" | "abstain"; label: string; count: bigint }> = [
    { key: "for", label: "For", count: forVotes },
    { key: "against", label: "Against", count: againstVotes },
    { key: "abstain", label: "Abstain", count: abstainVotes },
  ];

  // Express thresholds as percentages of the FOR-row track. The chain
  // uses bps over total cast (for the For-row scale), so dividing by 100
  // produces a 0-100 percent the CSS can position against.
  const quorumPct = config ? config.account.quorumBps / 100 : null;
  const supportPct = config ? config.account.supportBps / 100 : null;

  return (
    <div className={styles.tallyTable}>
      {rows.map((row) => {
        const pct = total === 0n ? 0 : Number((row.count * 1000n) / total) / 10;
        // Drive the bar width through a CSS custom property on the
        // track so the fill rule lives in the module — keeps the audit
        // clean while still letting per-row data drive width.
        // CSS custom properties aren't part of the React.CSSProperties
        // index signature; cast through a string-keyed bag to assign
        // them without leaking `any` to the rest of the cell.
        const trackVars: Record<string, string> = { "--tally-pct": `${pct}%` };
        // Threshold markers only attach to the "for" track — that's the
        // axis quorum + support are measured on.
        if (row.key === "for") {
          if (quorumPct !== null) trackVars["--quorum-pct"] = `${quorumPct}%`;
          if (supportPct !== null) trackVars["--support-pct"] = `${supportPct}%`;
        }
        const trackStyle = trackVars as React.CSSProperties;
        return (
          <RowFragment key={row.key}>
            <span className={styles.tallyKey}>{row.label}</span>
            <div className={styles.tallyTrack} style={trackStyle} aria-hidden="true">
              <div className={styles.tallyFill} data-key={row.key} />
              {row.key === "for" && quorumPct !== null ? (
                <Tooltip content={`Quorum threshold · ${pctLabel(quorumPct, 2)} participation`}>
                  <span className={styles.tallyMarker} data-kind="quorum" aria-hidden="true" />
                </Tooltip>
              ) : null}
              {row.key === "for" && supportPct !== null ? (
                <Tooltip content={`Support threshold · ${pctLabel(supportPct, 2)} for-votes`}>
                  <span className={styles.tallyMarker} data-kind="support" aria-hidden="true" />
                </Tooltip>
              ) : null}
            </div>
            <span className={styles.tallyCount}>
              {formatInteger(Number(row.count))} · {pctLabel(pct, 1)}
            </span>
          </RowFragment>
        );
      })}
      {config ? (
        <div className={styles.tallyLegend} aria-hidden="true">
          <span className={styles.tallyLegendItem}>
            <span className={styles.tallyLegendSwatch} data-kind="quorum" />
            quorum {quorumPct !== null ? pctLabel(quorumPct) : null}
          </span>
          <span className={styles.tallyLegendItem}>
            <span className={styles.tallyLegendSwatch} data-kind="support" />
            support {supportPct !== null ? pctLabel(supportPct) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// Tiny fragment helper to keep the grid 3-column layout intact —
// React Fragments don't render to the DOM so the grid auto-flows.
function RowFragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* ────────────────────────────────────────────────────────────────── */
/* Empty-state CTA — closes the biggest functional gap on the page    */
/* ────────────────────────────────────────────────────────────────── */

/**
 * No-config empty state. Rendered when a TRUST has registered the
 * `aeqi_governance` module but no GovernanceConfig PDA exists yet
 * (the dominant Foundation-TRUST shape post-signup). Shows a polished
 * card with the rationale + a primary CTA that opens a Modal walking
 * the operator through the two paths (token-mode via Equity vs role-
 * mode via Roles).
 */
export function NoGovernanceSetup({ trustId }: { trustId: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <PageSection title="Voting configs">
      <div className={styles.configsEmptyCard}>
        <h3 className={styles.configsEmptyTitle}>Set up governance for this TRUST</h3>
        <p className={styles.configsEmptyBody}>
          The <code>aeqi_governance</code> module is registered, but no voting config has been
          written yet. Until one exists, no proposals can open and no votes can be cast.
        </p>
        <Inline gap="2" wrap>
          <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
            Open governance setup
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open("https://aeqi.ai/docs/governance", "_blank", "noopener")}
          >
            Read the docs
          </Button>
        </Inline>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Set up governance">
        <Stack gap="4" className={styles.modalBody}>
          <p className={styles.configsEmptyBody}>
            Governance is two things: a <strong>voting config</strong> (who can vote, what
            thresholds apply) and the <strong>proposals</strong> opened against it. Pick the mode
            that fits this TRUST.
          </p>
          <ol className={styles.configsEmptySteps}>
            <li>
              <strong>Token-weighted</strong> — every equity-share holder votes by balance. Default
              for cap-table-driven companies. Register from the{" "}
              <Link to={`/trust/${trustId}/shares`}>Shares</Link> surface.
            </li>
            <li>
              <strong>Role-mode</strong> — multisig per role (e.g. Founders, Board, Ops). Register
              from the <Link to={`/trust/${trustId}/roles`}>Roles</Link> surface, one config per
              role type that should be able to vote.
            </li>
            <li>
              <strong>Quorum &amp; support</strong> — choose participation floor (e.g. 25%) and the
              share of cast votes that must vote <em>for</em> (e.g. 50%). Both are expressed in
              basis points on-chain (100 bps = 1%).
            </li>
          </ol>
          <p className={styles.configsEmptyBody}>
            Once a config exists, the configs table populates here and proposers can open proposals
            against it. Vote casting + execution land in the next iteration.
          </p>
          <Inline gap="2" justify="end">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setOpen(false);
                navigate(`/trust/${trustId}/roles`);
              }}
            >
              Go to Roles
            </Button>
          </Inline>
        </Stack>
      </Modal>
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Program-not-provisioned empty state                                 */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Rendered when the active cluster does not have the `aeqi_governance`
 * program deployed. This is a deployment-level gap, not a per-TRUST
 * config gap — the surface can't recover by setting up a config because
 * `register_config` is a `aeqi_governance` ix. Operator action lives
 * upstream (deploy the program / point the RPC URL at a cluster where
 * it's deployed). Surface that clearly instead of pretending the empty
 * configs list means "no governance configured yet".
 */
export function ProgramNotProvisionedCard() {
  return (
    <PageSection title="Voting configs">
      <div className={styles.configsEmptyCard}>
        <h3 className={styles.configsEmptyTitle}>Governance program not deployed</h3>
        <p className={styles.configsEmptyBody}>
          The active Solana cluster doesn&apos;t have <code>aeqi_governance</code> deployed yet, so
          no voting configs or proposals can exist for any TRUST on it. This is a deployment-level
          gap — once an operator deploys the program (or points the RPC URL at a cluster where
          it&apos;s deployed), the surface will populate automatically.
        </p>
        <Inline gap="2" wrap>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              window.open("https://aeqi.ai/docs/governance/deployment", "_blank", "noopener")
            }
          >
            Read the deployment docs
          </Button>
        </Inline>
      </div>
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Configs exist but no proposals yet — CTA-led empty                  */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Rendered when at least one voting config is registered but no
 * proposal has been opened against the TRUST yet. The default empty
 * states elsewhere read as "nothing here yet, here&apos;s why"; this one
 * has the affordance to fix it directly, so it&apos;s CTA-led instead.
 */
export function NoProposalsYetCard({ onOpen }: { onOpen: () => void }) {
  return (
    <PageSection
      title="Proposals"
      description="Every proposal opened against this TRUST. Status derives from tallies + the cluster clock."
    >
      <div className={styles.configsEmptyCard}>
        <h3 className={styles.configsEmptyTitle}>Draft your first proposal</h3>
        <p className={styles.configsEmptyBody}>
          A voting config exists but no proposal has been opened against this TRUST. The first
          proposal sets the cadence — write it like the audit-trail entry it&apos;ll always be.
        </p>
        <Inline gap="2" wrap>
          <Button variant="primary" size="sm" onClick={onOpen}>
            Draft a proposal
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              window.open("https://aeqi.ai/docs/governance/proposals", "_blank", "noopener")
            }
          >
            Read the proposal docs
          </Button>
        </Inline>
      </div>
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* KPI strip — moved to `./QuorumPage.kpi` for the 600-line cap        */
/* ────────────────────────────────────────────────────────────────── */
//
// `KpiStrip` (with the voter-turnout aggregation, sparkline, and the
// `KpiTile` / `KpiGrid` primitives) lives in the sibling file so this
// one stays under the line limit. Re-exported below for the parts.tsx
// import surface so existing callers don't need to update their paths.

export { KpiStrip, KpiTile, KpiGrid, type KpiTileProps } from "./QuorumPage.kpi";

/* ────────────────────────────────────────────────────────────────── */
/* Proposal detail modal + write affordances → `./QuorumPage.write`   */
/* ────────────────────────────────────────────────────────────────── */
//
// `ProposalDetailModal`, `VoteHistorySection`, `NewProposalModal`,
// `InlineVoteActions`, and `ProposalsEmptyState` live in the sibling
// file so this one stays under the 600-line lint cap. `QuorumPage.tsx`
// imports them directly from `./QuorumPage.write`.

/* ────────────────────────────────────────────────────────────────── */
/* Helpers re-exported from the pure-formatter module so existing      */
/* `./QuorumPage.parts` import sites continue to compile unchanged.    */
/* ────────────────────────────────────────────────────────────────── */

export {
  bpsLabel,
  bytesToHex,
  configIdLabel,
  countdownLabel,
  durationLabel,
  formatTimestamp,
  modeLabel,
  relativeTimeLabel,
  roleTypeLabel,
  shortAddress,
  shortBytes32,
  shortHex,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.format";

export { STATUS_LABEL as PROPOSAL_STATUS_LABEL };
