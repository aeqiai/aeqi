/**
 * Quorum surface — pure formatters extracted from `QuorumPage.parts.tsx`.
 *
 * Keeping these here (a) stays under the 600-line lint cap on the parts
 * file and (b) lets the table cells, the detail modal, and the KPI strip
 * share the same vocabulary for "render bytes32", "render basis points",
 * "render seconds-as-duration" without re-implementing each one.
 *
 * Nothing in this file imports React — it's the formatting kernel.
 */
import { findRoleTypeById, isTokenModeId } from "@/solana";
import type { ProposalAccount, RoleTypeWithPda } from "@/solana";
import { formatDate } from "@/lib/i18n";

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
  const { start, end } = voteWindowSeconds(proposal);
  if (start === null || end === null) return "—";
  return `${formatTimestamp(start)} → ${formatTimestamp(end)}`;
}

/** Return raw vote start/end as unix seconds, or null when BN math overflows. */
export function voteWindowSeconds(proposal: ProposalAccount): {
  start: number | null;
  end: number | null;
} {
  const start = Number(proposal.voteStart.toString());
  const duration = Number(proposal.voteDuration.toString());
  if (!Number.isFinite(start) || !Number.isFinite(duration)) {
    return { start: null, end: null };
  }
  return { start, end: start + duration };
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return formatDate(seconds * 1000, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Render an integer seconds delta as a human "ends in 2d 4h" hint.
 *
 * Negative deltas (vote already ended for an active proposal that
 * hasn't yet been settled) return `just ended` so the operator sees the
 * row needs attention.
 */
export function countdownLabel(seconds: number, verb: "ends" | "starts"): string {
  if (!Number.isFinite(seconds)) return "";
  if (seconds <= 0) {
    return verb === "ends" ? "just ended" : "starting now";
  }
  if (seconds < 60) return `${verb} in ${seconds}s`;
  if (seconds < 3600) return `${verb} in ${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${verb} in ${h}h ${m}m` : `${verb} in ${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${verb} in ${d}d ${h}h` : `${verb} in ${d}d`;
}
