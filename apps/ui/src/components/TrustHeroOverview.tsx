import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { ArrowRight, Copy, Check } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import { useIncorporation } from "@/hooks/useIncorporation";
import SolanaMark from "./SolanaMark";

interface TrustHeroOverviewProps {
  trustId: string;
  basePath: string;
  trustAddress: string | null | undefined;
}

/**
 * Subtle 2-column bar at the bottom of the trust hero card:
 *
 *   LEFT  — runtime / server specs (state dot + plan + agent count
 *           + "Open agents →" link). Where the team lives.
 *   RIGHT — on-chain identity (Solana mark + TRUST address +
 *           modules + roles). Where the contract lives. "Modules"
 *           rather than "signers" because what we're counting is
 *           initialized Anchor program modules, not multisig
 *           signers — those are different concepts in the AEQI
 *           role-graph model.
 *
 * Reframed 2026-05-20: was a right-sided panel with "Programmable
 * execution" / "Programmable ownership" eyebrows. The eyebrows
 * shouted; the panel competed with the avatar. Now it's a quiet
 * inset bar that sits inside the hero without competing — runtime
 * + ownership at a glance, nothing more.
 */
export default function TrustHeroOverview({
  trustId,
  basePath,
  trustAddress,
}: TrustHeroOverviewProps) {
  const agents = useDaemonStore((s) => s.agents);
  const runtime = useRuntimeStatus(trustId);
  const incorporation = useIncorporation(trustAddress);

  const subtreeAgents = agents.filter((a) => a.trust_id === trustId || a.id === trustId);
  const activeAgents = subtreeAgents.filter(
    (a) => a.status === "running" || a.status === "active" || a.status === "online",
  ).length;

  const initializedModulesCount = useMemo(() => {
    if (!incorporation.modules) return null;
    return incorporation.modules.filter((m) => Boolean(m.account.initialized)).length;
  }, [incorporation.modules]);
  const rolesCount = incorporation.roles?.length ?? null;

  const runtimeTone = runtime.hostActive ? "live" : runtime.hasRuntime ? "provisioning" : "static";
  const runtimePlanLabel = runtime.plan === "pro" ? "Pro" : runtime.hostActive ? "Standard" : null;
  const runtimeLabel = runtime.hostActive
    ? `${runtimePlanLabel} runtime`
    : runtime.hasRuntime
      ? "Runtime attached"
      : "No runtime";
  const agentLabel =
    subtreeAgents.length === 0
      ? null
      : `${activeAgents} ${activeAgents === 1 ? "agent online" : "agents online"}`;

  const [copied, setCopied] = useState(false);
  const copyAddress = () => {
    if (!trustAddress) return;
    navigator.clipboard.writeText(trustAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const ctaPath = runtime.hostActive ? `${basePath}/agents` : "/launch";
  const ctaLabel = runtime.hostActive ? "Open" : "Launch";

  return (
    <div className="trust-hero-bar">
      <div className="trust-hero-bar-left">
        <span className="trust-hero-bar-dot" data-tone={runtimeTone} aria-hidden />
        <span className="trust-hero-bar-headline">{runtimeLabel}</span>
        {agentLabel && (
          <>
            <span className="trust-hero-bar-sep" aria-hidden>
              ·
            </span>
            <span className="trust-hero-bar-text">{agentLabel}</span>
          </>
        )}
        <Link to={ctaPath} className="trust-hero-bar-cta">
          {ctaLabel}
          <ArrowRight size={12} strokeWidth={1.8} />
        </Link>
      </div>

      <div className="trust-hero-bar-right">
        <span className="trust-hero-bar-solana" aria-hidden>
          <SolanaMark size={12} />
        </span>
        {trustAddress ? (
          <>
            <button
              type="button"
              className="trust-hero-bar-addr"
              onClick={copyAddress}
              title={copied ? "Copied" : "Click to copy"}
            >
              <span>{compactAddress(trustAddress)}</span>
              {copied ? (
                <Check size={11} strokeWidth={1.8} />
              ) : (
                <Copy size={11} strokeWidth={1.5} />
              )}
            </button>
            {initializedModulesCount !== null && (
              <>
                <span className="trust-hero-bar-sep" aria-hidden>
                  ·
                </span>
                <span className="trust-hero-bar-text">
                  {initializedModulesCount} module{initializedModulesCount === 1 ? "" : "s"}
                </span>
              </>
            )}
            {rolesCount !== null && rolesCount > 0 && (
              <>
                <span className="trust-hero-bar-sep" aria-hidden>
                  ·
                </span>
                <span className="trust-hero-bar-text">
                  {rolesCount} role{rolesCount === 1 ? "" : "s"}
                </span>
              </>
            )}
          </>
        ) : (
          <span className="trust-hero-bar-text">Bridge pending</span>
        )}
      </div>
    </div>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
