/**
 * Heavier sub-sections for the Assets surface — Budgets and Vesting —
 * plus the shared cell + format helpers they reuse with the host page
 * (Holdings table uses the same `CopyableMono` / `shortAddress` /
 * `formatTokenAmount` family).
 *
 * Split out of `AssetsPage.tsx` only to keep the page file under the
 * 600-line lint ceiling. The pieces here are tightly coupled to the
 * Assets domain (Anchor account shapes for budget + vesting) and are
 * not consumed from other pages.
 */
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import type { BudgetAccountWithPda, VestingPositionWithPda } from "@/solana/assets";
import { formatMediumDate, formatNumber } from "@/lib/i18n";
import { explorerAddressUrl } from "@/lib/solana-explorer";
import {
  Badge,
  DetailField,
  Icon,
  Modal,
  PageSection,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

import styles from "./AssetsPage.module.css";

/**
 * Shape of the per-mint meta map produced by `useTokenMetas`. Passed
 * down from the page so the heavy sub-sections don't each spin up
 * their own resolver.
 */
export type TokenMetaMap = Record<string, ResolvedTokenMeta>;

const EMPTY_META: ResolvedTokenMeta = { symbol: null, decimals: null, resolvedOnChain: false };

function pickMeta(metas: TokenMetaMap | undefined, mint: string): ResolvedTokenMeta {
  return metas?.[mint] ?? EMPTY_META;
}

/* ────────────────────────────────────────────────────────────────── */
/* Budgets section                                                     */
/* ────────────────────────────────────────────────────────────────── */

export function BudgetsSection({
  budgets,
  metas,
  onSelect,
}: {
  budgets: BudgetAccountWithPda[];
  metas: TokenMetaMap;
  onSelect: (row: BudgetAccountWithPda) => void;
}) {
  const rows = useMemo(
    () =>
      [...budgets].sort((a, b) => {
        // Frozen budgets last; otherwise stable by budget_id.
        const aFrozen = a.account.frozen ? 1 : 0;
        const bFrozen = b.account.frozen ? 1 : 0;
        if (aFrozen !== bFrozen) return aFrozen - bFrozen;
        return bytesToHex(a.account.budgetId).localeCompare(bytesToHex(b.account.budgetId));
      }),
    [budgets],
  );

  const columns: Array<TableColumn<BudgetAccountWithPda>> = [
    {
      key: "budgetId",
      header: "Budget",
      cell: (row) => <span className={styles.monoCell}>{bytesIdLabel(row.account.budgetId)}</span>,
    },
    {
      key: "role",
      header: "Target role",
      cell: (row) => (
        <span className={styles.monoCell}>{bytesIdLabel(row.account.targetRoleId)}</span>
      ),
    },
    {
      key: "utilization",
      header: "Utilization",
      cell: (row) => (
        <BudgetUtilization
          spent={row.account.spent}
          amount={row.account.amount}
          decimals={budgetDecimals(metas)}
        />
      ),
    },
    {
      key: "expiry",
      header: "Expiry",
      align: "end",
      cell: (row) => <ExpiryCell expiry={Number(row.account.expiry)} />,
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (row) =>
        row.account.frozen ? (
          <Badge variant="warning" dot>
            Frozen
          </Badge>
        ) : (
          <Badge variant="success" dot>
            Active
          </Badge>
        ),
    },
  ];

  return (
    <PageSection
      title="Active budgets"
      description="Per-role allocations recorded on `aeqi_budget`. Spend caps are enforced on-chain. Click a row for details."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        ariaLabel="Active budgets"
        onRowClick={onSelect}
      />
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Vesting positions section                                           */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Vesting positions table — replaces the count-only tile. Renders every
 * outstanding grant on this TRUST with recipient, claimed-vs-total
 * progress, and lifecycle status. Status is derived from on-chain
 * timestamps: not-started → pending (in_review semantics), within
 * window → vesting (in_progress semantics), past end → fully vested
 * (done semantics).
 */
export function VestingPositionsSection({
  positions,
  metas,
}: {
  positions: VestingPositionWithPda[];
  metas: TokenMetaMap;
}) {
  const now = Math.floor(Date.now() / 1000);

  const rows = useMemo(
    () =>
      [...positions].sort((a, b) => {
        // Active grants first, then pending, then fully claimed.
        const aActive = a.account.claimedAmount < a.account.totalAmount ? 0 : 1;
        const bActive = b.account.claimedAmount < b.account.totalAmount ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return Number(a.account.endTime - b.account.endTime);
      }),
    [positions],
  );

  const columns: Array<TableColumn<VestingPositionWithPda>> = [
    {
      key: "recipient",
      header: "Recipient",
      cell: (row) => (
        <CopyableMono
          full={row.account.recipient.toBase58()}
          display={shortAddress(row.account.recipient.toBase58())}
          withExplorer
        />
      ),
    },
    {
      key: "mint",
      header: "Mint",
      cell: (row) => {
        const meta = pickMeta(metas, row.account.mint.toBase58());
        return (
          <span className={styles.tokenCell}>
            <span className={styles.tokenSymbol}>{meta.symbol ?? "SPL"}</span>
            <CopyableMono
              full={row.account.mint.toBase58()}
              display={shortAddress(row.account.mint.toBase58())}
              tone="muted"
              withExplorer
            />
          </span>
        );
      },
    },
    {
      key: "progress",
      header: "Claimed",
      cell: (row) => {
        const meta = pickMeta(metas, row.account.mint.toBase58());
        return (
          <VestingProgress
            claimed={row.account.claimedAmount}
            total={row.account.totalAmount}
            decimals={meta.decimals}
          />
        );
      },
    },
    {
      key: "schedule",
      header: "Schedule",
      align: "end",
      cell: (row) => (
        <VestingSchedule
          start={Number(row.account.startTime)}
          cliff={Number(row.account.cliffTime)}
          end={Number(row.account.endTime)}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "end",
      cell: (row) => <VestingStatusBadge position={row.account} now={now} />,
    },
  ];

  return (
    <PageSection
      title="Vesting positions"
      description="Outstanding grants on `aeqi_vesting`. Recipients can claim the linearly-vested portion at any time after the cliff."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        ariaLabel="Vesting positions"
      />
    </PageSection>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Cells                                                               */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Inline utilization meter. Bar fill is driven by a CSS custom property
 * so the only dynamic styling is one width — keeps the design-system
 * audit happy (no inline color/tone hex).
 *
 * Budgets are denominated in USDC base units by convention (the only
 * mint the budget program initializes against today). We look up
 * decimals once per metas snapshot so utilization rows render with the
 * right scale even on localnet where the registry USDC mint differs.
 */
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LOCALNET_USDC = "BscBtSVDbZCzSHikQSwmCuszX4f4nbESdnfrFYkbv3F3";

function budgetDecimals(metas: TokenMetaMap): number {
  return metas[MAINNET_USDC]?.decimals ?? metas[LOCALNET_USDC]?.decimals ?? 6;
}

function BudgetUtilization({
  spent,
  amount,
  decimals,
}: {
  spent: bigint;
  amount: bigint;
  decimals: number;
}) {
  const spentNum = Number(spent);
  const totalNum = Number(amount);
  const pct = totalNum > 0 ? Math.min(100, (spentNum / totalNum) * 100) : 0;
  const fillStyle: CSSProperties = { width: `${pct}%` };
  return (
    <Stack gap="1" className={styles.utilization}>
      <div className={styles.utilizationMeta}>
        <span>
          {formatTokenAmount(spent, decimals)} / {formatTokenAmount(amount, decimals)}
        </span>
        <span>{formatNumber(pct, { maximumFractionDigits: 0 })}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={styles.utilizationTrack}
      >
        <div className={styles.utilizationFill} data-tone="accent" style={fillStyle} />
      </div>
    </Stack>
  );
}

function VestingProgress({
  claimed,
  total,
  decimals,
}: {
  claimed: bigint;
  total: bigint;
  decimals: number | null;
}) {
  const claimedNum = Number(claimed);
  const totalNum = Number(total);
  const pct = totalNum > 0 ? Math.min(100, (claimedNum / totalNum) * 100) : 0;
  const fillStyle: CSSProperties = { width: `${pct}%` };
  return (
    <Stack gap="1" className={styles.utilizationWide}>
      <div className={styles.utilizationMeta}>
        <span>
          {formatTokenAmount(claimed, decimals)} / {formatTokenAmount(total, decimals)}
        </span>
        <span>{formatNumber(pct, { maximumFractionDigits: 0 })}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={styles.utilizationTrack}
      >
        <div className={styles.utilizationFill} data-tone="success" style={fillStyle} />
      </div>
    </Stack>
  );
}

function VestingSchedule({ start, cliff, end }: { start: number; cliff: number; end: number }) {
  const fmt = (ts: number) => (ts === 0 ? "—" : formatMediumDate(new Date(ts * 1000)));
  return (
    <span className={styles.scheduleCell}>
      <span>
        {fmt(start)} → {fmt(end)}
      </span>
      {cliff > 0 && cliff !== start && <span>cliff {fmt(cliff)}</span>}
    </span>
  );
}

function VestingStatusBadge({
  position,
  now,
}: {
  position: VestingPositionWithPda["account"];
  now: number;
}) {
  const start = Number(position.startTime);
  const end = Number(position.endTime);
  const fullyClaimed = position.claimedAmount >= position.totalAmount && position.totalAmount > 0n;
  const milestone = position.fdvMilestoneUnlocked;

  if (fullyClaimed) {
    return (
      <Badge variant="success" dot>
        Claimed
      </Badge>
    );
  }
  if (milestone) {
    return (
      <Badge variant="success" dot>
        Unlocked
      </Badge>
    );
  }
  if (start === 0 || now < start) {
    return (
      <Badge variant="warning" dot>
        Pending
      </Badge>
    );
  }
  if (end > 0 && now >= end) {
    return (
      <Badge variant="success" dot>
        Fully vested
      </Badge>
    );
  }
  return (
    <Badge variant="info" dot>
      Vesting
    </Badge>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Shared helpers (exported for AssetsPage)                            */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Mono address cell with one-click clipboard + optional "open in
 * explorer" satellite link. The two affordances live side-by-side so
 * the operator can either copy the address into another tool or jump
 * straight to solana.fm. Both stop propagation so the row's
 * `onRowClick` (when present) is not triggered by the inner action.
 */
export function CopyableMono({
  full,
  display,
  mode,
  tone,
  withExplorer = false,
}: {
  full: string;
  display: string;
  mode?: "short" | "full";
  tone?: "muted";
  withExplorer?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(full);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className={styles.copyableRow}>
      <Tooltip content={copied ? "Copied" : "Copy"}>
        <span
          role="button"
          tabIndex={0}
          onClick={handleCopy}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleCopy(e);
          }}
          className={styles.copyable}
          data-mode={mode ?? "short"}
          data-tone={tone}
        >
          {display}
          {copied ? " ✓" : ""}
        </span>
      </Tooltip>
      {withExplorer && (
        <Tooltip content="Open in Solana explorer">
          <a
            href={explorerAddressUrl(full)}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.explorerLink}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open ${display} in Solana explorer`}
          >
            <Icon icon={ExternalLink} size="xs" />
          </a>
        </Tooltip>
      )}
    </span>
  );
}

function ExpiryCell({ expiry }: { expiry: number }) {
  // Expiry is a unix-seconds timestamp; 0 means "no expiry".
  if (expiry === 0) {
    return <span className={styles.mutedDash}>—</span>;
  }
  const date = new Date(expiry * 1000);
  const now = Date.now();
  const expired = date.getTime() <= now;
  const label = formatMediumDate(date);
  return expired ? (
    <Badge variant="warning" size="sm" dot>
      Expired {label}
    </Badge>
  ) : (
    <span className={styles.numCell}>{label}</span>
  );
}

export function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Convert raw token base units to a human-readable amount. When the
 * mint's decimals are unknown (no registry hit), fall back to the raw
 * base-unit string so we never silently misrender by assuming 6.
 */
export function formatTokenAmount(amount: bigint, decimals: number | null): string {
  if (decimals === null) return amount.toString();
  if (decimals === 0) return amount.toString();
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}

/**
 * Raw base units → floating-point human amount. Used only for USD
 * valuation arithmetic, never for display (display goes through
 * `formatTokenAmount` so we don't lose precision on large balances).
 */
export function rawToFloat(amount: bigint, decimals: number): number {
  if (decimals === 0) return Number(amount);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(amount / divisor);
  const frac = Number(amount % divisor) / Number(divisor);
  return whole + frac;
}

/** Symbols treated as USD stablecoins at par for valuation. */
export function isStableSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  return upper === "USDC" || upper === "USDT" || upper === "PYUSD" || upper === "USDS";
}

/**
 * Anchor maps Solana `u64` to bn.js — annotated as `bigint` in our
 * surfaces for ergonomics, but at runtime it's a `BN` instance. Convert
 * through `toString()` for arithmetic that genuinely needs a `bigint`.
 * Pass-through when already a bigint (tests + future BN-less call sites).
 */
export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value && typeof (value as { toString: () => string }).toString === "function") {
    return BigInt((value as { toString: () => string }).toString());
  }
  return BigInt(0);
}

/** Anchor returns `[u8; 32]` as either Uint8Array or number[] — normalize. */
export function bytesToHex(bytes: Uint8Array | number[]): string {
  const iter = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of iter) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Render a 32-byte sentinel ID. Many on-chain IDs are
 * `pad32(ascii_prefix)` — surface the ASCII prefix when present,
 * otherwise fall back to a truncated hex preview.
 */
export function bytesIdLabel(bytes: Uint8Array | number[]): string {
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
    return new TextDecoder("ascii").decode(arr.slice(0, asciiLen));
  }
  return `0x${bytesToHex(arr).slice(0, 12)}…`;
}

/* ────────────────────────────────────────────────────────────────── */
/* Budget detail modal                                                 */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Side-panel-style modal that exposes the full Budget record. Iter-2
 * surfaces the data the table compresses: full PDA + explorer link,
 * full budget/role IDs (the table renders pad32 ASCII prefix only),
 * grantor + parent budget chaining, raw spend numbers, and the
 * lifecycle posture (frozen / expiry).
 *
 * Spend history is intentionally not rendered — the platform indexer
 * does not feed back per-budget BudgetSpent events to the dashboard
 * yet, and synthesising one from `getSignaturesForAddress(pda)` would
 * be a separate quest. The footer note states that gap honestly.
 */
export function BudgetDetailModal({
  budget,
  metas,
  onClose,
}: {
  budget: BudgetAccountWithPda | null;
  metas: TokenMetaMap;
  onClose: () => void;
}) {
  if (!budget) {
    return <Modal open={false} onClose={onClose} title="Budget" children={null} />;
  }
  const acc = budget.account;
  const decimals = budgetDecimals(metas);
  // BN is the on-chain numeric (Anchor maps `u64` → bn.js); convert
  // through string into the bigint our formatter expects so we don't
  // bleed BN's runtime arithmetic into the type surface.
  const amountBI = toBigInt(acc.amount);
  const spentBI = toBigInt(acc.spent);
  const spentFmt = formatTokenAmount(spentBI, decimals);
  const totalFmt = formatTokenAmount(amountBI, decimals);
  const remainingRaw = amountBI - spentBI;
  const remaining = remainingRaw > BigInt(0) ? remainingRaw : BigInt(0);
  const remainingFmt = formatTokenAmount(remaining, decimals);
  const pct = amountBI > BigInt(0) ? Number((spentBI * BigInt(10000)) / amountBI) / 100 : 0;
  const idLabel = bytesIdLabel(acc.budgetId);
  const idHex = `0x${bytesToHex(acc.budgetId)}`;
  const roleLabel = bytesIdLabel(acc.targetRoleId);
  const parentHex = `0x${bytesToHex(acc.parentBudgetId)}`;
  const parentBytes =
    acc.parentBudgetId instanceof Uint8Array
      ? acc.parentBudgetId
      : Uint8Array.from(acc.parentBudgetId);
  const hasParent = Array.from(parentBytes).some((b) => b !== 0);

  return (
    <Modal open={true} onClose={onClose} title={`Budget · ${idLabel}`}>
      <Stack gap="4">
        <DetailField label="Budget ID">
          <CopyableMono full={idHex} display={idLabel} mode="short" />
        </DetailField>
        <DetailField label="Target role">
          <span className={styles.monoCell}>{roleLabel}</span>
        </DetailField>
        {hasParent && (
          <DetailField label="Parent budget">
            <CopyableMono full={parentHex} display={`${parentHex.slice(0, 14)}…`} mode="short" />
          </DetailField>
        )}
        <DetailField label="Budget PDA">
          <CopyableMono
            full={budget.publicKey.toBase58()}
            display={shortAddress(budget.publicKey.toBase58())}
            withExplorer
          />
        </DetailField>
        <DetailField label="Grantor">
          <CopyableMono
            full={acc.grantor.toBase58()}
            display={shortAddress(acc.grantor.toBase58())}
            withExplorer
          />
        </DetailField>
        <DetailField label="Allocation">
          <Stack gap="1">
            <span className={styles.numCell}>
              {spentFmt} / {totalFmt} USDC ·{" "}
              <span className={styles.mutedLabel}>
                {formatNumber(pct, { maximumFractionDigits: 1 })}%
              </span>
            </span>
            <span className={styles.modalDetailNote}>{remainingFmt} USDC remaining</span>
          </Stack>
        </DetailField>
        <DetailField label="Expiry">
          <ExpiryCell expiry={Number(acc.expiry)} />
        </DetailField>
        <DetailField label="Status">
          {acc.frozen ? (
            <Badge variant="warning" dot>
              Frozen
            </Badge>
          ) : (
            <Badge variant="success" dot>
              Active
            </Badge>
          )}
        </DetailField>
        <p className={styles.modalFooterNote}>
          Spend history is not surfaced here yet — per-budget BudgetSpent events are emitted
          on-chain but not fed back into the dashboard until the indexer rail lands.
        </p>
      </Stack>
    </Modal>
  );
}
