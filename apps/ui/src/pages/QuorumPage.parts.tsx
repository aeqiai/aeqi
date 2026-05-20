/**
 * Quorum surface — presentational cells + formatting helpers.
 *
 * Split out of `QuorumPage.tsx` to keep the page under the
 * 600-line-per-file lint limit. None of the helpers carry React state
 * beyond the `CopyableMono` clipboard flash; the rest are pure
 * functions of their props.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  deriveProposalStatus,
  findRoleTypeById,
  isSnapshotPending,
  isTokenModeId,
  votingModeFor,
} from "@/solana";
import type {
  GovernanceConfigWithPda,
  ProposalAccount,
  ProposalStatus,
  ProposalWithPda,
  RoleTypeWithPda,
} from "@/solana";
import { Badge, Button, Inline, Modal, PageSection, Stack, Tooltip } from "@/components/ui";
import { formatInteger } from "@/lib/i18n";
import styles from "./QuorumPage.module.css";
import {
  bytesToHex,
  countdownLabel,
  roleTypeLabel,
  shortAddress,
  shortBytes32,
  shortHex,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.format";

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
        aria-label={`For ${forPct.toFixed(1)}%, Against ${againstPct.toFixed(1)}%, Abstain ${abstainPct.toFixed(1)}%`}
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
        {forPct.toFixed(0)}% for · {againstPct.toFixed(0)}% against · {abstainPct.toFixed(0)}%
        abstain
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
/* KPI strip                                                           */
/* ────────────────────────────────────────────────────────────────── */

export interface KpiTileProps {
  label: string;
  value: number;
  tone: "in_progress" | "in_review" | "done" | "neutral";
  hint?: string;
}

/**
 * Headline KPI tile — used for the four-up Governance health strip
 * above the configs table. Tone drives the inset accent rail per the
 * canonical lifecycle family.
 */
export function KpiTile({ label, value, tone, hint }: KpiTileProps) {
  return (
    <div className={`${styles.scope} ${styles.kpiTile}`} data-tone={tone}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{formatInteger(value)}</span>
      {hint ? <span className={styles.kpiHint}>{hint}</span> : null}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.kpiGrid}>{children}</div>;
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposal detail surface                                             */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Full vote tallies as a 3-row "for / against / abstain" table with
 * absolute counts AND percentages. Used in the proposal detail modal
 * where the compact `TallyBars` row-cell is too small to show counts.
 */
export function TallyDetail({ proposal }: { proposal: ProposalAccount }) {
  const forVotes = BigInt(proposal.forVotes.toString());
  const againstVotes = BigInt(proposal.againstVotes.toString());
  const abstainVotes = BigInt(proposal.abstainVotes.toString());
  const total = forVotes + againstVotes + abstainVotes;

  const rows: Array<{ key: "for" | "against" | "abstain"; label: string; count: bigint }> = [
    { key: "for", label: "For", count: forVotes },
    { key: "against", label: "Against", count: againstVotes },
    { key: "abstain", label: "Abstain", count: abstainVotes },
  ];

  return (
    <div className={styles.tallyTable}>
      {rows.map((row) => {
        const pct = total === 0n ? 0 : Number((row.count * 1000n) / total) / 10;
        // Drive the bar width through a CSS custom property on the
        // track so the fill rule lives in the module — keeps the audit
        // clean while still letting per-row data drive width.
        const trackStyle = { "--tally-pct": `${pct}%` } as React.CSSProperties;
        return (
          <RowFragment key={row.key}>
            <span className={styles.tallyKey}>{row.label}</span>
            <div className={styles.tallyTrack} style={trackStyle} aria-hidden="true">
              <div className={styles.tallyFill} data-key={row.key} />
            </div>
            <span className={styles.tallyCount}>
              {formatInteger(Number(row.count))} · {pct.toFixed(1)}%
            </span>
          </RowFragment>
        );
      })}
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
              <Link to={`/trust/${trustId}/equity`}>Equity</Link> surface.
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
/* KPI strip                                                           */
/* ────────────────────────────────────────────────────────────────── */

export function KpiStrip({
  proposals,
  configs,
}: {
  proposals: ProposalWithPda[];
  configs: GovernanceConfigWithPda[];
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
      <KpiTile
        label="Configs"
        value={configs.length}
        tone="neutral"
        hint={configs.length === 1 ? "voting mode" : "voting modes"}
      />
    </KpiGrid>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Proposal detail modal                                              */
/* ────────────────────────────────────────────────────────────────── */

export function ProposalDetailModal({
  entry,
  roleTypes,
  nowSeconds,
  onClose,
}: {
  entry: { proposal: ProposalWithPda; status: ProposalStatus } | null;
  roleTypes: RoleTypeWithPda[];
  nowSeconds: number;
  onClose: () => void;
}) {
  const open = entry !== null;
  return (
    <Modal open={open} onClose={onClose} title="Proposal detail">
      {entry ? (
        <div className={`${styles.scope} ${styles.modalBody}`}>
          <Stack gap="5">
            <ProposalSummary entry={entry} roleTypes={roleTypes} nowSeconds={nowSeconds} />
            <div>
              <h3 className={`${styles.detailLabel} ${styles.tallyHeading}`}>Tallies</h3>
              <TallyDetail proposal={entry.proposal.account} />
            </div>
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
  // The PDA is stable and unique per proposal — surface it so operators
  // can click straight to the on-chain account in an explorer once that
  // integration lands. For now it's a copyable mono pair.
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
  roleTypeLabel,
  shortAddress,
  shortBytes32,
  shortHex,
  voteWindowLabel,
  voteWindowSeconds,
} from "./QuorumPage.format";

export { STATUS_LABEL as PROPOSAL_STATUS_LABEL };
