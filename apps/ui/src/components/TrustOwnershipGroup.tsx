import { Link } from "react-router-dom";
import { useMemo } from "react";
import { Wallet, PieChart, Vote, FileText } from "lucide-react";
import { useAssets } from "@/hooks/useAssets";
import { useEquity } from "@/hooks/useEquity";
import { useQuorum } from "@/hooks/useQuorum";
import { useIncorporation } from "@/hooks/useIncorporation";
import { deriveProposalStatus, lookupTokenMeta } from "@/solana";
import TrustOwnershipTransferControl from "./TrustOwnershipTransferControl";

interface TrustOwnershipGroupProps {
  trustAddress: string | null | undefined;
  basePath: string;
}

/**
 * Programmable Ownership row — a 4-card row (Assets · Equity · Quorum
 * · Incorporation) under the trust hero. The header bar (TRUST address
 * + signers + on-chain mirror status) that lived here in v3 was lifted
 * into the hero card's right-side overview panel (TrustHeroOverview)
 * on 2026-05-20, so this component is now just the card grid.
 *
 * All cockpit signals are sourced from on-chain reads on Solana via
 * `useIncorporation` / `useAssets` / `useEquity` / `useQuorum`.
 */
export default function TrustOwnershipGroup({ trustAddress, basePath }: TrustOwnershipGroupProps) {
  const assets = useAssets(trustAddress);
  const equity = useEquity(trustAddress);
  const quorum = useQuorum(trustAddress);
  const incorporation = useIncorporation(trustAddress);

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
  const modulesCount = incorporation.modules?.length ?? null;
  const trustOnchain = !!incorporation.trust;

  return (
    <div className="trust-ownership-group">
      <section className="trust-group-cards" aria-label="Programmable ownership">
        <OwnershipPrimitiveCard
          to={`${basePath}/assets`}
          icon={<Wallet size={16} strokeWidth={1.5} />}
          label="Assets"
          value={assets.vault?.moduleState ? (treasuryUsdc ?? "—") : "—"}
          hint={assets.vault?.moduleState && treasuryUsdc ? "USDC" : ""}
          sub={
            assets.vault?.moduleState
              ? ""
              : trustAddress
                ? "No treasury vault"
                : "Setting up on Solana"
          }
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/equity`}
          icon={<PieChart size={16} strokeWidth={1.5} />}
          label="Equity"
          value={hasToken ? (holdersCount === null ? "—" : String(holdersCount)) : "—"}
          hint={hasToken ? (holdersCount === 1 ? "holder" : "holders") : ""}
          sub={hasToken ? "" : trustAddress ? "No equity token" : "Setting up on Solana"}
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
          hint={configsCount && configsCount > 0 ? "open" : ""}
          sub={
            configsCount && configsCount > 0
              ? ""
              : trustAddress
                ? "No voting yet"
                : "Setting up on Solana"
          }
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/incorporation`}
          icon={<FileText size={16} strokeWidth={1.5} />}
          label="Incorporation"
          value={modulesCount === null ? "—" : String(modulesCount)}
          hint={modulesCount === 1 ? "module" : "modules"}
          sub={trustOnchain ? "" : trustAddress ? "No agreement yet" : "Setting up on Solana"}
        />
      </section>
      <TrustOwnershipTransferControl hasTrustAddress={!!trustAddress} />
    </div>
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
      {sub && <span className="trust-primitive-sub">{sub}</span>}
    </Link>
  );
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
  const fracScaled =
    decimals <= 2
      ? (amountRaw % divisor) * BigInt(10) ** BigInt(2 - decimals)
      : (amountRaw % divisor) / BigInt(10) ** BigInt(decimals - 2);
  const fracStr = fracScaled.toString().padStart(2, "0");
  return `$${whole.toString()}.${fracStr}`;
}
