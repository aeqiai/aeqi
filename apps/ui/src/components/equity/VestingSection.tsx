/**
 * VestingSection — outstanding vesting positions tied to the cap-table
 * mint, with per-row claim affordance.
 *
 * Iter-3 functional gap: vesting positions could be granted, listed, and
 * read on-chain in iter-2, but recipients had nowhere to claim. The
 * on-chain `claim_vested` ix exists (programs/aeqi-vesting/src/lib.rs);
 * the platform-side `/api/solana/vesting-claim` route does NOT yet, so
 * the Claim button wires to an honest stub via `api.vestingClaim(...)`
 * which surfaces the missing route name when invoked. The button still
 * computes claimable amount client-side from the on-chain schedule so
 * the disabled/enabled state is meaningful TODAY.
 *
 * Claimable = vested_at(now) - claimed_amount, where vested_at follows
 * the on-chain math:
 *   - now < cliff_time         → 0
 *   - now >= end_time          → total_amount
 *   - cliff <= now < end       → total * (now - start) / (end - start)
 *   - fdv_milestone_unlocked   → total_amount (short-circuit)
 *
 * Contribution gate: positions with contribution_required > 0 AND
 * contribution_paid == false return 0 claimable regardless of vesting.
 * The row surfaces a "contribution required" badge so the operator
 * knows why Claim is disabled.
 *
 * Visual rules (per iter-3 brief):
 *   - jade-tone Claim button when claimable > 0 (success variant)
 *   - disabled grey Claim button when claimable == 0
 *   - result line under the row reflects success/error from the stub
 */
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  PageSection,
  Table,
  Tooltip,
} from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { formatShortDate } from "@/lib/i18n";
import type { VestingPositionWithPda } from "@/solana";
import { api } from "@/lib/api";

import { VestingScheduleChart } from "./VestingScheduleChart";
import "./VestingSection.css";

export interface VestingSectionProps {
  trustId: string;
  positions: VestingPositionWithPda[];
  decimals: number;
  /**
   * Iter-7: monotonic tick from `useEquityVesting`. Re-keys the `now`
   * memo so per-row Schedule charts reflow against a fresh clock after
   * a Claim settles. Without it, a successful claim leaves the chart
   * fill pinned to the old `now` until full remount.
   */
  refreshTick?: number;
  /**
   * Iter-7: called after a successful Claim. The page-level
   * `useEquityVesting.refresh()` invalidates the RQ vesting query so
   * the section + the HolderDrawer rollup re-fetch on the same beat.
   * Optional — standalone embeds keep the legacy claim-then-stale shape.
   */
  onClaimSettled?(): void;
}

function bnLikeToBigInt(value: bigint | { toString(): string } | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  return BigInt(value.toString());
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
}

function formatBaseUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return groupThousands(amount.toString());
  const divisor = 10n ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  const integerStr = groupThousands(integerPart.toString());
  if (fractionalPart === 0n) return integerStr;
  const fracStr = fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${integerStr}.${fracStr}` : integerStr;
}

function formatUnixTime(seconds: bigint): string {
  if (seconds === 0n) return "—";
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return "—";
  return formatShortDate(new Date(ms));
}

/** Hex-encode the 32-byte position_id for the claim stub payload. */
function positionIdHex(positionId: number[] | Uint8Array | undefined): string {
  if (!positionId) return "";
  const arr = positionId instanceof Uint8Array ? Array.from(positionId) : positionId;
  return (
    "0x" + arr.map((b) => (typeof b === "number" ? b : 0).toString(16).padStart(2, "0")).join("")
  );
}

/**
 * Mirror of on-chain `vested_amount_at` math. Returns the amount of the
 * grant that has vested at `now` (unix-seconds). Conservative: if any of
 * start/cliff/end are zero (uninitialised) we treat the position as
 * "schedule unset" and return claimed (so vested_diff = 0).
 */
function vestedAt(
  totalAmount: bigint,
  claimedAmount: bigint,
  startTime: bigint,
  cliffTime: bigint,
  endTime: bigint,
  fdvUnlocked: boolean,
  now: bigint,
): bigint {
  if (fdvUnlocked) return totalAmount;
  if (startTime === 0n || endTime === 0n || cliffTime === 0n) return claimedAmount;
  if (now < cliffTime) return 0n;
  if (now >= endTime) return totalAmount;
  if (endTime <= startTime) return totalAmount;
  // total * (now - start) / (end - start) — bigint integer math matches
  // the on-chain rounding.
  return (totalAmount * (now - startTime)) / (endTime - startTime);
}

interface RowState {
  result: { ok: boolean; message: string } | null;
  pending: boolean;
}

export function VestingSection({
  trustId,
  positions,
  decimals,
  refreshTick = 0,
  onClaimSettled,
}: VestingSectionProps) {
  // Sort by end_time asc so the soonest-to-fully-vest sits at the top.
  const rows = useMemo(
    () =>
      [...positions].sort((a, b) => {
        const ae = bnLikeToBigInt(a.account.endTime);
        const be = bnLikeToBigInt(b.account.endTime);
        if (ae !== be) return ae < be ? -1 : 1;
        return a.account.recipient.toBase58().localeCompare(b.account.recipient.toBase58());
      }),
    [positions],
  );

  // Per-row UI state for the Claim button — keyed by position pubkey so
  // multiple in-flight claims don't trample each other.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // iter-11: position-transfer modal state. Holds the row being
  // transferred + the operator-typed new recipient pubkey + per-modal
  // submission state. Only one transfer flows through the modal at a
  // time — the row-level "Transfer position" button opens the modal,
  // the modal owns submission.
  const [transferRow, setTransferRow] = useState<VestingPositionWithPda | null>(null);
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferResult, setTransferResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  // Iter-7: rebind `now` on every refreshTick bump from
  // `useEquityVesting`. The Schedule chart fill, claimable column, and
  // Claim-button disabled state all consume this `now`. Without the
  // rebind, a successful Claim would leave each row visually stale
  // (chart fill at old progress) until full remount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => BigInt(Math.floor(Date.now() / 1000)), [refreshTick]);

  // Iter-10: roll-up totals across every position in the section.
  //   - granted: sum(account.totalAmount)
  //   - vested:  sum(vested_at(now)) including FDV-unlock short-circuit
  //   - claimed: sum(account.claimedAmount)
  //   - claimable: sum(max(0, vested - claimed)) skipping contribution-gated
  //   - lockedRemaining: granted - vested (still under schedule)
  // Same on-chain math the per-row Claim column uses, so the totals line
  // reads "what the page is currently telling me, summed". Memoised on
  // (rows, now) so the section doesn't recompute on unrelated re-renders.
  const totals = useMemo(() => {
    let granted = 0n;
    let vested = 0n;
    let claimed = 0n;
    let claimable = 0n;
    for (const row of rows) {
      const total = bnLikeToBigInt(row.account.totalAmount);
      const claimedAmt = bnLikeToBigInt(row.account.claimedAmount);
      const vestedAmt = vestedAt(
        total,
        claimedAmt,
        bnLikeToBigInt(row.account.startTime),
        bnLikeToBigInt(row.account.cliffTime),
        bnLikeToBigInt(row.account.endTime),
        Boolean(row.account.fdvMilestoneUnlocked),
        now,
      );
      const contributionRequired = bnLikeToBigInt(row.account.contributionRequired) > 0n;
      const contributionPaid = Boolean(row.account.contributionPaid);
      const gated = contributionRequired && !contributionPaid;
      granted += total;
      claimed += claimedAmt;
      vested += vestedAmt;
      if (!gated && vestedAmt > claimedAmt) claimable += vestedAmt - claimedAmt;
    }
    const lockedRemaining = granted > vested ? granted - vested : 0n;
    return { granted, vested, claimed, claimable, lockedRemaining };
  }, [rows, now]);

  // iter-11: position-transfer modal handlers. Opening the modal seeds
  // a clean state so a previously-cancelled transfer doesn't leak its
  // pasted address into the next row's flow.
  const openTransfer = (row: VestingPositionWithPda) => {
    setTransferRow(row);
    setTransferRecipient("");
    setTransferResult(null);
    setTransferSubmitting(false);
  };

  const closeTransfer = () => {
    if (transferSubmitting) return;
    setTransferRow(null);
  };

  const recipientValid = (s: string) => {
    const trimmed = s.trim();
    return trimmed.length >= 32 && trimmed.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
  };

  const handleTransfer = async () => {
    if (!transferRow || !recipientValid(transferRecipient)) return;
    setTransferSubmitting(true);
    setTransferResult(null);
    try {
      const res = await api.vestingTransfer({
        entity_id: trustId,
        position_id: positionIdHex(transferRow.account.positionId),
        new_recipient_pubkey: transferRecipient.trim(),
      });
      setTransferResult({
        ok: true,
        message: `Transferred to ${res.new_recipient_b58.slice(0, 6)}…${res.new_recipient_b58.slice(-4)}`,
      });
      // Same refresh pattern as Claim — invalidates the shared vesting
      // cache so the section's row recipient + the page-level
      // HolderDrawer pick up the new owner without a manual reload.
      onClaimSettled?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTransferResult({ ok: false, message });
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleClaim = async (row: VestingPositionWithPda) => {
    const key = row.publicKey.toBase58();
    setRowStates((s) => ({ ...s, [key]: { result: null, pending: true } }));
    try {
      const res = await api.vestingClaim({
        entity_id: trustId,
        position_id: positionIdHex(row.account.positionId),
      });
      setRowStates((s) => ({
        ...s,
        [key]: {
          result: { ok: true, message: `Claimed ${res.claimed_delta}` },
          pending: false,
        },
      }));
      // Iter-7: refresh the shared vesting + holders caches so this
      // section's Schedule chart + the page-level HolderDrawer rollup
      // pick up the new claimed_amount without a manual reload.
      onClaimSettled?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRowStates((s) => ({
        ...s,
        [key]: { result: { ok: false, message }, pending: false },
      }));
    }
  };

  const columns: Array<TableColumn<VestingPositionWithPda>> = [
    {
      key: "recipient",
      header: "Recipient",
      cell: (row) => (
        <Tooltip content={row.account.recipient.toBase58()}>
          <span className="vesting-row__recipient">
            {shortAddress(row.account.recipient.toBase58())}
          </span>
        </Tooltip>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      cell: (row) => (
        <span className="vesting-row__num">
          {formatBaseUnits(bnLikeToBigInt(row.account.totalAmount), decimals)}
        </span>
      ),
    },
    {
      key: "claimed",
      header: "Claimed",
      align: "end",
      cell: (row) => (
        <span className="vesting-row__num">
          {formatBaseUnits(bnLikeToBigInt(row.account.claimedAmount), decimals)}
        </span>
      ),
    },
    {
      key: "schedule",
      header: "Schedule",
      cell: (row) => (
        <div className="vesting-row__chart">
          <VestingScheduleChart
            startTime={bnLikeToBigInt(row.account.startTime)}
            cliffTime={bnLikeToBigInt(row.account.cliffTime)}
            endTime={bnLikeToBigInt(row.account.endTime)}
            totalAmount={bnLikeToBigInt(row.account.totalAmount)}
            claimedAmount={bnLikeToBigInt(row.account.claimedAmount)}
            fdvMilestoneUnlocked={Boolean(row.account.fdvMilestoneUnlocked)}
            now={now}
          />
        </div>
      ),
    },
    {
      key: "claimable",
      header: "Claimable",
      align: "end",
      cell: (row) => {
        const total = bnLikeToBigInt(row.account.totalAmount);
        const claimed = bnLikeToBigInt(row.account.claimedAmount);
        const vested = vestedAt(
          total,
          claimed,
          bnLikeToBigInt(row.account.startTime),
          bnLikeToBigInt(row.account.cliffTime),
          bnLikeToBigInt(row.account.endTime),
          Boolean(row.account.fdvMilestoneUnlocked),
          now,
        );
        const claimable = vested > claimed ? vested - claimed : 0n;
        const contributionRequired = bnLikeToBigInt(row.account.contributionRequired) > 0n;
        const contributionPaid = Boolean(row.account.contributionPaid);
        const gated = contributionRequired && !contributionPaid;
        if (gated) {
          return (
            <Tooltip content="Recipient must pay the contribution before claims unlock.">
              <Badge variant="warning" size="sm">
                contribution
              </Badge>
            </Tooltip>
          );
        }
        return (
          <span
            className={
              claimable > 0n
                ? "vesting-row__num vesting-row__num--live"
                : "vesting-row__num vesting-row__num--muted"
            }
          >
            {formatBaseUnits(claimable, decimals)}
          </span>
        );
      },
    },
    {
      key: "endTime",
      header: "Ends",
      align: "end",
      cell: (row) => (
        <span className="vesting-row__num">
          {formatUnixTime(bnLikeToBigInt(row.account.endTime))}
        </span>
      ),
    },
    {
      key: "claim",
      header: "",
      align: "end",
      cell: (row) => {
        const key = row.publicKey.toBase58();
        const state = rowStates[key];
        const total = bnLikeToBigInt(row.account.totalAmount);
        const claimed = bnLikeToBigInt(row.account.claimedAmount);
        const vested = vestedAt(
          total,
          claimed,
          bnLikeToBigInt(row.account.startTime),
          bnLikeToBigInt(row.account.cliffTime),
          bnLikeToBigInt(row.account.endTime),
          Boolean(row.account.fdvMilestoneUnlocked),
          now,
        );
        const claimable = vested > claimed ? vested - claimed : 0n;
        const contributionRequired = bnLikeToBigInt(row.account.contributionRequired) > 0n;
        const contributionPaid = Boolean(row.account.contributionPaid);
        const gated = contributionRequired && !contributionPaid;
        const disabled = claimable === 0n || gated;
        // iter-11: transfer enabled when the position still has
        // remaining vesting obligation (granted > claimed). A fully-
        // claimed position has no future tokens left to rotate — the
        // recipient already collected everything, so transferring is a
        // no-op. Disable to communicate that clearly.
        const transferAvailable = total > claimed;
        return (
          <div className="vesting-row__claim">
            <Button
              variant={disabled ? "secondary" : "primary"}
              size="sm"
              disabled={disabled}
              loading={state?.pending === true}
              onClick={() => handleClaim(row)}
              className={
                !disabled ? "vesting-row__claimBtn vesting-row__claimBtn--live" : undefined
              }
            >
              Claim
            </Button>
            {/* iter-11: rotate the pending vesting position to a new
                recipient. Honest-stub today — the platform route does
                NOT exist yet, so the modal surfaces the missing-route
                error inline. The gesture is right; the wiring lands
                with the platform-side ix. */}
            <Button
              variant="secondary"
              size="sm"
              disabled={!transferAvailable}
              onClick={() => openTransfer(row)}
            >
              Transfer position
            </Button>
            {state?.result && (
              <span
                className={
                  state.result.ok
                    ? "vesting-row__result vesting-row__result--ok"
                    : "vesting-row__result vesting-row__result--err"
                }
                role="status"
              >
                {state.result.ok ? `✓ ${state.result.message}` : state.result.message}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PageSection
      title="Vesting"
      description={
        rows.length === 0
          ? "No vesting positions tied to this mint."
          : `${rows.length} ${rows.length === 1 ? "position" : "positions"} outstanding. Click Claim to release vested tokens to the recipient.`
      }
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        empty={
          <EmptyState
            title="No vesting positions"
            description="Vesting grants tied to the cap-table mint will appear here once issued."
          />
        }
        ariaLabel="Vesting positions"
      />
      {rows.length > 0 && (
        /* Iter-10: roll-up totals strip. Mirrors the cap-table "% of
           supply" column rhythm — tabular-nums, label-on-top, value-
           below. Five tiles: granted · vested · claimed · claimable now ·
           locked remaining. Helps the operator answer "how much
           obligation does this TRUST currently carry?" without summing
           rows by eye. */
        <div className="vesting-totals" role="group" aria-label="Vesting roll-up totals">
          <div className="vesting-totals__tile">
            <span className="vesting-totals__label">Granted</span>
            <span className="vesting-totals__value">
              {formatBaseUnits(totals.granted, decimals)}
            </span>
          </div>
          <div className="vesting-totals__tile">
            <span className="vesting-totals__label">Vested</span>
            <span className="vesting-totals__value">
              {formatBaseUnits(totals.vested, decimals)}
            </span>
          </div>
          <div className="vesting-totals__tile">
            <span className="vesting-totals__label">Claimed</span>
            <span className="vesting-totals__value">
              {formatBaseUnits(totals.claimed, decimals)}
            </span>
          </div>
          <div className="vesting-totals__tile">
            <span className="vesting-totals__label">Claimable now</span>
            <span
              className={
                totals.claimable > 0n
                  ? "vesting-totals__value vesting-totals__value--live"
                  : "vesting-totals__value vesting-totals__value--muted"
              }
            >
              {formatBaseUnits(totals.claimable, decimals)}
            </span>
          </div>
          <div className="vesting-totals__tile">
            <span className="vesting-totals__label">Locked remaining</span>
            <span className="vesting-totals__value">
              {formatBaseUnits(totals.lockedRemaining, decimals)}
            </span>
          </div>
        </div>
      )}
      {/* iter-11: transfer-position modal. Lifted to the section level
          so the row-level button only owns the open-state trigger; the
          submission surface, validation, and result lines live here. */}
      <Modal open={transferRow !== null} onClose={closeTransfer} title="Transfer vesting position">
        {transferRow && (
          <div className="vesting-transfer">
            <p className="vesting-transfer__hint">
              Rotate this vesting position to a new recipient. The schedule, total amount, and
              already-claimed balance stay the same — only the wallet that can claim future vested
              tokens changes. Trust authority signs.
            </p>
            <div className="vesting-transfer__meta">
              <div>
                <span className="vesting-transfer__label">Current recipient</span>
                <span className="vesting-transfer__value">
                  {shortAddress(transferRow.account.recipient.toBase58())}
                </span>
              </div>
              <div>
                <span className="vesting-transfer__label">Position</span>
                <span className="vesting-transfer__value">
                  {shortAddress(transferRow.publicKey.toBase58())}
                </span>
              </div>
              <div>
                <span className="vesting-transfer__label">Total</span>
                <span className="vesting-transfer__value">
                  {formatBaseUnits(bnLikeToBigInt(transferRow.account.totalAmount), decimals)}
                </span>
              </div>
              <div>
                <span className="vesting-transfer__label">Claimed</span>
                <span className="vesting-transfer__value">
                  {formatBaseUnits(bnLikeToBigInt(transferRow.account.claimedAmount), decimals)}
                </span>
              </div>
            </div>
            <label className="vesting-transfer__field">
              <span className="vesting-transfer__label">New recipient pubkey</span>
              <Input
                value={transferRecipient}
                onChange={(e) => setTransferRecipient(e.target.value)}
                disabled={transferSubmitting}
                placeholder="e.g. 3DvL…abc"
                aria-label="New recipient pubkey"
              />
            </label>
            {transferResult && (
              <div
                className={
                  transferResult.ok
                    ? "vesting-row__result vesting-row__result--ok"
                    : "vesting-row__result vesting-row__result--err"
                }
                role="status"
              >
                {transferResult.ok ? `✓ ${transferResult.message}` : transferResult.message}
              </div>
            )}
            <div className="vesting-transfer__actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={closeTransfer}
                disabled={transferSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleTransfer}
                disabled={!recipientValid(transferRecipient) || transferSubmitting}
                loading={transferSubmitting}
              >
                Transfer position
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </PageSection>
  );
}
