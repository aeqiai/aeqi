import { Link } from "react-router-dom";
import { useState } from "react";
import { Shield, Copy, Check, Wallet, PieChart, Vote, FileText } from "lucide-react";
import { useAssets } from "@/hooks/useAssets";
import { useEquity } from "@/hooks/useEquity";
import { useQuorum } from "@/hooks/useQuorum";
import { useIncorporation } from "@/hooks/useIncorporation";

interface TrustOwnershipGroupProps {
  trustAddress: string | null | undefined;
  basePath: string;
  signersCount: number | null;
}

/**
 * Programmable Ownership group. One header bar (TRUST address + signers
 * + smart contract chip) followed by a row of four primitive cards:
 * Assets, Equity, Quorum, Incorporation. Mirrors the Execution group's
 * shape — the symmetry is the design language.
 *
 * The on-chain identity strip that lived as its own row in v2 folds
 * into this header — address + signers = ownership identity, one beat.
 */
export default function TrustOwnershipGroup({
  trustAddress,
  basePath,
  signersCount,
}: TrustOwnershipGroupProps) {
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

  const holdingsCount = assets.holdings?.length ?? null;
  const holdersCount = equity.holders?.length ?? null;
  const hasToken = !!equity.tokenModuleState;
  const proposalsCount = quorum.proposals?.length ?? null;
  const configsCount = quorum.configs?.length ?? null;
  const modulesCount = incorporation.modules?.length ?? null;
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
                  {signersCount === null ? "— signers" : `${signersCount} signers`}
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
          value={holdingsCount === null ? "—" : String(holdingsCount)}
          hint={holdingsCount === 1 ? "holding" : "holdings"}
          sub={
            assets.vault
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
          value={proposalsCount === null ? "—" : String(proposalsCount)}
          hint={proposalsCount === 1 ? "proposal" : "proposals"}
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
