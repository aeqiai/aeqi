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
 *
 * Cycle 1 (2026-05-20): the Quests tile now carries the three board
 * accents as a live signal-row — in_progress (lavender) · in_review
 * (warmth) · done in 24h (jade). It uses the canonical
 * `.quest-status-dot--*` vocabulary from pages.css so the overview
 * reads as a quiet echo of the board itself.
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

  const trustQuests = useMemo(
    () =>
      quests.filter((q) => q.agent_id === trustId || (q.agent_id && subtreeNames.has(q.agent_id))),
    [quests, subtreeNames, trustId],
  );

  const questBreakdown = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let inProgress = 0;
    let inReview = 0;
    let doneRecent = 0;
    for (const q of trustQuests) {
      if (q.status === "in_progress") inProgress += 1;
      else if (q.status === "in_review") inReview += 1;
      else if (q.status === "done") {
        const closed = q.closed_at ? Date.parse(q.closed_at) : NaN;
        if (!Number.isNaN(closed) && closed >= cutoff) doneRecent += 1;
      }
    }
    return { inProgress, inReview, doneRecent };
  }, [trustQuests]);

  const inflightQuests = questBreakdown.inProgress + questBreakdown.inReview;

  const recent24hEvents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return events.filter(
      (ev) => ev.agent && subtreeNames.has(ev.agent) && Date.parse(ev.timestamp) >= cutoff,
    ).length;
  }, [events, subtreeNames]);

  return (
    <section className="trust-cockpit-card" aria-labelledby="trust-operations-heading">
      <header className="trust-cockpit-card-header">
        <h2 id="trust-operations-heading" className="trust-cockpit-card-title">
          Operations
        </h2>
        <span className="trust-cockpit-card-sub">Live runtime activity</span>
      </header>
      <div className="trust-cockpit-inner-grid">
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
          footer={
            <span className="trust-quest-signals" aria-label="quest status breakdown">
              <span className="trust-quest-signal" title="In progress">
                <span className="quest-status-dot quest-status-dot--in_progress" aria-hidden />
                {questBreakdown.inProgress}
              </span>
              <span className="trust-quest-signal" title="In review">
                <span className="quest-status-dot quest-status-dot--in_review" aria-hidden />
                {questBreakdown.inReview}
              </span>
              <span className="trust-quest-signal" title="Done in last 24h">
                <span className="quest-status-dot quest-status-dot--done" aria-hidden />
                {questBreakdown.doneRecent}
              </span>
            </span>
          }
        />
        <PrimitiveCard
          to={`${basePath}/events`}
          icon={<Activity size={16} strokeWidth={1.5} />}
          label="Events"
          value={String(recent24hEvents)}
          hint="last 24h"
        />
        <PrimitiveCard
          to={`${basePath}/ideas`}
          icon={<Lightbulb size={16} strokeWidth={1.5} />}
          label="Ideas"
          value="—"
          hint=""
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
  sub?: string;
  /** Optional rich footer (e.g. status-dot signal row). Takes precedence over `sub`. */
  footer?: React.ReactNode;
}

function PrimitiveCard({ to, icon, label, value, hint, sub, footer }: PrimitiveCardProps) {
  return (
    <Link to={to} className="trust-cockpit-mini">
      <span className="trust-primitive-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-primitive-label">{label}</span>
      <span className="trust-primitive-value">
        {value}
        {hint && <span className="trust-primitive-hint"> {hint}</span>}
      </span>
      {footer ? footer : sub ? <span className="trust-primitive-sub">{sub}</span> : null}
    </Link>
  );
}
