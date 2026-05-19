import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export type TrustMode = "operational" | "provisioning" | "static" | "error";

export type MilestoneKey =
  | "creating_trust"
  | "signing_on_solana"
  | "loading_roles"
  | "spawning_agent";

export const MILESTONE_ORDER: ReadonlyArray<MilestoneKey> = [
  "creating_trust",
  "signing_on_solana",
  "loading_roles",
  "spawning_agent",
];

export const MILESTONE_LABEL: Record<MilestoneKey, string> = {
  creating_trust: "Creating TRUST",
  signing_on_solana: "Signing on Solana",
  loading_roles: "Loading roles",
  spawning_agent: "Spawning the agent",
};

interface TrustStateBandProps {
  mode: TrustMode;
  currentMilestone: MilestoneKey | null;
  launchError: string | null;
  activeAgents: number;
  totalAgents: number;
  operationalCtaPath: string;
  onLaunch: () => void;
  rootAgentName?: string;
}

/**
 * The 120% beat of the Trust overview: one wide card carrying the
 * mode-specific primary CTA. Operational → chat with the root agent.
 * Provisioning → current milestone (no CTA, just status). Static →
 * Launch runtime. Error → error message (no CTA).
 */
export default function TrustStateBand({
  mode,
  currentMilestone,
  launchError,
  activeAgents,
  totalAgents,
  operationalCtaPath,
  onLaunch,
  rootAgentName,
}: TrustStateBandProps) {
  if (mode === "operational") {
    return (
      <section className="trust-overview-state">
        <span className="trust-overview-state-dot" data-tone="operational" aria-hidden />
        <div className="trust-overview-state-body">
          <p className="trust-overview-state-headline">Runtime live</p>
          <p className="trust-overview-state-sub">
            {activeAgents} {activeAgents === 1 ? "agent" : "agents"} active
            {totalAgents > activeAgents ? ` · ${totalAgents - activeAgents} idle` : ""}
          </p>
        </div>
        <Link to={operationalCtaPath} className="trust-overview-state-cta">
          {rootAgentName ? `Chat with ${rootAgentName}` : "Open agents"}
          <ArrowRight size={16} strokeWidth={1.8} />
        </Link>
      </section>
    );
  }
  if (mode === "provisioning") {
    return (
      <section className="trust-overview-state">
        <span className="trust-overview-state-dot" data-tone="provisioning" aria-hidden />
        <div className="trust-overview-state-body">
          <p className="trust-overview-state-headline">Spinning up runtime</p>
          <p className="trust-overview-state-sub">
            {currentMilestone ? `Step: ${MILESTONE_LABEL[currentMilestone]}` : "Almost ready"}
          </p>
        </div>
      </section>
    );
  }
  if (mode === "error") {
    return (
      <section className="trust-overview-state">
        <span className="trust-overview-state-dot" data-tone="error" aria-hidden />
        <div className="trust-overview-state-body">
          <p className="trust-overview-state-headline">Runtime needs attention</p>
          <p className="trust-overview-state-sub">{launchError ?? "Unknown error."}</p>
        </div>
      </section>
    );
  }
  return (
    <section className="trust-overview-state">
      <span className="trust-overview-state-dot" data-tone="static" aria-hidden />
      <div className="trust-overview-state-body">
        <p className="trust-overview-state-headline">Identity only</p>
        <p className="trust-overview-state-sub">
          TRUST exists on-chain. Add a runtime to make it operational.
        </p>
      </div>
      <button type="button" className="trust-overview-state-cta" onClick={onLaunch}>
        Launch runtime
        <ArrowRight size={16} strokeWidth={1.8} />
      </button>
    </section>
  );
}
