/**
 * Iter-8 — Treasury alerts banner.
 *
 * Surfaces inline amber Banners above the Treasury overview when the
 * read state of the TRUST suggests an operator needs to act:
 *
 *   1. Over-allocated budgets — the sum of every active budget's
 *      remaining-allocation exceeds the current priced (stablecoin)
 *      treasury value. The on-chain `aeqi_budget` program does NOT
 *      enforce a treasury-level cap (each budget is allocated against
 *      a virtual amount the grantor set at create time); the alert is
 *      the off-chain signal that the TRUST has promised more than it
 *      can deliver.
 *   2. Vesting positions blocked by missing contribution — every
 *      VestingPosition with `contributionRequired > 0` AND
 *      `contributionPaid == false` is currently unclaimable, even after
 *      the cliff. Operators with outstanding grants need to see the
 *      blocker before the recipient asks why a claim failed.
 *   3. 24h holdings drop — when the decoded vault activity in the last
 *      24h shows net stablecoin outflows >10% of current treasury,
 *      we surface a "treasury USD down >10% in 24h" alert. We compute
 *      the delta off decoded SPL transfers (stablecoin only at par) so
 *      the percentage stays honest — unpriced mints can't move the
 *      signal.
 *
 * Each alert renders as its own Banner; the section is hidden entirely
 * when no condition fires (no empty wrappers above the overview tile).
 *
 * Honest scope:
 *   - Each computation runs off the already-fetched hooks (`useAssets`
 *     for holdings + budgets + vesting, `useDecodedVaultActivity` for
 *     flows). No additional RPC.
 *   - Over-allocation only counts active (non-frozen, non-expired)
 *     budgets — a frozen budget that exceeds treasury value is
 *     intentionally parked.
 *   - The 24h delta is a stablecoin-only signal — SPL governance or
 *     AEQI-issued mints with no price contribute nothing to either
 *     numerator or denominator.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import type { DecodedActivity } from "@/hooks/useDecodedVaultActivity";
import type { BudgetAccountWithPda, VaultHolding, VestingPositionWithPda } from "@/solana/assets";
import { formatCurrency, formatInteger, formatNumber } from "@/lib/i18n";
import { Banner, IconButton, Stack } from "@/components/ui";

import { isStableSymbol, rawToFloat, type TokenMetaMap } from "./AssetsSections";
import styles from "./AssetsPage.module.css";

/** Iter-11: dismissal window. After dismissing an alert, we silence
 *  it for this many ms unless the underlying signal hash changes
 *  (e.g., the over-allocation amount shifts, the blocked-vesting
 *  count moves). 24 hours matches what the operator expects from
 *  "snooze for a day" without forcing us to add an explicit picker. */
const DISMISS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** localStorage key under which we stash per-alert dismissals.
 *  Keyed by alert kind + TRUST address (when available); the
 *  module scope is the Assets page so we don't shadow other pages'
 *  alert systems. */
const STORAGE_KEY = "aeqi:assets:alert-dismissals:v1";

interface DismissalRecord {
  /** Signal hash at dismissal time — if it changes the alert
   *  re-surfaces immediately regardless of the 24h window. */
  signal: string;
  /** ms-since-epoch when the alert was dismissed. */
  at: number;
}

/** Read the dismissal record for a given alert kind. Cheap enough
 *  to run on every render; localStorage is sync and the dataset is
 *  three keys max. */
function readDismissal(kind: string): DismissalRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, DismissalRecord>;
    return parsed[kind] ?? null;
  } catch {
    return null;
  }
}

function writeDismissal(kind: string, signal: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, DismissalRecord>) : {};
    parsed[kind] = { signal, at: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // localStorage may throw on private-mode browsers; failing the
    // dismissal silently is the right behaviour — operator just
    // sees the alert again next render, which is the safe default.
  }
}

/** Hook: returns whether the alert (identified by kind + current
 *  signal) is currently dismissed. Also exposes a `dismiss()` that
 *  writes through to localStorage. Re-runs whenever the signal
 *  changes — a moved signal blows past any existing dismissal. */
function useAlertDismissal(
  kind: string,
  signal: string | null,
): { dismissed: boolean; dismiss: () => void } {
  const [tick, setTick] = useState(0);
  const dismissed = useMemo(() => {
    if (!signal) return false;
    const record = readDismissal(kind);
    if (!record) return false;
    if (record.signal !== signal) return false;
    if (Date.now() - record.at > DISMISS_WINDOW_MS) return false;
    return true;
    // `tick` deliberately included so a `dismiss()` call triggers a
    // recompute on the next render without a stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, signal, tick]);

  const dismiss = useCallback(() => {
    if (!signal) return;
    writeDismissal(kind, signal);
    setTick((t) => t + 1);
  }, [kind, signal]);

  // When the signal changes (the underlying TRUST state moved), we
  // want to re-evaluate immediately. The useMemo above already does
  // that via the dependency list; this effect is just defensive
  // logging-equivalent (no log, no work) to make the dependency
  // explicit at the hook boundary.
  useEffect(() => {
    // intentionally empty — the memo dependency on `signal` is what
    // drives re-evaluation; the effect just documents the intent.
  }, [signal]);

  return { dismissed, dismiss };
}

/** Dismissible Banner wrapper — surface an X in the banner row that
 *  records a dismissal and removes the banner from the DOM. The
 *  underlying Banner primitive doesn't accept a dismiss action, so
 *  we layer one on via a positioned IconButton. */
function DismissibleBanner({
  kind,
  signal,
  storageKey,
  children,
}: {
  kind: "warning" | "info";
  signal: string;
  /** Stable identifier per alert kind — distinguishes
   *  over-allocation from vesting-blocked from flow-drop in the
   *  same localStorage namespace. */
  storageKey: string;
  children: React.ReactNode;
}) {
  const { dismissed, dismiss } = useAlertDismissal(storageKey, signal);
  if (dismissed) return null;
  return (
    <div className={styles.treasuryAlertRow}>
      <Banner kind={kind}>{children}</Banner>
      <IconButton
        size="sm"
        variant="ghost"
        onClick={dismiss}
        aria-label="Dismiss for 24h"
        title="Dismiss for 24 hours (or until the underlying signal changes)"
        className={styles.treasuryAlertDismiss}
      >
        <X size={14} strokeWidth={1.8} aria-hidden />
      </IconButton>
    </div>
  );
}

/** USDC base-unit scale used elsewhere on the Assets surface. Budgets
 *  are denominated in USDC by convention, so the same divisor lets us
 *  compare remaining-allocation to the priced stablecoin total. */
const QUOTE_DECIMALS = 6;

/** Threshold that triggers the 24h holdings-drop alert. A 10% net
 *  outflow of priced treasury in a single day is the line; below that
 *  the strip on the overview tile already surfaces the trend without
 *  needing a callout. */
const HOLDINGS_DROP_THRESHOLD = 0.1;

export function TreasuryAlertsBanner({
  holdings,
  budgets,
  vestingPositions,
  metas,
  decodedActivity,
}: {
  holdings: VaultHolding[];
  budgets: BudgetAccountWithPda[];
  vestingPositions: VestingPositionWithPda[];
  metas: TokenMetaMap;
  decodedActivity: DecodedActivity[];
}) {
  // Compute the priced (stablecoin-USD) treasury total — same shape as
  // the overview tile so the two surfaces stay consistent on what
  // "treasury value" means.
  const treasuryUsd = useMemo(() => {
    let total = 0;
    for (const h of holdings) {
      const meta = metas[h.mint.toBase58()];
      if (meta?.symbol && isStableSymbol(meta.symbol) && meta.decimals !== null) {
        total += rawToFloat(h.amount, meta.decimals);
      }
    }
    return total;
  }, [holdings, metas]);

  // Over-allocation: sum every active budget's remaining cap (amount -
  // spent). Frozen + expired budgets stay out of the numerator — they
  // can't spend anyway, so claiming "over-allocated" because of a
  // parked budget reads as a false positive.
  const nowSecs = Math.floor(Date.now() / 1000);
  const overAllocation = useMemo(() => {
    let promised = 0;
    let activeCount = 0;
    for (const b of budgets) {
      if (b.account.frozen) continue;
      const expiry = Number(b.account.expiry);
      if (expiry > 0 && expiry < nowSecs) continue;
      const amount = Number(b.account.amount);
      const spent = Number(b.account.spent);
      const remaining = Math.max(0, amount - spent);
      promised += remaining / Math.pow(10, QUOTE_DECIMALS);
      activeCount += 1;
    }
    if (activeCount === 0 || promised <= 0 || treasuryUsd <= 0) return null;
    if (promised <= treasuryUsd) return null;
    return {
      promised,
      treasuryUsd,
      activeCount,
      coveragePct: (treasuryUsd / promised) * 100,
    };
  }, [budgets, nowSecs, treasuryUsd]);

  // Vesting blockers: any unclaimed position with
  // `contributionRequired > 0 && !contributionPaid` is unclaimable.
  // Surface a single count; the Vesting section below already renders
  // per-row detail.
  const vestingBlocked = useMemo(() => {
    const blocked = vestingPositions.filter((p) => {
      const required = Number(p.account.contributionRequired);
      const paid = !!p.account.contributionPaid;
      const claimed =
        p.account.claimedAmount >= p.account.totalAmount && p.account.totalAmount > 0n;
      return required > 0 && !paid && !claimed;
    });
    if (blocked.length === 0) return null;
    return { count: blocked.length };
  }, [vestingPositions]);

  // 24h flow: sum decoded stablecoin deposit / withdraw events whose
  // block time is within the last 24h. Net outflow as a fraction of
  // current treasury is the signal we trip on.
  const flowDrop = useMemo(() => {
    if (treasuryUsd <= 0) return null;
    const since = nowSecs - 24 * 60 * 60;
    let inflow = 0;
    let outflow = 0;
    for (const row of decodedActivity) {
      if (row.blockTime === null || row.blockTime < since) continue;
      if (row.amount === null || row.mint === null) continue;
      const meta = metas[row.mint];
      if (!meta || !meta.symbol || meta.decimals === null) continue;
      if (!isStableSymbol(meta.symbol)) continue;
      const usd = rawToFloat(row.amount, meta.decimals);
      if (row.kind === "deposit") inflow += usd;
      else if (row.kind === "withdraw") outflow += usd;
    }
    const net = inflow - outflow;
    if (net >= 0) return null;
    // Reconstruct prior balance: today = treasuryUsd; yesterday ≈
    // treasuryUsd - net. Divide the absolute drop by the prior balance
    // to read the percentage move.
    const prior = treasuryUsd - net;
    if (prior <= 0) return null;
    const dropFrac = -net / prior;
    if (dropFrac < HOLDINGS_DROP_THRESHOLD) return null;
    return {
      pct: dropFrac * 100,
      outflowUsd: outflow,
      inflowUsd: inflow,
    };
  }, [decodedActivity, metas, nowSecs, treasuryUsd]);

  // Iter-11: signal hashes — when an alert's underlying numbers
  // move, the hash flips and any prior dismissal becomes stale. We
  // round to the integer / 1% boundary so a sub-cent jitter doesn't
  // resurface a freshly-dismissed alert.
  const overAllocSignal = overAllocation
    ? `oa:${Math.round(overAllocation.promised)}-${Math.round(overAllocation.treasuryUsd)}-${overAllocation.activeCount}`
    : null;
  const vestingBlockedSignal = vestingBlocked ? `vb:${vestingBlocked.count}` : null;
  const flowDropSignal = flowDrop
    ? `fd:${Math.round(flowDrop.pct)}-${Math.round(flowDrop.outflowUsd)}-${Math.round(flowDrop.inflowUsd)}`
    : null;

  if (!overAllocation && !vestingBlocked && !flowDrop) return null;

  return (
    <div className={styles.treasuryAlerts}>
      <Stack gap="2">
        {overAllocation && overAllocSignal && (
          <DismissibleBanner kind="warning" storageKey="over-allocation" signal={overAllocSignal}>
            Active budgets promise{" "}
            {formatCurrency(overAllocation.promised, "USD", { maximumFractionDigits: 2 })} across{" "}
            {formatInteger(overAllocation.activeCount)} role
            {overAllocation.activeCount === 1 ? "" : "s"} — priced treasury covers{" "}
            {formatNumber(overAllocation.coveragePct, { maximumFractionDigits: 1 })}% of the
            outstanding allocation.
          </DismissibleBanner>
        )}
        {vestingBlocked && vestingBlockedSignal && (
          <DismissibleBanner
            kind="warning"
            storageKey="vesting-blocked"
            signal={vestingBlockedSignal}
          >
            {formatInteger(vestingBlocked.count)} vesting position
            {vestingBlocked.count === 1 ? " is" : "s are"} blocked on a missing contribution gate —
            recipients can&apos;t claim until the contribution lands on the position.
          </DismissibleBanner>
        )}
        {flowDrop && flowDropSignal && (
          <DismissibleBanner kind="warning" storageKey="flow-drop" signal={flowDropSignal}>
            Priced treasury is down {formatNumber(flowDrop.pct, { maximumFractionDigits: 1 })}% in
            the last 24h —{" "}
            {formatCurrency(flowDrop.outflowUsd, "USD", { maximumFractionDigits: 2 })} out,{" "}
            {formatCurrency(flowDrop.inflowUsd, "USD", { maximumFractionDigits: 2 })} in across
            decoded stablecoin flows.
          </DismissibleBanner>
        )}
      </Stack>
    </div>
  );
}
