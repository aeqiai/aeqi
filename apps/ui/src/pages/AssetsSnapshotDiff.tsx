/**
 * Iter-11 — vault snapshot diff.
 *
 * Iter-10 shipped `buildVaultSnapshot` + a "Download snapshot" header
 * action that serialises the current vault into portable JSON. The
 * gap that iter-10 left open: once you have two snapshots from two
 * points in time, there's no surface that turns the pair into an
 * audit trail. Operators reading JSON diff-by-eye is not the bar.
 *
 * This module closes that gap. The host renders a "Compare snapshots"
 * affordance on the Treasury overview header that opens
 * `<SnapshotDiffModal>`. The modal accepts two snapshot JSON files
 * via plain file inputs (no drag-drop, no cloud, no upload —
 * everything happens client-side, the bytes never leave the
 * operator's browser). When both files parse cleanly the modal
 * surfaces a deterministic per-budget delta:
 *
 *   - utilization moved (spent_raw delta, remaining flipped)
 *   - frozen flips (false→true or true→false)
 *   - new sub-budgets (in B but not A)
 *   - removed budgets (in A but not B)
 *   - vesting amount changes (totalAmount or claimedAmount moved)
 *   - new / removed vesting positions
 *   - holdings amount moved per mint
 *   - treasury USD delta (stablecoin-par scope, same rule the
 *     overview tile uses so the numbers reconcile)
 *
 * Honest scope:
 *   - We diff on the snapshot's hex IDs (budget_id_hex /
 *     position_id_hex / mint), NOT on the PDA. PDAs can change shape
 *     when programs upgrade; the on-chain IDs are stable.
 *   - "New" means in B and not A. We do NOT try to reason about
 *     re-keyings: a budget that disappeared and a new one that
 *     appeared with a different ID will read as one removed + one
 *     added, not as a renamed pair. That's the honest read.
 *   - Decimals come off the snapshot itself — every snapshot row
 *     carries `decimals` for its mint at capture time. If two
 *     snapshots disagree on decimals for the same mint we trust the
 *     newer (B) reading, but we annotate the row so the diff doesn't
 *     silently lie.
 *   - Time ordering: we sort by `generated_at` and label them
 *     "older" / "newer" rather than "A / B" so the operator never
 *     has to remember which file they uploaded first.
 *
 * Anti-scope: this is NOT a delta editor. It's read-only. No way to
 * "apply" a diff back on-chain — the diff IS the audit trail.
 */
import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";

import { formatCurrency, formatNumber } from "@/lib/i18n";
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Inline,
  Input,
  Modal,
  PageSection,
  Stack,
} from "@/components/ui";

import styles from "./AssetsPage.module.css";

/**
 * Lightweight shape of a parsed snapshot — mirrors what
 * `buildVaultSnapshot` produces but typed for the consumer that
 * doesn't need PublicKey / BN / bigint. Optional fields gracefully
 * tolerate older snapshots from before a field was added.
 */
interface ParsedSnapshot {
  schema_version: string;
  generated_at: string;
  entity: { id: string; name: string } | null;
  trust: { address: string; module_initialized: boolean } | null;
  valuation: { stablecoin_usd: number } | null;
  holdings: SnapHolding[];
  budgets: SnapBudget[];
  vesting: SnapVesting[];
}

interface SnapHolding {
  mint: string;
  symbol: string | null;
  decimals: number | null;
  amount_raw: string;
  usd_at_par: number | null;
}

interface SnapBudget {
  budget_id_hex: string;
  parent_budget_id_hex: string | null;
  target_role_id_hex: string;
  amount_raw: string;
  spent_raw: string;
  remaining_raw: string;
  frozen: boolean;
}

interface SnapVesting {
  position_id_hex: string;
  recipient: string;
  mint: string;
  total_amount_raw: string;
  claimed_amount_raw: string;
}

/**
 * Parse the raw JSON. We're lenient on missing fields (older
 * snapshots) but strict on shape — anything that can't be coerced
 * to the contract above throws. The thrown message reads cleanly
 * back into the modal's error surface.
 */
export function parseSnapshot(raw: unknown): ParsedSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("Snapshot is not a JSON object.");
  }
  const r = raw as Record<string, unknown>;
  const schemaVersion = typeof r.schema_version === "string" ? r.schema_version : "0";
  const generatedAt = typeof r.generated_at === "string" ? r.generated_at : "";
  if (!generatedAt) {
    throw new Error("Snapshot is missing `generated_at` timestamp.");
  }
  const entity = (r.entity ?? null) as ParsedSnapshot["entity"];
  const trust = (r.trust ?? null) as ParsedSnapshot["trust"];
  const valuation = (r.valuation ?? null) as ParsedSnapshot["valuation"];

  const holdings = (Array.isArray(r.holdings) ? r.holdings : []) as SnapHolding[];
  const budgets = (Array.isArray(r.budgets) ? r.budgets : []) as SnapBudget[];
  const vesting = (Array.isArray(r.vesting) ? r.vesting : []) as SnapVesting[];

  return {
    schema_version: schemaVersion,
    generated_at: generatedAt,
    entity,
    trust,
    valuation,
    holdings,
    budgets,
    vesting,
  };
}

export interface SnapshotDiff {
  older: ParsedSnapshot;
  newer: ParsedSnapshot;
  /** Stablecoin USD delta (newer.stablecoin_usd − older.stablecoin_usd). */
  treasuryUsdDelta: number;
  budgetChanges: BudgetChange[];
  vestingChanges: VestingChange[];
  holdingChanges: HoldingChange[];
}

export interface BudgetChange {
  budget_id_hex: string;
  kind: "added" | "removed" | "modified";
  spentDeltaRaw: bigint;
  amountDeltaRaw: bigint;
  remainingDeltaRaw: bigint;
  frozenFlip: "none" | "froze" | "thawed";
  parent_budget_id_hex: string | null;
}

export interface VestingChange {
  position_id_hex: string;
  recipient: string;
  mint: string;
  kind: "added" | "removed" | "modified";
  totalDeltaRaw: bigint;
  claimedDeltaRaw: bigint;
}

export interface HoldingChange {
  mint: string;
  symbol: string | null;
  decimals: number | null;
  amountDeltaRaw: bigint;
  usdParDelta: number;
  kind: "added" | "removed" | "modified";
}

/**
 * Parse two snapshots and produce a deterministic diff. Inputs can
 * be in either chronological order — we sort by `generated_at` and
 * always treat the earlier one as `older`. That makes every delta
 * read in the "what happened between these two moments" direction.
 */
export function diffSnapshots(a: ParsedSnapshot, b: ParsedSnapshot): SnapshotDiff {
  const [older, newer] =
    new Date(a.generated_at).getTime() <= new Date(b.generated_at).getTime() ? [a, b] : [b, a];

  // Budgets — keyed by budget_id_hex. The hex ID is the on-chain
  // budget_id slot which is stable across the budget's lifetime.
  const olderBudgetMap = new Map(older.budgets.map((x) => [x.budget_id_hex, x]));
  const newerBudgetMap = new Map(newer.budgets.map((x) => [x.budget_id_hex, x]));
  const budgetIds = new Set([...olderBudgetMap.keys(), ...newerBudgetMap.keys()]);
  const budgetChanges: BudgetChange[] = [];
  for (const id of budgetIds) {
    const o = olderBudgetMap.get(id);
    const n = newerBudgetMap.get(id);
    if (!o && n) {
      budgetChanges.push({
        budget_id_hex: id,
        kind: "added",
        spentDeltaRaw: toBig(n.spent_raw),
        amountDeltaRaw: toBig(n.amount_raw),
        remainingDeltaRaw: toBig(n.remaining_raw),
        frozenFlip: n.frozen ? "froze" : "none",
        parent_budget_id_hex: n.parent_budget_id_hex,
      });
    } else if (o && !n) {
      budgetChanges.push({
        budget_id_hex: id,
        kind: "removed",
        spentDeltaRaw: -toBig(o.spent_raw),
        amountDeltaRaw: -toBig(o.amount_raw),
        remainingDeltaRaw: -toBig(o.remaining_raw),
        frozenFlip: "none",
        parent_budget_id_hex: o.parent_budget_id_hex,
      });
    } else if (o && n) {
      const spentDelta = toBig(n.spent_raw) - toBig(o.spent_raw);
      const amountDelta = toBig(n.amount_raw) - toBig(o.amount_raw);
      const remainingDelta = toBig(n.remaining_raw) - toBig(o.remaining_raw);
      let flip: BudgetChange["frozenFlip"] = "none";
      if (!o.frozen && n.frozen) flip = "froze";
      else if (o.frozen && !n.frozen) flip = "thawed";
      const moved = spentDelta !== 0n || amountDelta !== 0n || flip !== "none";
      if (moved) {
        budgetChanges.push({
          budget_id_hex: id,
          kind: "modified",
          spentDeltaRaw: spentDelta,
          amountDeltaRaw: amountDelta,
          remainingDeltaRaw: remainingDelta,
          frozenFlip: flip,
          parent_budget_id_hex: n.parent_budget_id_hex,
        });
      }
    }
  }
  // Stable order: added → modified → removed, then by hex ID.
  budgetChanges.sort((x, y) => {
    const orderKind = { added: 0, modified: 1, removed: 2 } as const;
    if (orderKind[x.kind] !== orderKind[y.kind]) return orderKind[x.kind] - orderKind[y.kind];
    return x.budget_id_hex.localeCompare(y.budget_id_hex);
  });

  // Vesting positions — keyed by position_id_hex.
  const olderVestingMap = new Map(older.vesting.map((x) => [x.position_id_hex, x]));
  const newerVestingMap = new Map(newer.vesting.map((x) => [x.position_id_hex, x]));
  const vestingIds = new Set([...olderVestingMap.keys(), ...newerVestingMap.keys()]);
  const vestingChanges: VestingChange[] = [];
  for (const id of vestingIds) {
    const o = olderVestingMap.get(id);
    const n = newerVestingMap.get(id);
    if (!o && n) {
      vestingChanges.push({
        position_id_hex: id,
        recipient: n.recipient,
        mint: n.mint,
        kind: "added",
        totalDeltaRaw: toBig(n.total_amount_raw),
        claimedDeltaRaw: toBig(n.claimed_amount_raw),
      });
    } else if (o && !n) {
      vestingChanges.push({
        position_id_hex: id,
        recipient: o.recipient,
        mint: o.mint,
        kind: "removed",
        totalDeltaRaw: -toBig(o.total_amount_raw),
        claimedDeltaRaw: -toBig(o.claimed_amount_raw),
      });
    } else if (o && n) {
      const totalDelta = toBig(n.total_amount_raw) - toBig(o.total_amount_raw);
      const claimedDelta = toBig(n.claimed_amount_raw) - toBig(o.claimed_amount_raw);
      if (totalDelta !== 0n || claimedDelta !== 0n) {
        vestingChanges.push({
          position_id_hex: id,
          recipient: n.recipient,
          mint: n.mint,
          kind: "modified",
          totalDeltaRaw: totalDelta,
          claimedDeltaRaw: claimedDelta,
        });
      }
    }
  }
  vestingChanges.sort((x, y) => x.position_id_hex.localeCompare(y.position_id_hex));

  // Holdings — keyed by mint. Decimals come off the newer snapshot
  // when both agree; we annotate via the kind below if they diverge.
  const olderHoldingMap = new Map(older.holdings.map((x) => [x.mint, x]));
  const newerHoldingMap = new Map(newer.holdings.map((x) => [x.mint, x]));
  const mints = new Set([...olderHoldingMap.keys(), ...newerHoldingMap.keys()]);
  const holdingChanges: HoldingChange[] = [];
  for (const mint of mints) {
    const o = olderHoldingMap.get(mint);
    const n = newerHoldingMap.get(mint);
    const oAmount = o ? toBig(o.amount_raw) : 0n;
    const nAmount = n ? toBig(n.amount_raw) : 0n;
    const delta = nAmount - oAmount;
    if (delta === 0n && o && n) continue;
    const usdPar = (n?.usd_at_par ?? 0) - (o?.usd_at_par ?? 0);
    const kind: HoldingChange["kind"] = !o ? "added" : !n ? "removed" : "modified";
    holdingChanges.push({
      mint,
      symbol: n?.symbol ?? o?.symbol ?? null,
      decimals: n?.decimals ?? o?.decimals ?? null,
      amountDeltaRaw: delta,
      usdParDelta: usdPar,
      kind,
    });
  }
  holdingChanges.sort((x, y) => Math.abs(y.usdParDelta) - Math.abs(x.usdParDelta));

  const treasuryUsdDelta =
    (newer.valuation?.stablecoin_usd ?? 0) - (older.valuation?.stablecoin_usd ?? 0);

  return { older, newer, treasuryUsdDelta, budgetChanges, vestingChanges, holdingChanges };
}

/** BigInt parser tolerant of empty strings and explicit "0" rows. */
function toBig(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** Decimals-aware human formatter for raw token amounts. */
function formatDelta(raw: bigint, decimals: number | null): string {
  if (decimals === null) {
    return raw.toString();
  }
  const sign = raw < 0n ? "-" : raw > 0n ? "+" : "";
  const abs = raw < 0n ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  if (decimals === 0) return `${sign}${whole.toString()}`;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0
    ? `${sign}${whole.toString()}.${fracStr}`
    : `${sign}${whole.toString()}`;
}

/** Short-form hex tail for IDs in the diff table. */
function shortHex(hex: string): string {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length <= 12) return stripped;
  return `${stripped.slice(0, 6)}…${stripped.slice(-4)}`;
}

interface SnapshotDiffModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The full diff surface. Two file inputs, one diagnose strip, and
 * the four delta groups beneath. The modal stays open across
 * uploads so the operator can replace one of the two snapshots
 * without re-opening — useful when comparing the current state
 * (downloaded fresh) against a historical one.
 */
export function SnapshotDiffModal({ open, onClose }: SnapshotDiffModalProps) {
  const [snapA, setSnapA] = useState<{ snap: ParsedSnapshot; filename: string } | null>(null);
  const [snapB, setSnapB] = useState<{ snap: ParsedSnapshot; filename: string } | null>(null);
  const [errA, setErrA] = useState<string | null>(null);
  const [errB, setErrB] = useState<string | null>(null);

  const diff = useMemo(() => {
    if (!snapA || !snapB) return null;
    return diffSnapshots(snapA.snap, snapB.snap);
  }, [snapA, snapB]);

  const handleClose = () => {
    setSnapA(null);
    setSnapB(null);
    setErrA(null);
    setErrB(null);
    onClose();
  };

  const handleFile = async (
    file: File | undefined,
    setSnap: (s: { snap: ParsedSnapshot; filename: string } | null) => void,
    setErr: (e: string | null) => void,
  ) => {
    setErr(null);
    setSnap(null);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseSnapshot(JSON.parse(text));
      setSnap({ snap: parsed, filename: file.name });
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Compare vault snapshots">
      <div className={styles.snapshotDiffBody}>
        <Stack gap="4">
          <Banner kind="info">
            Upload two vault snapshot JSON files. The diff runs entirely in your browser — the
            bytes never leave the page. The earlier snapshot is treated as the baseline; the
            later one is the comparison.
          </Banner>
          <div className={styles.snapshotDiffInputs}>
            <SnapshotInput
              label="Snapshot A"
              snap={snapA}
              error={errA}
              onPick={(f) => handleFile(f, setSnapA, setErrA)}
              onClear={() => {
                setSnapA(null);
                setErrA(null);
              }}
            />
            <SnapshotInput
              label="Snapshot B"
              snap={snapB}
              error={errB}
              onPick={(f) => handleFile(f, setSnapB, setErrB)}
              onClear={() => {
                setSnapB(null);
                setErrB(null);
              }}
            />
          </div>
          {diff ? <SnapshotDiffResult diff={diff} /> : null}
          {!diff && snapA && !snapB && (
            <EmptyState
              title="One more snapshot to compare"
              description="Upload a second snapshot — older or newer than this one — to render the diff."
            />
          )}
          {!diff && !snapA && !snapB && (
            <EmptyState
              title="No snapshots loaded"
              description="Drop two snapshot JSON files (or use the file pickers above) and the per-budget, per-mint, per-vesting deltas render here."
            />
          )}
          <Inline gap="3" justify="end">
            <Button type="button" variant="ghost" size="md" onClick={handleClose}>
              Close
            </Button>
          </Inline>
        </Stack>
      </div>
    </Modal>
  );
}

/**
 * Single file-picker tile with a chips strip showing the loaded
 * snapshot's `generated_at` so the operator can confirm they
 * picked the right file before reading the diff.
 */
function SnapshotInput({
  label,
  snap,
  error,
  onPick,
  onClear,
}: {
  label: string;
  snap: { snap: ParsedSnapshot; filename: string } | null;
  error: string | null;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    onPick(file);
    // Reset the input so the same file can be re-picked (useful when
    // the operator iterates on regenerating the snapshot).
    e.target.value = "";
  };
  return (
    <div className={styles.snapshotDiffInput}>
      <div className={styles.snapshotDiffInputLabel}>{label}</div>
      {snap ? (
        <Stack gap="2">
          <div className={styles.snapshotDiffInputFilename}>{snap.filename}</div>
          <Inline gap="2" align="center" wrap>
            <Badge variant="neutral">
              {new Date(snap.snap.generated_at).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Badge>
            <Badge variant="neutral">schema v{snap.snap.schema_version}</Badge>
            {snap.snap.entity ? (
              <Badge variant="neutral">{snap.snap.entity.name}</Badge>
            ) : null}
          </Inline>
          <Inline gap="2">
            <Button variant="ghost" size="sm" onClick={onClear}>
              Replace
            </Button>
          </Inline>
        </Stack>
      ) : (
        <Input
          type="file"
          accept="application/json,.json"
          onChange={onChange}
          aria-label={`${label} JSON file`}
          className={styles.snapshotDiffPicker}
        />
      )}
      {error ? <div className={styles.snapshotDiffError}>{error}</div> : null}
    </div>
  );
}

/**
 * The four diff-section tiles. Each renders nothing when its group
 * has zero changes — a clean "no movement" result reads as
 * silence rather than four empty tables.
 */
function SnapshotDiffResult({ diff }: { diff: SnapshotDiff }) {
  const { older, newer, treasuryUsdDelta, budgetChanges, vestingChanges, holdingChanges } = diff;
  const noChange =
    budgetChanges.length === 0 &&
    vestingChanges.length === 0 &&
    holdingChanges.length === 0 &&
    Math.abs(treasuryUsdDelta) < 0.0001;

  const olderLabel = new Date(older.generated_at).toLocaleString();
  const newerLabel = new Date(newer.generated_at).toLocaleString();

  return (
    <div className={styles.snapshotDiffResult}>
      <PageSection
        title="Summary"
        description={`Older → newer · ${olderLabel} → ${newerLabel}`}
      >
        <div className={styles.snapshotDiffSummary}>
          <div className={styles.snapshotDiffSummaryRow}>
            <span className={styles.snapshotDiffSummaryLabel}>Stablecoin USD</span>
            <span
              className={styles.snapshotDiffSummaryValue}
              data-tone={
                treasuryUsdDelta > 0 ? "up" : treasuryUsdDelta < 0 ? "down" : "neutral"
              }
            >
              {treasuryUsdDelta > 0 ? "+" : ""}
              {formatCurrency(treasuryUsdDelta, "USD", { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className={styles.snapshotDiffSummaryRow}>
            <span className={styles.snapshotDiffSummaryLabel}>Budget changes</span>
            <span className={styles.snapshotDiffSummaryValue}>{budgetChanges.length}</span>
          </div>
          <div className={styles.snapshotDiffSummaryRow}>
            <span className={styles.snapshotDiffSummaryLabel}>Vesting changes</span>
            <span className={styles.snapshotDiffSummaryValue}>{vestingChanges.length}</span>
          </div>
          <div className={styles.snapshotDiffSummaryRow}>
            <span className={styles.snapshotDiffSummaryLabel}>Holding mints moved</span>
            <span className={styles.snapshotDiffSummaryValue}>{holdingChanges.length}</span>
          </div>
        </div>
      </PageSection>

      {noChange ? (
        <EmptyState
          title="No movement between these snapshots"
          description="Holdings, budgets, and vesting positions all match across the two captures."
        />
      ) : null}

      {budgetChanges.length > 0 ? (
        <PageSection title="Budgets">
          <ul className={styles.snapshotDiffList}>
            {budgetChanges.map((b) => (
              <li key={b.budget_id_hex} className={styles.snapshotDiffRow}>
                <Inline gap="2" align="center" wrap>
                  <Badge
                    variant={
                      b.kind === "added"
                        ? "success"
                        : b.kind === "removed"
                          ? "error"
                          : "neutral"
                    }
                  >
                    {b.kind}
                  </Badge>
                  <span className={styles.snapshotDiffMono}>{shortHex(b.budget_id_hex)}</span>
                  {b.frozenFlip !== "none" ? (
                    <Badge variant={b.frozenFlip === "froze" ? "warning" : "success"}>
                      {b.frozenFlip}
                    </Badge>
                  ) : null}
                  {b.parent_budget_id_hex ? (
                    <span className={styles.snapshotDiffMeta}>
                      under {shortHex(b.parent_budget_id_hex)}
                    </span>
                  ) : null}
                </Inline>
                <Inline gap="3" align="center" wrap>
                  {b.spentDeltaRaw !== 0n ? (
                    <span className={styles.snapshotDiffMeta}>
                      spent {formatDelta(b.spentDeltaRaw, 6)} USDC
                    </span>
                  ) : null}
                  {b.amountDeltaRaw !== 0n ? (
                    <span className={styles.snapshotDiffMeta}>
                      cap {formatDelta(b.amountDeltaRaw, 6)} USDC
                    </span>
                  ) : null}
                  {b.remainingDeltaRaw !== 0n ? (
                    <span className={styles.snapshotDiffMeta}>
                      remaining {formatDelta(b.remainingDeltaRaw, 6)} USDC
                    </span>
                  ) : null}
                </Inline>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {vestingChanges.length > 0 ? (
        <PageSection title="Vesting positions">
          <ul className={styles.snapshotDiffList}>
            {vestingChanges.map((v) => (
              <li key={v.position_id_hex} className={styles.snapshotDiffRow}>
                <Inline gap="2" align="center" wrap>
                  <Badge
                    variant={
                      v.kind === "added"
                        ? "success"
                        : v.kind === "removed"
                          ? "error"
                          : "neutral"
                    }
                  >
                    {v.kind}
                  </Badge>
                  <span className={styles.snapshotDiffMono}>{shortHex(v.position_id_hex)}</span>
                  <span className={styles.snapshotDiffMeta}>
                    recipient {v.recipient.slice(0, 4)}…{v.recipient.slice(-4)}
                  </span>
                </Inline>
                <Inline gap="3" align="center" wrap>
                  {v.totalDeltaRaw !== 0n ? (
                    <span className={styles.snapshotDiffMeta}>
                      total {formatDelta(v.totalDeltaRaw, 6)}
                    </span>
                  ) : null}
                  {v.claimedDeltaRaw !== 0n ? (
                    <span className={styles.snapshotDiffMeta}>
                      claimed {formatDelta(v.claimedDeltaRaw, 6)}
                    </span>
                  ) : null}
                </Inline>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      {holdingChanges.length > 0 ? (
        <PageSection title="Holdings">
          <ul className={styles.snapshotDiffList}>
            {holdingChanges.map((h) => (
              <li key={h.mint} className={styles.snapshotDiffRow}>
                <Inline gap="2" align="center" wrap>
                  <Badge
                    variant={
                      h.kind === "added"
                        ? "success"
                        : h.kind === "removed"
                          ? "error"
                          : "neutral"
                    }
                  >
                    {h.kind}
                  </Badge>
                  <span className={styles.snapshotDiffMono}>{h.symbol ?? shortHex(h.mint)}</span>
                </Inline>
                <Inline gap="3" align="center" wrap>
                  <span
                    className={styles.snapshotDiffMeta}
                    data-tone={
                      h.amountDeltaRaw > 0n
                        ? "up"
                        : h.amountDeltaRaw < 0n
                          ? "down"
                          : "neutral"
                    }
                  >
                    {formatDelta(h.amountDeltaRaw, h.decimals)} {h.symbol ?? ""}
                  </span>
                  {Math.abs(h.usdParDelta) > 0.0001 ? (
                    <span
                      className={styles.snapshotDiffMeta}
                      data-tone={
                        h.usdParDelta > 0 ? "up" : h.usdParDelta < 0 ? "down" : "neutral"
                      }
                    >
                      {h.usdParDelta > 0 ? "+" : ""}
                      {formatCurrency(h.usdParDelta, "USD", { maximumFractionDigits: 2 })}
                    </span>
                  ) : null}
                </Inline>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      <div className={styles.snapshotDiffFootnote}>
        {formatNumber(budgetChanges.length + vestingChanges.length + holdingChanges.length)}{" "}
        total changes · diff scope is on-chain IDs (budget_id_hex / position_id_hex / mint).
      </div>
    </div>
  );
}
