import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Shield, Copy, Check, Wallet, PieChart, Vote, FileText } from "lucide-react";
import { useAssets } from "@/hooks/useAssets";
import { useEquity } from "@/hooks/useEquity";
import { useQuorum } from "@/hooks/useQuorum";
import { useIncorporation } from "@/hooks/useIncorporation";
import { deriveProposalStatus, lookupTokenMeta } from "@/solana";

interface TrustOwnershipGroupProps {
  trustAddress: string | null | undefined;
  basePath: string;
}

/**
 * Programmable Ownership group. One header bar (TRUST address + signers
 * + smart contract chip) followed by a row of four primitive cards:
 * Assets, Equity, Quorum, Incorporation. Mirrors the Execution group's
 * shape — the symmetry is the design language.
 *
 * The on-chain identity strip that lived as its own row in v2 folds
 * into this header — address + signers = ownership identity, one beat.
 *
 * All cockpit signals are sourced from on-chain reads on Solana. The
 * EVM-era indexer (`fetchTrust(...).signersCount`, `useTreasury`) silently
 * returned null/zero against Solana TRUST PDAs — replaced here with
 * `useIncorporation` / `useAssets` / `useEquity` / `useQuorum` per the
 * `architecture/trust-6-surface-integration` matrix (ja-001.8).
 */
export default function TrustOwnershipGroup({ trustAddress, basePath }: TrustOwnershipGroupProps) {
  const [copied, setCopied] = useState(false);
  const copyAddress = () => {
    if (!trustAddress) return;
    navigator.clipboard.writeText(trustAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const assets = useAssets(trustAddress);
  const equity = useEquity(trustAddress);
  const quorum = useQuorum(trustAddress);
  const incorporation = useIncorporation(trustAddress);

  // Modules + roles are the constitutional building blocks; "signers"
  // in the header reads as the count of *initialized* modules, which is
  // the closest on-chain analogue to the EVM-era `signersCount` slot.
  // A non-zero `account.initialized` byte marks the module-state PDA as
  // wired up (see `programs/aeqi-trust/src/lib.rs` Module.initialized).
  const initializedModulesCount = useMemo(() => {
    if (!incorporation.modules) return null;
    return incorporation.modules.filter((m) => Boolean(m.account.initialized)).length;
  }, [incorporation.modules]);
  const rolesCount = incorporation.roles?.length ?? null;
  const modulesCount = incorporation.modules?.length ?? null;

  const holdersCount = equity.holders?.length ?? null;
  const hasToken = !!equity.tokenModuleState;
  const configsCount = quorum.configs?.length ?? null;
  // Open proposals = `active` status only. Status is derived client-side
  // from the proposal's lifecycle (executed/canceled flags + vote window).
  // When no GovernanceConfig is registered ("Founder-mode"), proposals
  // can't exist — show "—" rather than a misleading "0".
  const activeProposalsCount = useMemo(() => {
    if (!quorum.proposals) return null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return quorum.proposals.filter((p) => deriveProposalStatus(p.account, nowSeconds) === "active")
      .length;
  }, [quorum.proposals]);
  // Treasury USDC sum: walk the vault holdings, keep only the entries
  // whose mint resolves to a known USDC mint via `lookupTokenMeta`, sum
  // the raw amounts, and format using the registry-supplied decimals.
  // Localnet test-USDC isn't in the registry (mint address differs per
  // cluster), so "$— USDC" is the honest answer there.
  const treasuryUsdc = useMemo(() => {
    if (!assets.holdings) return null;
    let totalRaw: bigint = 0n;
    let decimals: number | null = null;
    for (const h of assets.holdings) {
      const meta = lookupTokenMeta(h.mint);
      if (meta.symbol !== "USDC") continue;
      totalRaw += h.amount;
      decimals = meta.decimals;
    }
    if (decimals === null) return null;
    return formatUsdc(totalRaw, decimals);
  }, [assets.holdings]);
  const trustOnchain = !!incorporation.trust;

  return (
    <section className="trust-group trust-group--ownership" aria-labelledby="own-eyebrow">
      <header className="trust-group-bar">
        <div className="trust-group-bar-left">
          <span className="trust-group-eyebrow" id="own-eyebrow">
            <Shield size={12} strokeWidth={1.8} />
            Programmable ownership
          </span>
          <div className="trust-group-bar-row">
            {trustAddress ? (
              <>
                <button
                  type="button"
                  className="trust-group-addr"
                  onClick={copyAddress}
                  title={copied ? "Copied" : "Click to copy"}
                >
                  <span>{compactAddress(trustAddress)}</span>
                  {copied ? (
                    <Check size={12} strokeWidth={1.8} />
                  ) : (
                    <Copy size={12} strokeWidth={1.5} />
                  )}
                </button>
                <span className="trust-group-sub-sep" aria-hidden>
                  ·
                </span>
                <span className="trust-group-sub">
                  {initializedModulesCount === null
                    ? "— signers"
                    : `${initializedModulesCount} signer${initializedModulesCount === 1 ? "" : "s"}`}
                </span>
                <span className="trust-group-sub-sep" aria-hidden>
                  ·
                </span>
                <span className="trust-group-sub">
                  {rolesCount === null
                    ? "— roles"
                    : `${rolesCount} role${rolesCount === 1 ? "" : "s"}`}
                </span>
                <span className="trust-group-sub-sep" aria-hidden>
                  ·
                </span>
                <span className="trust-group-sub">
                  {trustOnchain ? "On-chain mirror live" : "Bridge pending"}
                </span>
              </>
            ) : (
              <>
                <span className="trust-group-state-dot" data-tone="static" aria-hidden />
                <span className="trust-group-headline">Off-chain only</span>
                <span className="trust-group-sub">No TRUST mirror on Solana yet.</span>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="trust-group-cards">
        <OwnershipPrimitiveCard
          to={`${basePath}/assets`}
          icon={<Wallet size={16} strokeWidth={1.5} />}
          label="Assets"
          value={assets.vault?.moduleState ? (treasuryUsdc ?? "—") : "—"}
          hint={assets.vault?.moduleState && treasuryUsdc ? "USDC" : ""}
          sub={
            assets.vault?.moduleState
              ? "Treasury vault active"
              : trustAddress
                ? "No vault yet"
                : "Bridge pending"
          }
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/equity`}
          icon={<PieChart size={16} strokeWidth={1.5} />}
          label="Equity"
          value={hasToken ? (holdersCount === null ? "—" : String(holdersCount)) : "—"}
          hint={hasToken ? (holdersCount === 1 ? "holder" : "holders") : ""}
          sub={
            hasToken ? "Cap-table token live" : trustAddress ? "Foundation shape" : "Bridge pending"
          }
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/quorum`}
          icon={<Vote size={16} strokeWidth={1.5} />}
          label="Quorum"
          value={
            configsCount && configsCount > 0
              ? activeProposalsCount === null
                ? "—"
                : String(activeProposalsCount)
              : "—"
          }
          hint={
            configsCount && configsCount > 0 ? (activeProposalsCount === 1 ? "open" : "open") : ""
          }
          sub={
            configsCount && configsCount > 0
              ? `${configsCount} governance config${configsCount === 1 ? "" : "s"}`
              : trustAddress
                ? "Founder-mode"
                : "Bridge pending"
          }
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/incorporation`}
          icon={<FileText size={16} strokeWidth={1.5} />}
          label="Incorporation"
          value={modulesCount === null ? "—" : String(modulesCount)}
          hint={modulesCount === 1 ? "module" : "modules"}
          sub={trustOnchain ? "On-chain agreement" : trustAddress ? "Not yet" : "Bridge pending"}
        />
      </div>
    </section>
  );
}

interface OwnershipPrimitiveCardProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  sub: string;
}

function OwnershipPrimitiveCard({
  to,
  icon,
  label,
  value,
  hint,
  sub,
}: OwnershipPrimitiveCardProps) {
  return (
    <Link to={to} className="trust-card trust-primitive-card">
      <span className="trust-primitive-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-primitive-label">{label}</span>
      <span className="trust-primitive-value">
        {value}
        {hint && <span className="trust-primitive-hint"> {hint}</span>}
      </span>
      <span className="trust-primitive-sub">{sub}</span>
    </Link>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Format a raw USDC amount (in base units; 6-decimal token by convention)
 * as `$X.YZ` with two decimal places. Uses bigint division to avoid
 * Number-overflow at large balances; the truncation is intentional —
 * displaying $0.000001 in a cockpit tile reads as noise. Rounds toward
 * zero (truncates) so the tile never overstates the balance.
 */
function formatUsdc(amountRaw: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / divisor;
  // Scale fractional part to 2 decimal places, truncating the rest.
  const fracScaled =
    decimals <= 2
      ? (amountRaw % divisor) * BigInt(10) ** BigInt(2 - decimals)
      : (amountRaw % divisor) / BigInt(10) ** BigInt(decimals - 2);
  const fracStr = fracScaled.toString().padStart(2, "0");
  return `$${whole.toString()}.${fracStr}`;
}
