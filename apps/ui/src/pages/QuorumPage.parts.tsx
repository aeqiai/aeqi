/**
 * Quorum surface — presentational cells + formatting helpers.
 *
 * Split out of `QuorumPage.tsx` to keep the page under the
 * 600-line-per-file lint limit. None of the helpers carry React state
 * beyond the `CopyableMono` clipboard flash; the rest are pure
 * functions of their props.
 */
import { useState } from "react";

import { findRoleTypeById, isSnapshotPending, isTokenModeId, votingModeFor } from "@/solana";
import type { ProposalAccount, ProposalStatus, RoleTypeWithPda } from "@/solana";
import { Badge, Button, Stack, Tooltip, type BadgeVariant } from "@/components/ui";

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

const STATUS_VARIANT: Record<ProposalStatus, BadgeVariant> = {
  active: "info",
  succeeded: "success",
  defeated: "muted",
  executed: "success",
  canceled: "muted",
  pending: "neutral",
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  active: "Active",
  succeeded: "Succeeded",
  defeated: "Defeated",
  executed: "Executed",
  canceled: "Canceled",
  pending: "Pending",
};

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} size="sm" dot>
      {STATUS_LABEL[status]}
    </Badge>
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
/* Helpers — pure formatters                                           */
/* ────────────────────────────────────────────────────────────────── */

export function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function shortHex(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

export function bytesToHex(bytes: Uint8Array | number[]): string {
  const iter = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of iter) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export function shortBytes32(bytes: Uint8Array | number[]): string {
  return `0x${shortHex(bytesToHex(bytes))}`;
}

export function configIdLabel(bytes: Uint8Array | number[], roleTypes: RoleTypeWithPda[]): string {
  if (isTokenModeId(bytes)) return "0x0000…0000";
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const rt = findRoleTypeById(roleTypes, arr);
  if (rt) return roleTypeLabel(rt.account.roleTypeId);
  return shortBytes32(bytes);
}

/**
 * Role type IDs are 32-byte `pad32(ascii_label)` sentinels — render the
 * ASCII prefix when present so canonical role types read cleanly,
 * falling back to a hex preview. Mirrors the Module ID treatment used
 * in IncorporationPage.
 */
export function roleTypeLabel(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let asciiLen = 0;
  for (const b of arr) {
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7e) {
      asciiLen += 1;
      continue;
    }
    asciiLen = 0;
    break;
  }
  if (asciiLen > 0 && asciiLen <= 16) {
    const decoder = new TextDecoder("ascii");
    return decoder.decode(arr.slice(0, asciiLen));
  }
  return shortBytes32(arr);
}

export function modeLabel(bytes: Uint8Array | number[], roleTypes: RoleTypeWithPda[]): string {
  // Token-mode sorts first; this label is only used as a sort key.
  if (isTokenModeId(bytes)) return "0token";
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const rt = findRoleTypeById(roleTypes, arr);
  return rt ? roleTypeLabel(rt.account.roleTypeId) : shortBytes32(arr);
}

export function bpsLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/**
 * Format an Anchor BN-typed i64 second count as a human duration.
 * Accepts a BN; toString() yields the decimal representation safely.
 */
export function durationLabel(secondsBn: { toString(): string }): string {
  const seconds = Number(secondsBn.toString());
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

export function voteWindowLabel(proposal: ProposalAccount): string {
  const start = Number(proposal.voteStart.toString());
  const duration = Number(proposal.voteDuration.toString());
  if (!Number.isFinite(start) || !Number.isFinite(duration)) return "—";
  const end = start + duration;
  return `${formatTimestamp(start)} → ${formatTimestamp(end)}`;
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const date = new Date(seconds * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
