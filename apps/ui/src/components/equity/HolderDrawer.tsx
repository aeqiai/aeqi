/**
 * HolderDrawer — iter-4 functional gap: clicking a cap-table row (not
 * the row's ⋯ menu) opens a side-anchored drawer showing the holder's
 * full position, every vesting grant targeting them, and quick actions
 * that reuse the existing `EquityPrefillProvider` plumbing.
 *
 * Why a drawer not a modal: the cap table is investigative. Operators
 * scan rows, pop one open, scroll its detail, close, scan the next.
 * A centered modal hides the table and breaks that rhythm; a right-
 * anchored drawer preserves the column-of-rows context.
 *
 * Wire-up: re-uses the base `Modal` primitive with a `className` override
 * that re-anchors the surface to the right edge (see HolderDrawer.css).
 * That keeps the focus trap, escape-to-close, and scroll-lock behaviour
 * from the audited primitive — no parallel a11y story to maintain.
 *
 * Functional gap closed: prior iters could read the cap table but had
 * no read view of "who is this holder". The drawer surfaces:
 *   1. Holder address (copyable + explorer link).
 *   2. Holding metrics: balance, % of supply, token-account address.
 *   3. Vesting positions targeting this holder (from the page-level
 *      vesting list, filtered client-side by `account.recipient`),
 *      with per-position claimable, vested-vs-total progress, and a
 *      contribution-required badge when gated.
 *   4. Total claimable across all vesting positions for the holder.
 *   5. Quick actions — Mint more, Transfer to, Grant vesting — that
 *      use the existing prefill provider so the action lands on the
 *      pre-existing forms below the cap table (no duplicate form
 *      surface inside the drawer).
 *
 * No new API calls. All data is already loaded by `useEquity`.
 */
import { useMemo, useState } from "react";

import { Badge, Button, Modal, Tooltip } from "@/components/ui";
import { useEquityPrefill } from "@/components/equity/equityPrefillContext";
import { useHolderMintHistory } from "@/hooks/useHolderMintHistory";
import { formatShortDate } from "@/lib/i18n";
import type { TokenHolder, VestingPositionWithPda } from "@/solana";
import type { CurveTrade } from "./RecentTradesLog";

import "./HolderDrawer.css";

const SOLANA_CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as string | undefined) ?? "localnet-solana";

function explorerUrl(addr: string): string {
  if (SOLANA_CLUSTER === "mainnet" || SOLANA_CLUSTER === "mainnet-beta") {
    return `https://solana.fm/address/${addr}`;
  }
  return `https://solana.fm/address/${addr}?cluster=${SOLANA_CLUSTER}`;
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function holderMonogram(address: string): string {
  const cleaned = address.replace(/[^A-Za-z0-9]/g, "");
  if (cleaned.length === 0) return "—";
  return (cleaned.slice(0, 2) + cleaned.slice(-2)).toUpperCase();
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

function formatPercent(amount: bigint, total: bigint): string {
  if (total === 0n) return "—";
  const basisPoints = (amount * 10_000n) / total;
  const whole = basisPoints / 100n;
  const frac = basisPoints % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}%`;
}

function bnLikeToBigInt(value: bigint | { toString(): string } | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  return BigInt(value.toString());
}

function formatUnixTime(seconds: bigint): string {
  if (seconds === 0n) return "—";
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return "—";
  return formatShortDate(new Date(ms));
}

/**
 * Render a USDC quote amount (raw on-chain 6-decimal lamports) as a
 * compact human number. Trims trailing zeros; falls back to "0" when
 * the input rounds below the displayed precision. Mirrors how the
 * RecentTradesLog formats trade quote rows so the eye reads them as
 * the same kind of number.
 */
function formatLamports(amount: bigint): string {
  const decimals = 6;
  if (amount === 0n) return "0";
  const divisor = 10n ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  const integerStr = groupThousands(integerPart.toString());
  if (fractionalPart === 0n) return integerStr;
  const fracStr = fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${integerStr}.${fracStr.slice(0, 4)}` : integerStr;
}

/**
 * Mirror of on-chain `vested_amount_at` math. Returns vested amount at
 * `now`. Conservative — treats unset schedules as "fully claimed".
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
  return (totalAmount * (now - startTime)) / (endTime - startTime);
}

export interface HolderDrawerProps {
  /** Holder being inspected. `null` keeps the drawer closed. */
  holder: TokenHolder | null;
  totalSupply: bigint;
  decimals: number;
  /** All vesting positions for the cap-table mint (filtered client-side here). */
  vestingPositions: VestingPositionWithPda[];
  /**
   * Iter-7: monotonic tick from `useEquityVesting`. The hook bumps this
   * after every Claim settles so the drawer's "Claimable now" rollup
   * recomputes against fresh claimed_amount values. Without the tick,
   * stale-while-revalidate cache hits would return the same positions
   * array reference and skip the rollup memo.
   */
  vestingTick?: number;
  /**
   * All recent curve trades projected by the indexer (full page-level
   * list). The drawer filters to trades whose counterparty matches the
   * inspected holder. Empty / unset is rendered as a quiet empty state.
   */
  recentTrades?: CurveTrade[];
  /** True when this drawer is mounted but the cap-table is hidden behind it. */
  onClose(): void;
}

export function HolderDrawer({
  holder,
  totalSupply,
  decimals,
  vestingPositions,
  vestingTick = 0,
  recentTrades = [],
  onClose,
}: HolderDrawerProps) {
  const { mintTo, transferTo, vestingRecipient } = useEquityPrefill();
  const [copied, setCopied] = useState(false);
  // Iter-10: snapshot copy feedback. Distinct from `copied` (which
  // tracks the address-only copy on the hero row) so the two affordances
  // can confirm independently.
  const [snapshotCopied, setSnapshotCopied] = useState<"json" | "csv" | null>(null);

  const ownerAddress = holder?.owner.toBase58() ?? "";
  const tokenAccountAddress = holder?.tokenAccount.toBase58() ?? "";

  // Filter the page-wide vesting list down to "positions paying this
  // holder". Sorted soonest-vesting-end first so the row at the top of
  // the drawer is the one that matters most for "what's claimable next".
  const targeting = useMemo(() => {
    if (!holder) return [] as VestingPositionWithPda[];
    return [...vestingPositions]
      .filter((p) => p.account.recipient.equals(holder.owner))
      .sort((a, b) => {
        const ae = bnLikeToBigInt(a.account.endTime);
        const be = bnLikeToBigInt(b.account.endTime);
        if (ae !== be) return ae < be ? -1 : 1;
        return 0;
      });
  }, [holder, vestingPositions]);

  // Iter-7: rebind `now` on every vestingTick bump. A successful Claim
  // shifts the on-chain claimed_amount, so the rollup line must
  // recompute against a freshly-stamped clock rather than the mount-time
  // snapshot. The cost is one BigInt allocation per refresh — cheap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => BigInt(Math.floor(Date.now() / 1000)), [vestingTick]);

  // iter-5: per-holder activity stream. Filter the page-wide curve
  // trades down to "trades where this holder is the counterparty". For
  // a buy that means the holder acquired LAUNCH from the curve; for a
  // sell they returned LAUNCH to the reserve. Top 8 most recent rows so
  // the drawer stays scannable.
  const holderTrades = useMemo(() => {
    if (!holder) return [] as CurveTrade[];
    const owner = holder.owner.toBase58();
    return recentTrades.filter((t) => t.counterparty_b58 === owner).slice(0, 8);
  }, [holder, recentTrades]);

  // Iter-8 functional gap: on-chain mint + transfer-in history for this
  // ATA. The hook reads `getSignaturesForAddress(tokenAccount)` and
  // pattern-matches SPL/Token-2022 `mintTo[Checked]` /
  // `transfer[Checked]` instructions whose destination equals the
  // inspected ATA. RQ-keyed per signature so paging back through
  // multiple holders reuses warm decodes. `tokenAccount` flips null
  // when the drawer is closed, which disables both queries.
  const mintHistory = useHolderMintHistory(holder ? tokenAccountAddress : null);
  const inflowRows = mintHistory.rows.slice(0, 8);

  // Roll-up: total vesting granted (whether vested or not) + total
  // claimable RIGHT NOW across every position that targets this holder.
  // The "vested total" line is what the page-wide cap-table column does
  // NOT show (cap-table only knows balance) — surfacing it here makes the
  // drawer worth opening.
  const rollup = useMemo(() => {
    let totalGranted = 0n;
    let totalClaimable = 0n;
    let totalClaimed = 0n;
    for (const p of targeting) {
      const total = bnLikeToBigInt(p.account.totalAmount);
      const claimed = bnLikeToBigInt(p.account.claimedAmount);
      const vested = vestedAt(
        total,
        claimed,
        bnLikeToBigInt(p.account.startTime),
        bnLikeToBigInt(p.account.cliffTime),
        bnLikeToBigInt(p.account.endTime),
        Boolean(p.account.fdvMilestoneUnlocked),
        now,
      );
      const contributionRequired = bnLikeToBigInt(p.account.contributionRequired) > 0n;
      const contributionPaid = Boolean(p.account.contributionPaid);
      const gated = contributionRequired && !contributionPaid;
      totalGranted += total;
      totalClaimed += claimed;
      if (!gated && vested > claimed) totalClaimable += vested - claimed;
    }
    return { totalGranted, totalClaimable, totalClaimed };
  }, [targeting, now]);

  // Iter-10: full-holder snapshot. JSON shape covers everything the
  // drawer currently surfaces — balance, % of supply, token account,
  // vesting roll-up + per-position breakdown, recent on-chain activity,
  // and mint-history rows. Useful for due-diligence sharing where the
  // recipient needs the holder's complete state at a point in time. All
  // values are on-chain public data (no PII concerns).
  //
  // Two output shapes:
  //   - JSON: full nested structure, the default. Easy to diff, easy to
  //     re-render in another tool.
  //   - CSV: flat tabular shape — one section per logical block, blank
  //     line separator. Sufficient for "paste into a spreadsheet to
  //     reconcile against an off-chain investor list".
  //
  // Build once when the drawer renders (cheap), copy on click.
  const snapshot = useMemo(() => {
    if (!holder) return null;
    const positions = targeting.map((p, idx) => {
      const total = bnLikeToBigInt(p.account.totalAmount);
      const claimed = bnLikeToBigInt(p.account.claimedAmount);
      const vested = vestedAt(
        total,
        claimed,
        bnLikeToBigInt(p.account.startTime),
        bnLikeToBigInt(p.account.cliffTime),
        bnLikeToBigInt(p.account.endTime),
        Boolean(p.account.fdvMilestoneUnlocked),
        now,
      );
      const claimable = vested > claimed ? vested - claimed : 0n;
      const contributionRequired = bnLikeToBigInt(p.account.contributionRequired) > 0n;
      const contributionPaid = Boolean(p.account.contributionPaid);
      return {
        index: idx + 1,
        position_pda: p.publicKey.toBase58(),
        total: formatBaseUnits(total, decimals),
        claimed: formatBaseUnits(claimed, decimals),
        vested: formatBaseUnits(vested, decimals),
        claimable: formatBaseUnits(claimable, decimals),
        start_time: bnLikeToBigInt(p.account.startTime).toString(),
        cliff_time: bnLikeToBigInt(p.account.cliffTime).toString(),
        end_time: bnLikeToBigInt(p.account.endTime).toString(),
        end_human: formatUnixTime(bnLikeToBigInt(p.account.endTime)),
        contribution_required: contributionRequired,
        contribution_paid: contributionPaid,
        fdv_milestone_unlocked: Boolean(p.account.fdvMilestoneUnlocked),
      };
    });
    const curveActivity = holderTrades.map((t) => {
      let tokenAmount: bigint;
      let quoteAmount: bigint;
      try {
        tokenAmount = BigInt(t.token_amount);
        quoteAmount = BigInt(t.quote_amount);
      } catch {
        tokenAmount = 0n;
        quoteAmount = 0n;
      }
      return {
        kind: t.kind,
        token_amount: formatBaseUnits(tokenAmount, decimals),
        quote_amount_usdc: formatLamports(quoteAmount),
        signature: t.signature_b58,
      };
    });
    const mintRows = inflowRows.map((r) => ({
      kind: r.kind,
      amount: r.amount === null ? null : formatBaseUnits(r.amount, decimals),
      source: r.kind === "transfer-in" ? (r.source ?? null) : null,
      slot: r.slot,
      block_time: r.blockTime,
      signature: r.signature,
    }));
    return {
      generated_at_iso: new Date().toISOString(),
      holder: ownerAddress,
      token_account: tokenAccountAddress,
      balance: formatBaseUnits(holder.amount, decimals),
      balance_base_units: holder.amount.toString(),
      decimals,
      percent_of_supply: formatPercent(holder.amount, totalSupply),
      total_supply_base_units: totalSupply.toString(),
      vesting_summary: {
        position_count: targeting.length,
        total_granted: formatBaseUnits(rollup.totalGranted, decimals),
        total_claimed: formatBaseUnits(rollup.totalClaimed, decimals),
        total_claimable_now: formatBaseUnits(rollup.totalClaimable, decimals),
      },
      vesting_positions: positions,
      recent_curve_activity: curveActivity,
      mint_history: mintRows,
    };
  }, [
    holder,
    targeting,
    holderTrades,
    inflowRows,
    rollup.totalGranted,
    rollup.totalClaimed,
    rollup.totalClaimable,
    now,
    decimals,
    totalSupply,
    ownerAddress,
    tokenAccountAddress,
  ]);

  const handleCopySnapshotJson = () => {
    if (!snapshot) return;
    const text = JSON.stringify(snapshot, null, 2);
    void navigator.clipboard.writeText(text);
    setSnapshotCopied("json");
    window.setTimeout(() => setSnapshotCopied(null), 1800);
  };
  const handleCopySnapshotCsv = () => {
    if (!snapshot) return;
    const lines: string[] = [];
    lines.push("# aeqi holder snapshot");
    lines.push(`generated_at_iso,${snapshot.generated_at_iso}`);
    lines.push(`holder,${snapshot.holder}`);
    lines.push(`token_account,${snapshot.token_account}`);
    lines.push(`balance,${snapshot.balance}`);
    lines.push(`percent_of_supply,${snapshot.percent_of_supply}`);
    lines.push("");
    lines.push("# vesting_positions");
    lines.push(
      "index,position_pda,total,claimed,vested,claimable,end_human,contribution_required,contribution_paid",
    );
    for (const p of snapshot.vesting_positions) {
      lines.push(
        [
          p.index,
          p.position_pda,
          p.total,
          p.claimed,
          p.vested,
          p.claimable,
          p.end_human,
          p.contribution_required,
          p.contribution_paid,
        ].join(","),
      );
    }
    lines.push("");
    lines.push("# recent_curve_activity");
    lines.push("kind,token_amount,quote_amount_usdc,signature");
    for (const t of snapshot.recent_curve_activity) {
      lines.push([t.kind, t.token_amount, t.quote_amount_usdc, t.signature].join(","));
    }
    lines.push("");
    lines.push("# mint_history");
    lines.push("kind,amount,source,slot,block_time,signature");
    for (const m of snapshot.mint_history) {
      lines.push(
        [m.kind, m.amount ?? "", m.source ?? "", m.slot, m.block_time ?? "", m.signature].join(","),
      );
    }
    void navigator.clipboard.writeText(lines.join("\n") + "\n");
    setSnapshotCopied("csv");
    window.setTimeout(() => setSnapshotCopied(null), 1800);
  };

  if (!holder) return null;

  const handleCopy = () => {
    void navigator.clipboard.writeText(ownerAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleMint = () => {
    mintTo(ownerAddress);
    onClose();
  };
  const handleTransfer = () => {
    transferTo(ownerAddress);
    onClose();
  };
  const handleVest = () => {
    vestingRecipient(ownerAddress);
    onClose();
  };

  return (
    <Modal open onClose={onClose} className="holder-drawer">
      <div className="holder-drawer__heroRow">
        <div className="holder-drawer__avatar" aria-hidden="true">
          {holderMonogram(ownerAddress)}
        </div>
        <div className="holder-drawer__heroBody">
          <div className="holder-drawer__label">Holder</div>
          <Tooltip content={copied ? "Copied" : "Copy address"}>
            <button
              type="button"
              className="holder-drawer__addressBtn"
              onClick={handleCopy}
              aria-label={`Copy address ${ownerAddress}`}
            >
              <span>{shortAddress(ownerAddress)}</span>
              {copied && <span className="holder-drawer__copied">✓</span>}
            </button>
          </Tooltip>
        </div>
      </div>
      <a
        className="holder-drawer__explorer"
        href={explorerUrl(ownerAddress)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open holder on Solana explorer"
      >
        <span aria-hidden="true">↗</span>
        <span>Explorer</span>
      </a>

      <div className="holder-drawer__section">
        <div className="holder-drawer__sectionLabel">Position</div>
        <div className="holder-drawer__metricGrid">
          <div className="holder-drawer__metric">
            <span className="holder-drawer__metricLabel">Balance</span>
            <span className="holder-drawer__metricValue">
              {formatBaseUnits(holder.amount, decimals)}
            </span>
          </div>
          <div className="holder-drawer__metric">
            <span className="holder-drawer__metricLabel">% of supply</span>
            <span className="holder-drawer__metricValue">
              {formatPercent(holder.amount, totalSupply)}
            </span>
          </div>
          <div className="holder-drawer__metric" style={{ gridColumn: "1 / -1" }}>
            <span className="holder-drawer__metricLabel">Token account</span>
            <Tooltip content={tokenAccountAddress}>
              <span className="holder-drawer__metricValue holder-drawer__metricValue--muted">
                {shortAddress(tokenAccountAddress)}
              </span>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="holder-drawer__section">
        <div className="holder-drawer__sectionLabel">
          Vesting targeting this holder · {targeting.length}
        </div>
        {targeting.length === 0 ? (
          <span className="holder-drawer__emptyVesting">No vesting positions pay this holder.</span>
        ) : (
          <>
            <div className="holder-drawer__metricGrid">
              <div className="holder-drawer__metric">
                <span className="holder-drawer__metricLabel">Total granted</span>
                <span className="holder-drawer__metricValue">
                  {formatBaseUnits(rollup.totalGranted, decimals)}
                </span>
              </div>
              <div className="holder-drawer__metric">
                <span className="holder-drawer__metricLabel">Claimable now</span>
                <span
                  className={
                    rollup.totalClaimable > 0n
                      ? "holder-drawer__metricValue holder-drawer__metricValue--success"
                      : "holder-drawer__metricValue holder-drawer__metricValue--muted"
                  }
                >
                  {formatBaseUnits(rollup.totalClaimable, decimals)}
                </span>
              </div>
            </div>
            <div className="holder-drawer__vestingList">
              {targeting.map((p, idx) => {
                const total = bnLikeToBigInt(p.account.totalAmount);
                const claimed = bnLikeToBigInt(p.account.claimedAmount);
                const vested = vestedAt(
                  total,
                  claimed,
                  bnLikeToBigInt(p.account.startTime),
                  bnLikeToBigInt(p.account.cliffTime),
                  bnLikeToBigInt(p.account.endTime),
                  Boolean(p.account.fdvMilestoneUnlocked),
                  now,
                );
                const claimable = vested > claimed ? vested - claimed : 0n;
                const contributionRequired = bnLikeToBigInt(p.account.contributionRequired) > 0n;
                const contributionPaid = Boolean(p.account.contributionPaid);
                const gated = contributionRequired && !contributionPaid;
                // Progress = vested / total, two-decimal precision so
                // freshly-cliffed positions show meaningful motion.
                const progressBps = total === 0n ? 0n : (vested * 10_000n) / total;
                const progressPct = Number(progressBps) / 100;
                return (
                  <div className="holder-drawer__vestingRow" key={p.publicKey.toBase58()}>
                    <div className="holder-drawer__vestingHead">
                      <span className="holder-drawer__vestingPos">
                        Position {idx + 1} · {shortAddress(p.publicKey.toBase58())}
                      </span>
                      {gated ? (
                        <Tooltip content="Recipient must pay the contribution before claims unlock.">
                          <Badge variant="warning" size="sm">
                            contribution
                          </Badge>
                        </Tooltip>
                      ) : (
                        <span
                          className={
                            claimable > 0n
                              ? "holder-drawer__vestingClaimable"
                              : "holder-drawer__vestingClaimable holder-drawer__vestingClaimable--muted"
                          }
                        >
                          {formatBaseUnits(claimable, decimals)} claimable
                        </span>
                      )}
                    </div>
                    <div
                      className="holder-drawer__progressTrack"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, Math.max(0, progressPct))}
                      aria-label="Vesting progress"
                    >
                      <div
                        className="holder-drawer__progressFill"
                        style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                      />
                    </div>
                    <div className="holder-drawer__vestingMeta">
                      <span>{formatBaseUnits(vested, decimals)} vested</span>
                      <span className="holder-drawer__vestingMetaSep">·</span>
                      <span>{formatBaseUnits(total, decimals)} total</span>
                      <span className="holder-drawer__vestingMetaSep">·</span>
                      <span>ends {formatUnixTime(bnLikeToBigInt(p.account.endTime))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="holder-drawer__section">
        <div className="holder-drawer__sectionLabel">
          Recent curve activity · {holderTrades.length}
        </div>
        {holderTrades.length === 0 ? (
          <span className="holder-drawer__emptyVesting">
            No recent buys or sells against the genesis curve by this holder.
          </span>
        ) : (
          <ul className="holder-drawer__activityList">
            {holderTrades.map((trade) => {
              let tokenAmount: bigint;
              let quoteAmount: bigint;
              try {
                tokenAmount = BigInt(trade.token_amount);
                quoteAmount = BigInt(trade.quote_amount);
              } catch {
                return null;
              }
              return (
                <li
                  className="holder-drawer__activityRow"
                  key={`${trade.signature_b58}-${trade.log_index}`}
                >
                  <span
                    className={
                      trade.kind === "buy"
                        ? "holder-drawer__activityDot holder-drawer__activityDot--buy"
                        : "holder-drawer__activityDot holder-drawer__activityDot--sell"
                    }
                    aria-hidden="true"
                  />
                  <span className="holder-drawer__activityKind">
                    {trade.kind === "buy" ? "Bought" : "Sold"}
                  </span>
                  <span className="holder-drawer__activityAmount">
                    {formatBaseUnits(tokenAmount, decimals)} LAUNCH
                  </span>
                  <span className="holder-drawer__activityQuote">
                    {formatLamports(quoteAmount)} USDC
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="holder-drawer__section">
        <div className="holder-drawer__sectionLabel">Mint history · {inflowRows.length}</div>
        {mintHistory.isLoading && !mintHistory.hasAny ? (
          <span className="holder-drawer__emptyVesting">Reading on-chain history…</span>
        ) : inflowRows.length === 0 ? (
          <span className="holder-drawer__emptyVesting">
            {mintHistory.isEmpty
              ? "No on-chain inflows touched this token account yet."
              : "No mints or inbound transfers in the recent signature tail."}
          </span>
        ) : (
          <ul className="holder-drawer__activityList">
            {inflowRows.map((row) => (
              <li
                className="holder-drawer__activityRow holder-drawer__activityRow--mint"
                key={`mint-${row.signature}`}
              >
                <span
                  className={
                    row.kind === "mint"
                      ? "holder-drawer__activityDot holder-drawer__activityDot--buy"
                      : "holder-drawer__activityDot holder-drawer__activityDot--mint"
                  }
                  aria-hidden="true"
                />
                <span className="holder-drawer__activityKind">
                  {row.kind === "mint" ? "Minted" : "Transfer in"}
                </span>
                <span className="holder-drawer__activityAmount">
                  {row.amount === null ? "—" : formatBaseUnits(row.amount, decimals)} LAUNCH
                </span>
                <span className="holder-drawer__activityQuote" title={row.signature}>
                  {row.kind === "transfer-in" && row.source
                    ? `from ${shortAddress(row.source)}`
                    : row.blockTime
                      ? formatShortDate(new Date(row.blockTime * 1000))
                      : `slot ${row.slot}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="holder-drawer__section">
        <div className="holder-drawer__sectionLabel">Quick actions</div>
        <div className="holder-drawer__actions">
          <Button variant="primary" size="sm" onClick={handleMint}>
            Mint more
          </Button>
          <Button variant="secondary" size="sm" onClick={handleTransfer}>
            Transfer to holder
          </Button>
          <Button variant="secondary" size="sm" onClick={handleVest}>
            Grant vesting
          </Button>
        </div>
      </div>

      <div className="holder-drawer__section">
        {/* Iter-10: full-holder snapshot copy. JSON is the canonical
            shape (preserves vesting structure); CSV is the spreadsheet-
            friendly variant for reconciling against off-chain investor
            lists. Both shapes carry exactly what's on screen — balance,
            vesting roll-up, per-position breakdown, recent on-chain
            activity, and mint history — at the moment of the click. */}
        <div className="holder-drawer__sectionLabel">Share snapshot</div>
        <p className="holder-drawer__snapshotHint">
          Copy everything this drawer shows — balance, vesting positions, on-chain activity — for
          due-diligence sharing.
        </p>
        <div className="holder-drawer__actions">
          <Button variant="secondary" size="sm" onClick={handleCopySnapshotJson}>
            {snapshotCopied === "json" ? "Copied JSON ✓" : "Copy as JSON"}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCopySnapshotCsv}>
            {snapshotCopied === "csv" ? "Copied CSV ✓" : "Copy as CSV"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
