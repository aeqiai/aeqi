import { Link } from "react-router-dom";
import { useMemo } from "react";
import { Wallet, PieChart, Vote, FileText } from "lucide-react";
import { useAssets } from "@/hooks/useAssets";
import { useEquity } from "@/hooks/useEquity";
import { useQuorum } from "@/hooks/useQuorum";
import { deriveProposalStatus, lookupTokenMeta } from "@/solana";

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

  const holdersCount = equity.holders?.length ?? null;
  const hasToken = !!equity.tokenModuleState;
  const configsCount = quorum.configs?.length ?? null;
  // "Provisioning" = platform-side TRUST registered but the matching
  // Solana module hasn't materialized yet (no trustAddress, or trust
  // exists but the per-primitive moduleState is still null). Each
  // primitive owns its own gate so Assets can render real USDC while
  // Equity/Quorum are still mid-bridge. Pre-c4 these rendered as a
  // giant "—" that swallowed the row's visual weight; c4 swaps that
  // for a quiet "Bridge pending" badge so the row reads as awaiting
  // rather than empty.
  const assetsProvisioning = !assets.vault?.moduleState;
  const equityProvisioning = !hasToken;
  const quorumProvisioning = !configsCount;
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

  return (
    <section className="trust-cockpit-card" aria-labelledby="trust-ownership-heading">
      <header className="trust-cockpit-card-header">
        <h2 id="trust-ownership-heading" className="trust-cockpit-card-title">
          Ownership
        </h2>
        <span className="trust-cockpit-card-sub">On-chain state</span>
      </header>
      <div className="trust-cockpit-inner-grid">
        <OwnershipPrimitiveCard
          to={`${basePath}/assets`}
          icon={<Wallet size={16} strokeWidth={1.5} />}
          label="Assets"
          value={treasuryUsdc ?? "—"}
          hint={treasuryUsdc ? "USDC" : ""}
          sub=""
          provisioning={assetsProvisioning}
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/equity`}
          icon={<PieChart size={16} strokeWidth={1.5} />}
          label="Equity"
          value={holdersCount === null ? "—" : String(holdersCount)}
          hint={holdersCount === 1 ? "holder" : "holders"}
          sub=""
          provisioning={equityProvisioning}
        />
        <OwnershipPrimitiveCard
          to={`${basePath}/quorum`}
          icon={<Vote size={16} strokeWidth={1.5} />}
          label="Quorum"
          value={activeProposalsCount === null ? "—" : String(activeProposalsCount)}
          hint="open"
          sub=""
          provisioning={quorumProvisioning}
        />
        <OwnershipPrimitiveCard
          icon={<FileText size={16} strokeWidth={1.5} />}
          label="Incorporation"
          value="—"
          hint=""
          sub="Coming soon"
          comingSoon
        />
      </div>
    </section>
  );
}

interface OwnershipPrimitiveCardProps {
  to?: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  sub: string;
  comingSoon?: boolean;
  provisioning?: boolean;
}

function OwnershipPrimitiveCard({
  to,
  icon,
  label,
  value,
  hint,
  sub,
  comingSoon,
  provisioning,
}: OwnershipPrimitiveCardProps) {
  const body = (
    <>
      <span className="trust-primitive-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-primitive-label">{label}</span>
      {provisioning ? (
        // Awaiting on-chain bridge. The 28px display value would render
        // as a giant "—" and dominate the row; swap it for a quiet
        // warmth-toned badge so the tile reads as "alive, awaiting"
        // rather than "empty". Same accent (--state-review) the Roles
        // tile uses for vacant seats — keeps the awaiting vocabulary
        // consistent across the Ownership row.
        <span className="trust-primitive-pending" role="status">
          Bridge pending
        </span>
      ) : (
        <span className="trust-primitive-value">
          {value}
          {hint && <span className="trust-primitive-hint"> {hint}</span>}
        </span>
      )}
      {sub && !provisioning && <span className="trust-primitive-sub">{sub}</span>}
    </>
  );
  if (comingSoon || !to) {
    return (
      <div
        className="trust-cockpit-mini trust-cockpit-mini--soon"
        aria-disabled="true"
        title={`${label} — coming soon`}
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      to={to}
      className={`trust-cockpit-mini${provisioning ? " trust-cockpit-mini--provisioning" : ""}`}
    >
      {body}
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
