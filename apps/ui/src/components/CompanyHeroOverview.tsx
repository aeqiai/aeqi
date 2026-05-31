import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { ArrowRight, Copy, Check } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import { useIncorporation } from "@/hooks/useIncorporation";
import { formatCount } from "@/lib/i18n";
import { formatCents } from "@/lib/pricing";
import SolanaMark from "./SolanaMark";

interface CompanyHeroOverviewProps {
  companyId: string;
  basePath: string;
  companyAddress: string | null | undefined;
}

/**
 * Subtle 2-column bar at the bottom of the company hero card:
 *
 *   LEFT  — runtime / server specs (state dot + plan + agent count
 *           + "Open agents →" link). Where the team lives.
 *   RIGHT — on-chain identity (Solana mark + COMPANY address +
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
 *
 * Calibrated 2026-05-21 (c3): the modules · roles tail was promoted
 * INTO the address pill, so the on-chain identity reads as one
 * composed object (`[hex copy] | N modules · M roles`) rather than
 * three loose chunks rolling out of the Solana mark. The button
 * remains the only click target; the tail is a quiet metadata zone
 * sharing the pill shape via a tint shift, not a hairline.
 */
export default function CompanyHeroOverview({
  companyId,
  basePath,
  companyAddress,
}: CompanyHeroOverviewProps) {
  const agents = useDaemonStore((s) => s.agents);
  const runtime = useRuntimeStatus(companyId);
  const incorporation = useIncorporation(companyAddress);

  const subtreeAgents = agents.filter((a) => a.company_id === companyId || a.id === companyId);
  const activeAgents = subtreeAgents.filter(
    (a) => a.status === "running" || a.status === "active" || a.status === "online",
  ).length;

  const initializedModulesCount = useMemo(() => {
    if (!incorporation.modules) return null;
    return incorporation.modules.filter((m) => Boolean(m.account.initialized)).length;
  }, [incorporation.modules]);
  const rolesCount = incorporation.roles?.length ?? null;

  const runtimeTone = runtime.hostActive ? "live" : runtime.hasRuntime ? "provisioning" : "static";
  const runtimePlanLabel =
    runtime.plan === "sandbox"
      ? "Admin sandbox"
      : runtime.plan === "pro"
        ? "Pro"
        : runtime.hostActive
          ? "Standard"
          : null;
  const runtimeLabel = runtime.hostActive
    ? `${runtimePlanLabel} runtime`
    : runtime.hasRuntime
      ? "Runtime attached"
      : "No runtime";
  const budgetLabel = runtime.budget
    ? `LLM budget ${formatCents(runtime.budget.limitCents)}/mo · ${formatCents(runtime.budget.usedCents)} spent · ${formatCents(runtime.budget.remainingCents)} left`
    : null;
  const agentLabel =
    subtreeAgents.length === 0
      ? null
      : `${activeAgents} ${activeAgents === 1 ? "agent online" : "agents online"}`;

  const [copied, setCopied] = useState(false);
  const copyAddress = () => {
    if (!companyAddress) return;
    navigator.clipboard
      .writeText(companyAddress)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard write failed (insecure context, permissions). Don't flash
        // a check we didn't earn — leave the icon in its resting state.
      });
  };

  const ctaPath = runtime.hostActive ? `${basePath}/quests/new` : "/launch";
  const ctaLabel = runtime.hostActive ? "Create Quest" : "Launch Runtime";

  return (
    <div className="company-hero-bar">
      <div className="company-hero-bar-left">
        <div className="company-hero-bar-main">
          <span className="company-hero-bar-dot" data-tone={runtimeTone} aria-hidden />
          <span className="company-hero-bar-headline">{runtimeLabel}</span>
          {agentLabel && (
            <>
              <span className="company-hero-bar-sep" aria-hidden>
                ·
              </span>
              <span className="company-hero-bar-text">{agentLabel}</span>
            </>
          )}
          <Link to={ctaPath} className="company-hero-bar-cta" data-tone={runtimeTone}>
            {ctaLabel}
            <ArrowRight size={12} strokeWidth={1.8} />
          </Link>
        </div>
        {budgetLabel && <span className="company-hero-bar-budget">{budgetLabel}</span>}
      </div>

      <div className="company-hero-bar-right">
        <span
          className="company-hero-bar-solana"
          data-verified={companyAddress ? "true" : undefined}
          data-pending={companyAddress ? undefined : "true"}
          aria-hidden
          title={companyAddress ? "Verified on Solana" : "Awaiting on-chain registration"}
        >
          <SolanaMark size={12} />
        </span>
        {companyAddress ? (
          <span className="company-hero-bar-addr-pill">
            <button
              type="button"
              className="company-hero-bar-addr"
              onClick={copyAddress}
              title={copied ? "Copied" : "Click to copy"}
              aria-label={
                copied ? "COMPANY address copied" : `Copy COMPANY address ${companyAddress}`
              }
            >
              <span aria-hidden="true">{compactAddress(companyAddress)}</span>
              {copied ? (
                <Check size={11} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <Copy size={11} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
            {(initializedModulesCount !== null || (rolesCount !== null && rolesCount > 0)) && (
              <span className="company-hero-bar-addr-meta">
                {initializedModulesCount !== null && (
                  <span className="company-hero-bar-text">
                    {formatCount(initializedModulesCount, { one: "module", other: "modules" })}
                  </span>
                )}
                {initializedModulesCount !== null && rolesCount !== null && rolesCount > 0 && (
                  <span className="company-hero-bar-sep" aria-hidden>
                    ·
                  </span>
                )}
                {rolesCount !== null && rolesCount > 0 && (
                  <span className="company-hero-bar-text">
                    {formatCount(rolesCount, { one: "role", other: "roles" })}
                  </span>
                )}
              </span>
            )}
          </span>
        ) : (
          <span className="company-hero-bar-pending" title="COMPANY registration is still settling">
            COMPANY registration pending
          </span>
        )}
      </div>
    </div>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
