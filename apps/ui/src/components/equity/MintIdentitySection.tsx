/**
 * MintIdentitySection — the first thing the Equity page renders.
 *
 * Iter-3 polish: the cap-table mint is the on-chain anchor for every
 * other section on the page (cap table, share controls, vesting, curve,
 * funding round). Iter-2 rendered it as a flat 4-row `DetailField` stack;
 * iter-3 promotes it to a hero block — a jade-tone token avatar derived
 * from the mint address, a copyable mint with an explorer link, and a
 * 3-column `MetricGrid` for supply / cap / decimals.
 *
 * Why the avatar: every "TOKEN" affordance in the codebase is currently
 * indistinguishable monotype text. Giving the cap-table mint a stable
 * visual identity (8 hex chars from the address driving the 12-char
 * monogram + accent ring) means Equity opens with something the eye can
 * recognise on return visits, not another DetailField soup.
 *
 * No new color tokens — the avatar leans on `--accent` and
 * `--color-card-subtle`; mono `--font-mono` for hex chars.
 */
import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Badge, MetricCard, MetricGrid, PageSection, Tooltip } from "@/components/ui";

import "./MintIdentitySection.css";

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

/**
 * Pluck a stable 4-character monogram out of the base58 mint address.
 * Capitalised since Token-2022 mints are case-sensitive base58 and
 * mixed-case monograms read worse at the avatar's tight character box.
 */
function mintMonogram(address: string): string {
  const cleaned = address.replace(/[^A-Za-z0-9]/g, "");
  if (cleaned.length === 0) return "T";
  // First 2 chars + last 2 chars — both ends of the base58 string are
  // distinct enough that visually-similar mints don't collide.
  const head = cleaned.slice(0, 2);
  const tail = cleaned.slice(-2);
  return (head + tail).toUpperCase();
}

function bnLikeToString(value: bigint | { toString(): string }): string {
  if (typeof value === "bigint") return value.toString();
  return value.toString();
}

/**
 * Format a raw base-unit amount with the given decimals into a
 * human-readable token quantity. Splits at the decimal place, groups
 * the integer part with thousands separators, and trims trailing zeros
 * in the fractional part so "100000000.000000000" renders as
 * "100,000,000".
 */
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

function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
}

/**
 * Compute % of cap used. Returns null when uncapped (cap == 0) so the
 * caller can render an "uncapped" badge instead of a percentage.
 */
function formatCapUsage(supply: bigint, cap: bigint): string | null {
  if (cap === 0n) return null;
  // basisPoints out of 10_000 → two-decimal percentage.
  const bps = (supply * 10_000n) / cap;
  const whole = bps / 100n;
  const frac = bps % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}%`;
}

export interface MintIdentitySectionProps {
  mintAddress: string;
  supply: bigint;
  decimals: number;
  maxSupplyCap: { toString(): string } | bigint;
  /**
   * Authority surfaces straight off the Token-2022 mint extension layer.
   * `null` is the meaningful state for both — the underlying SPL Token
   * convention is `mintAuthority === null` ↦ fixed-supply (no further
   * mints possible), `freezeAuthority === null` ↦ non-freezable
   * (account-freezes cannot be issued). Iter-4 surfaces them as badges
   * so operators can see the cap-table mint's static guarantees without
   * round-tripping to an explorer.
   */
  mintAuthority?: PublicKey | null;
  freezeAuthority?: PublicKey | null;
}

export function MintIdentitySection({
  mintAddress,
  supply,
  decimals,
  maxSupplyCap,
  mintAuthority,
  freezeAuthority,
}: MintIdentitySectionProps) {
  const [copied, setCopied] = useState(false);
  const capString = bnLikeToString(maxSupplyCap);
  const isUncapped = capString === "0";
  const capBigint = isUncapped ? 0n : BigInt(capString);
  const capUsage = isUncapped ? null : formatCapUsage(supply, capBigint);
  const monogram = mintMonogram(mintAddress);
  // `undefined` ↦ the caller didn't supply the field (older callers
  // pre-iter-4). Skip the badge row entirely in that case so we don't
  // emit a misleading "freezable" badge for an unknown authority state.
  const showAuthorities = mintAuthority !== undefined || freezeAuthority !== undefined;
  const isMintable = mintAuthority != null;
  const isFreezable = freezeAuthority != null;

  const handleCopy = () => {
    void navigator.clipboard.writeText(mintAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <PageSection title="Mint" description="The on-chain anchor for this cap table.">
      <div className="mint-identity">
        <div className="mint-identity__hero">
          <div
            className="mint-identity__avatar"
            aria-label={`Token avatar for ${shortAddress(mintAddress)}`}
          >
            <span className="mint-identity__monogram">{monogram}</span>
          </div>
          <div className="mint-identity__heroBody">
            <div className="mint-identity__label">Cap-table mint</div>
            <div className="mint-identity__addressRow">
              <Tooltip content={copied ? "Copied" : "Copy mint address"}>
                <button
                  type="button"
                  className="mint-identity__address"
                  onClick={handleCopy}
                  aria-label={`Copy mint address ${mintAddress}`}
                >
                  <span className="mint-identity__addressFull">{mintAddress}</span>
                  <span className="mint-identity__addressShort">{shortAddress(mintAddress)}</span>
                  {copied && <span className="mint-identity__copied">✓</span>}
                </button>
              </Tooltip>
              <a
                className="mint-identity__explorer"
                href={explorerUrl(mintAddress)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open mint on Solana explorer"
              >
                <span aria-hidden="true">↗</span>
                <span className="mint-identity__explorerLabel">Explorer</span>
              </a>
            </div>
            {showAuthorities && (
              <div className="mint-identity__badgeRow" aria-label="Mint authority flags">
                <Tooltip
                  content={
                    isMintable
                      ? "Mint authority is set — new tokens can still be issued."
                      : "Mint authority is null — supply is permanently fixed."
                  }
                >
                  <Badge variant={isMintable ? "info" : "muted"} size="sm">
                    {isMintable ? "mintable" : "fixed supply"}
                  </Badge>
                </Tooltip>
                <Tooltip
                  content={
                    isFreezable
                      ? "Freeze authority is set — token accounts can be frozen."
                      : "Freeze authority is null — accounts cannot be frozen."
                  }
                >
                  <Badge variant={isFreezable ? "warning" : "muted"} size="sm">
                    {isFreezable ? "freezable" : "non-freezable"}
                  </Badge>
                </Tooltip>
              </div>
            )}
          </div>
        </div>
        <MetricGrid columns={3}>
          <MetricCard
            label="Supply minted"
            value={
              <span className="mint-identity__metricValue">
                {formatBaseUnits(supply, decimals)}
              </span>
            }
            detail={capUsage !== null ? `${capUsage} of cap` : "Uncapped issuance"}
          />
          <MetricCard
            label="Max supply"
            value={
              isUncapped ? (
                <span className="mint-identity__metricValue mint-identity__metricValue--muted">
                  <Badge variant="muted" size="sm">
                    uncapped
                  </Badge>
                </span>
              ) : (
                <span className="mint-identity__metricValue">
                  {formatBaseUnits(capBigint, decimals)}
                </span>
              )
            }
            detail={isUncapped ? "No on-chain cap enforced" : "Hard cap at the mint level"}
          />
          <MetricCard
            label="Decimals"
            value={<span className="mint-identity__metricValue">{decimals}</span>}
            detail="Token-2022 fractional precision"
          />
        </MetricGrid>
      </div>
    </PageSection>
  );
}
