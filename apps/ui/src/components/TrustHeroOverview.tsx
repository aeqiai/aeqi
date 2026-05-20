import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { ArrowRight, Copy, Check } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import { useIncorporation } from "@/hooks/useIncorporation";

interface TrustHeroOverviewProps {
  trustId: string;
  basePath: string;
  trustAddress: string | null | undefined;
}

/**
 * Right-sided summary panel slotted into the trust hero card via
 * `<TrustHeroStrip aside={...} />`. Consolidates the two group header
 * bars that previously stood on their own rows underneath:
 *
 *   · Programmable execution — runtime state + headline + CTA
 *   · Programmable ownership — TRUST address (copy) + signers + roles
 *
 * The 4-card execution row and 4-card ownership row below the hero
 * keep their primitive cards but no longer carry a header bar each;
 * the bar content lives here, in the hero, where it earns visual
 * weight against the photo background.
 *
 * Signals re-used from the cockpit ownership card (initialized-module
 * count as the on-chain "signer" analogue, role count, mirror-live
 * flag) so the panel and the cards below tell the same story.
 */
export default function TrustHeroOverview({
  trustId,
  basePath,
  trustAddress,
}: TrustHeroOverviewProps) {
  const agents = useDaemonStore((s) => s.agents);
  const runtime = useRuntimeStatus(trustId);
  const incorporation = useIncorporation(trustAddress);
  const trustOnchain = !!incorporation.trust;

  const subtreeAgents = agents.filter((a) => a.trust_id === trustId || a.id === trustId);
  const activeAgents = subtreeAgents.filter(
    (a) => a.status === "running" || a.status === "active" || a.status === "online",
  ).length;

  // Initialized-module count = the on-chain analogue to "signers" (same
  // shape used in TrustOwnershipGroup). Roles count = the role-graph
  // size. Both come from the same incorporation read.
  const initializedModulesCount = useMemo(() => {
    if (!incorporation.modules) return null;
    return incorporation.modules.filter((m) => Boolean(m.account.initialized)).length;
  }, [incorporation.modules]);
  const rolesCount = incorporation.roles?.length ?? null;

  const runtimeTone = runtime.hostActive ? "live" : runtime.hasRuntime ? "provisioning" : "static";
  const runtimeHeadline = runtime.hostActive
    ? "Runtime live"
    : runtime.hasRuntime
      ? "Runtime attached"
      : "No runtime";
  const runtimeSub =
    subtreeAgents.length === 0
      ? "No agents yet"
      : `${activeAgents} ${activeAgents === 1 ? "agent" : "agents"} active`;

  const [copied, setCopied] = useState(false);
  const copyAddress = () => {
    if (!trustAddress) return;
    navigator.clipboard.writeText(trustAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const ctaPath = runtime.hostActive ? `${basePath}/agents` : "/launch";
  const ctaLabel = runtime.hostActive ? "Open agents" : "Launch runtime";

  return (
    <div className="trust-hero-overview">
      {/* Execution */}
      <div className="trust-hero-overview-row">
        <span className="trust-hero-overview-eyebrow">Programmable execution</span>
        <div className="trust-hero-overview-line">
          <span className="trust-hero-overview-dot" data-tone={runtimeTone} aria-hidden />
          <span className="trust-hero-overview-headline">{runtimeHeadline}</span>
        </div>
        <div className="trust-hero-overview-meta">
          <span>{runtimeSub}</span>
          <Link to={ctaPath} className="trust-hero-overview-cta">
            {ctaLabel}
            <ArrowRight size={12} strokeWidth={1.8} />
          </Link>
        </div>
      </div>

      {/* Ownership */}
      <div className="trust-hero-overview-row">
        <span className="trust-hero-overview-eyebrow">Programmable ownership</span>
        {trustAddress ? (
          <>
            <button
              type="button"
              className="trust-hero-overview-addr"
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
            <div className="trust-hero-overview-meta">
              <span>
                {initializedModulesCount === null
                  ? "— signers"
                  : `${initializedModulesCount} signer${initializedModulesCount === 1 ? "" : "s"}`}
              </span>
              <span className="trust-hero-overview-sep" aria-hidden>
                ·
              </span>
              <span>
                {rolesCount === null
                  ? "— roles"
                  : `${rolesCount} role${rolesCount === 1 ? "" : "s"}`}
              </span>
              <span className="trust-hero-overview-sep" aria-hidden>
                ·
              </span>
              <span className="trust-hero-overview-status">
                {trustOnchain ? "On-chain" : "Bridge pending"}
              </span>
            </div>
          </>
        ) : (
          <>
            <span className="trust-hero-overview-headline">Off-chain only</span>
            <div className="trust-hero-overview-meta">
              <span>No TRUST mirror on Solana yet.</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
