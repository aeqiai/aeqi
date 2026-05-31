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

import { SupplyDistributionArc } from "./SupplyDistributionArc";
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

type ProvisioningState =
  | { kind: "canonical"; label: string; tooltip: string }
  | { kind: "alt"; label: string; tooltip: string }
  | { kind: "pending"; label: string; tooltip: string }
  | { kind: "unknown"; label: string; tooltip: string };

/**
 * iter-11: classify the on-chain provisioning of the cap-table mint.
 *
 * Branches:
 *   - canonical: registry pubkey == derived PDA AND initialized != 0.
 *   - alt:       registry pubkey is set but ≠ derived PDA (alt mint
 *                path: bridged from a non-canonical PDA, or the registry
 *                still points to a legacy mint that hasn't been migrated).
 *   - pending:   registry pubkey present but `initialized` is 0 — the
 *                module account exists but `finalize` hasn't fired.
 *   - unknown:   no registry pubkey provided (older callers). Falls
 *                through to a quiet "Live" pill without claiming
 *                canonical-vs-alt.
 *
 * Pure helper; exported only for the test mirror inside the same file.
 */
function computeProvisioningState({
  derivedMint,
  registryMint,
  initialized,
}: {
  derivedMint: string;
  registryMint: string | null;
  initialized: number | undefined;
}): ProvisioningState {
  if (!registryMint) {
    return {
      kind: "unknown",
      label: "Live",
      tooltip: "Cap-table mint is reading on chain. Registry comparison unavailable in this view.",
    };
  }
  if (initialized === 0) {
    return {
      kind: "pending",
      label: "Not yet provisioned",
      tooltip:
        "Token module state exists but the on-chain mint hasn't been finalized yet. Finalize wires decimals + authorities and flips this pill to Live.",
    };
  }
  if (registryMint === derivedMint) {
    return {
      kind: "canonical",
      label: "Live · canonical",
      tooltip:
        "Registry mint matches the derived cap-table PDA. This COMPANY is on the canonical provisioning path.",
    };
  }
  return {
    kind: "alt",
    label: "Live · alt mint",
    tooltip: `Registry points to ${shortAddress(registryMint)}, which is not the canonical derived PDA. This COMPANY was provisioned through an alt path or migrated from a legacy mint.`,
  };
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
  /**
   * iter-5 supply distribution arc inputs. Surfaced beneath the
   * "Supply minted" MetricCard as a small concentric ring chart.
   * `topHolderAmount` is the largest single holder balance;
   * `vestingTotal` is the sum of TOTAL across every active vesting
   * position keyed to the mint. Both default to 0 (renders the ring's
   * track only) when the caller hasn't computed them.
   */
  topHolderAmount?: bigint;
  vestingTotal?: bigint;
  /**
   * iter-11: registry-side mint pubkey as recorded in `TokenModuleState`.
   * Compared against the derived cap-table-mint PDA to flag the
   * canonical-vs-alt provisioning state. Optional so older callers don't
   * have to pass it; when omitted the pill falls back to "Live" without
   * an alt-mint claim.
   */
  registryMintAddress?: string | null;
  /**
   * iter-11: registry `initialized` byte (`TokenModuleState.initialized`).
   * Token module sets this to 1 from `finalize`; the bridge writes the
   * record first and finalizes second, so a non-zero value means the
   * module is wired all the way through. When omitted the pill assumes
   * a live mint and skips the "not yet provisioned" branch.
   */
  registryInitialized?: number;
}

export function MintIdentitySection({
  mintAddress,
  supply,
  decimals,
  maxSupplyCap,
  mintAuthority,
  freezeAuthority,
  topHolderAmount = 0n,
  vestingTotal = 0n,
  registryMintAddress,
  registryInitialized,
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

  // iter-11: provisioning status pill. Three explicit states a Token-2022
  // cap-table mint can be in:
  //   - canonical:        registry pubkey == derived PDA, initialized.
  //   - alt mint:         registry pubkey points to a non-canonical PDA
  //                       (alt provisioning path / migrated module).
  //   - not yet seeded:   registry exists but `initialized` is still 0 —
  //                       finalize hasn't fired yet.
  // Honest fallback: when the caller didn't pass a registry pubkey we
  // can't tell canonical from alt, so render a quiet "Live" pill instead
  // of guessing. Keeps the surface truthful for older callers.
  const provisioning = computeProvisioningState({
    derivedMint: mintAddress,
    registryMint: registryMintAddress ?? null,
    initialized: registryInitialized,
  });

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
                {/* iter-11: provisioning status pill leads the badge row so
                    "is this thing actually wired up on chain?" is the
                    first read. The canonical/alt distinction matters when
                    diagnosing Companies that bridged through a legacy mint
                    path; the pending case matters when the bridge wrote
                    the registry but the finalize step never landed. */}
                <Tooltip content={provisioning.tooltip}>
                  <Badge
                    variant={
                      provisioning.kind === "canonical"
                        ? "success"
                        : provisioning.kind === "alt"
                          ? "warning"
                          : provisioning.kind === "pending"
                            ? "muted"
                            : "info"
                    }
                    size="sm"
                  >
                    {provisioning.label}
                  </Badge>
                </Tooltip>
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
              <span className="mint-identity__supplyValueRow">
                <span className="mint-identity__metricValue">
                  {formatBaseUnits(supply, decimals)}
                </span>
                <SupplyDistributionArc
                  supply={supply}
                  maxSupply={capBigint}
                  topHolderAmount={topHolderAmount}
                  vestingTotal={vestingTotal}
                />
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
