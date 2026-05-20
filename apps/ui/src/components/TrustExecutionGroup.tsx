import { Link } from "react-router-dom";
import { Users, Target, Activity, Lightbulb } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useMemo } from "react";
import type { Quest } from "@/lib/types";

interface TrustExecutionGroupProps {
  trustId: string;
  basePath: string;
}

/**
 * Programmable Execution row — a 4-card row (Agents · Quests · Events
 * · Ideas) under the trust hero. The header bar (runtime state +
 * primary CTA) that lived here in v3 was lifted into the hero card's
 * right-side overview panel (TrustHeroOverview) on 2026-05-20, so
 * this component is now just the card grid. No outer container; the
 * hero overview is the visual anchor that groups these cards.
 */
export default function TrustExecutionGroup({ trustId, basePath }: TrustExecutionGroupProps) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

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

  return (
    <section className="trust-group-cards" aria-label="Programmable execution">
      <PrimitiveCard
        to={`${basePath}/agents`}
        icon={<Users size={16} strokeWidth={1.5} />}
        label="Agents"
        value={String(activeAgents)}
        hint={`of ${subtreeAgents.length}`}
        sub={subtreeAgents.length === 0 ? "No agents yet" : ""}
      />
      <PrimitiveCard
        to={`${basePath}/quests`}
        icon={<Target size={16} strokeWidth={1.5} />}
        label="Quests"
        value={String(inflightQuests)}
        hint="in flight"
        sub=""
      />
      <PrimitiveCard
        to={`${basePath}/events`}
        icon={<Activity size={16} strokeWidth={1.5} />}
        label="Events"
        value={String(recent24hEvents)}
        hint="last 24h"
        sub=""
      />
      <PrimitiveCard
        to={`${basePath}/ideas`}
        icon={<Lightbulb size={16} strokeWidth={1.5} />}
        label="Ideas"
        value="—"
        hint=""
        sub=""
      />
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
      {sub && <span className="trust-primitive-sub">{sub}</span>}
    </Link>
  );
}
