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

import { lookupTokenMeta } from "@/solana";
import type { BudgetAccountWithPda, VestingPositionWithPda } from "@/solana/assets";
import { formatMediumDate, formatNumber } from "@/lib/i18n";
import { Badge, PageSection, Stack, Table, Tooltip, type TableColumn } from "@/components/ui";

import styles from "./AssetsPage.module.css";

/* ────────────────────────────────────────────────────────────────── */
/* Budgets section                                                     */
/* ────────────────────────────────────────────────────────────────── */

export function BudgetsSection({ budgets }: { budgets: BudgetAccountWithPda[] }) {
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
      cell: (row) => <BudgetUtilization spent={row.account.spent} amount={row.account.amount} />,
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
      description="Per-role allocations recorded on `aeqi_budget`. Spend caps are enforced on-chain."
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        ariaLabel="Active budgets"
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
export function VestingPositionsSection({ positions }: { positions: VestingPositionWithPda[] }) {
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
        />
      ),
    },
    {
      key: "mint",
      header: "Mint",
      cell: (row) => {
        const meta = lookupTokenMeta(row.account.mint);
        return (
          <span className={styles.tokenCell}>
            <span className={styles.tokenSymbol}>{meta.symbol ?? "Token"}</span>
            <span className={styles.tokenMintMono}>
              {shortAddress(row.account.mint.toBase58())}
            </span>
          </span>
        );
      },
    },
    {
      key: "progress",
      header: "Claimed",
      cell: (row) => {
        const meta = lookupTokenMeta(row.account.mint);
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
 */
function BudgetUtilization({ spent, amount }: { spent: bigint; amount: bigint }) {
  const spentNum = Number(spent);
  const totalNum = Number(amount);
  const pct = totalNum > 0 ? Math.min(100, (spentNum / totalNum) * 100) : 0;
  // Budgets are denominated in USDC base units by convention (the only
  // mint the budget program initializes against today); use that for
  // human-readable display so "Spent 250" doesn't surface as a giant
  // base-unit integer.
  const meta = lookupTokenMeta("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const decimals = meta.decimals ?? 6;
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

export function CopyableMono({
  full,
  display,
  mode,
}: {
  full: string;
  display: string;
  mode?: "short" | "full";
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
      >
        {display}
        {copied ? " ✓" : ""}
      </span>
    </Tooltip>
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

/** Anchor returns `[u8; 32]` as either Uint8Array or number[] — normalize. */
function bytesToHex(bytes: Uint8Array | number[]): string {
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
function bytesIdLabel(bytes: Uint8Array | number[]): string {
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
