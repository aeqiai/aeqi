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
import { formatShortDate } from "@/lib/i18n";
import type { TokenHolder, VestingPositionWithPda } from "@/solana";

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
  /** True when this drawer is mounted but the cap-table is hidden behind it. */
  onClose(): void;
}

export function HolderDrawer({
  holder,
  totalSupply,
  decimals,
  vestingPositions,
  onClose,
}: HolderDrawerProps) {
  const { mintTo, transferTo, vestingRecipient } = useEquityPrefill();
  const [copied, setCopied] = useState(false);

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

  const now = useMemo(() => BigInt(Math.floor(Date.now() / 1000)), []);

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
    </Modal>
  );
}
