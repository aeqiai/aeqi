import { Link } from "react-router-dom";
import { ArrowRight, Cpu, Users, Compass, Activity, Lightbulb } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import { useMemo } from "react";
import type { Quest } from "@/lib/types";

interface TrustExecutionGroupProps {
  trustId: string;
  basePath: string;
}

/**
 * Programmable Execution group. One header bar (runtime status + plan +
 * primary CTA) followed by a row of four primitive cards: Agents,
 * Quests, Events, Ideas. The bar visually anchors the four cards
 * underneath as a single unit; no container box wraps them.
 *
 * The state band that lived as its own row in v2 folds into this
 * header — runtime = execution, conceptually one beat.
 */
export default function TrustExecutionGroup({ trustId, basePath }: TrustExecutionGroupProps) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  const runtime = useRuntimeStatus(trustId);

  const subtreeAgents = useMemo(
    () => agents.filter((a) => a.trust_id === trustId || a.id === trustId),
    [agents, trustId],
  );
  const subtreeNames = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.name)),
    [subtreeAgents],
  );
  const activeAgents = useMemo(
    () =>
      subtreeAgents.filter(
        (a) => a.status === "running" || a.status === "active" || a.status === "online",
      ).length,
    [subtreeAgents],
  );
  const rootAgent = subtreeAgents[0] ?? null;

  const inflightQuests = useMemo(
    () =>
      quests.filter(
        (q) =>
          (q.status === "in_progress" ||
            q.status === "in_review" ||
            q.status === "todo" ||
            q.status === "backlog") &&
          (q.agent_id === trustId || (q.agent_id && subtreeNames.has(q.agent_id))),
      ).length,
    [quests, subtreeNames, trustId],
  );

  const recent24hEvents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events.filter(
      (ev) => ev.agent && subtreeNames.has(ev.agent) && Date.parse(ev.timestamp) >= cutoff,
    ).length;
  }, [events, subtreeNames]);

  const headlineTone = runtime.hostActive ? "live" : runtime.hasRuntime ? "provisioning" : "static";
  const headline = runtime.hostActive
    ? "Runtime live"
    : runtime.hasRuntime
      ? "Runtime attached"
      : "No runtime";
  const sub = runtime.hostActive
    ? `${runtime.plan === "pro" ? "Pro" : "Standard"} plan · host active`
    : runtime.hasRuntime
      ? `${runtime.plan === "pro" ? "Pro" : "Standard"} plan · host inactive`
      : "Identity-only TRUST — execution surfaces are dormant.";

  const ctaPath = runtime.hostActive
    ? rootAgent
      ? `${basePath}/agents/${encodeURIComponent(rootAgent.id)}`
      : `${basePath}/agents`
    : "/launch";
  const ctaLabel = runtime.hostActive
    ? rootAgent
      ? `Chat with ${rootAgent.name}`
      : "Open agents"
    : "Launch runtime";

  return (
    <section className="trust-group trust-group--execution" aria-labelledby="exec-eyebrow">
      <header className="trust-group-bar">
        <div className="trust-group-bar-left">
          <span className="trust-group-eyebrow" id="exec-eyebrow">
            <Cpu size={12} strokeWidth={1.8} />
            Programmable execution
          </span>
          <div className="trust-group-bar-row">
            <span className="trust-group-state-dot" data-tone={headlineTone} aria-hidden />
            <span className="trust-group-headline">{headline}</span>
            <span className="trust-group-sub">{sub}</span>
          </div>
        </div>
        <Link to={ctaPath} className="trust-group-cta">
          {ctaLabel}
          <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      </header>

      <div className="trust-group-cards">
        <PrimitiveCard
          to={`${basePath}/agents`}
          icon={<Users size={16} strokeWidth={1.5} />}
          label="Agents"
          value={String(activeAgents)}
          hint={`of ${subtreeAgents.length}`}
          sub={rootAgent ? rootAgent.name : "No agents yet"}
        />
        <PrimitiveCard
          to={`${basePath}/quests`}
          icon={<Compass size={16} strokeWidth={1.5} />}
          label="Quests"
          value={String(inflightQuests)}
          hint={inflightQuests === 1 ? "in flight" : "in flight"}
          sub={inflightQuests > 0 ? "Active work" : "Queue is clear"}
        />
        <PrimitiveCard
          to={`${basePath}/events`}
          icon={<Activity size={16} strokeWidth={1.5} />}
          label="Events"
          value={String(recent24hEvents)}
          hint="last 24h"
          sub={recent24hEvents > 0 ? "Decisions logged" : "Quiet day"}
        />
        <PrimitiveCard
          to={`${basePath}/ideas`}
          icon={<Lightbulb size={16} strokeWidth={1.5} />}
          label="Ideas"
          value=""
          hint=""
          sub="Knowledge graph"
        />
      </div>
    </section>
  );
}

interface PrimitiveCardProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  sub: string;
}

function PrimitiveCard({ to, icon, label, value, hint, sub }: PrimitiveCardProps) {
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
