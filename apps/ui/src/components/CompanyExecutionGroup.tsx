import { Link } from "react-router-dom";
import { Users, Target, Activity, Lightbulb } from "lucide-react";
import { useDaemonStore } from "@/store/daemon";
import { useMemo } from "react";
import { formatInteger } from "@/lib/i18n";
import type { Quest } from "@/lib/types";

interface CompanyExecutionGroupProps {
  companyId: string;
  basePath: string;
}

/**
 * Programmable Execution card — Agents/Quests/Events/Ideas under the
 * company hero. The header bar (runtime state + primary CTA) that lived
 * here in v3 was lifted into the hero card's right-side overview
 * panel (CompanyHeroOverview) on 2026-05-20, so this component is just
 * the card grid. The hero overview is the visual anchor that groups
 * these cards.
 *
 * Cycle 1 (2026-05-20): the Quests tile carries the three board
 * accents as a live signal-row — in_progress (lavender) · in_review
 * (warmth) · done in 24h (jade), using the canonical
 * `.quest-status-dot--*` vocabulary from pages.css.
 *
 * Cycle 2 (2026-05-20): collapse the four-tile grid into a denser
 * two-tier layout. Agents + Quests are the live signals and take the
 * full row — Agents gains a parallel online/offline signal-row so the
 * two prominent tiles read in the same language. Events + Ideas drop
 * into a secondary inline row underneath: Events is a 24h count,
 * Ideas is a quiet placeholder. The row no longer spends 50% real
 * estate on inert tiles.
 */
export default function CompanyExecutionGroup({ companyId, basePath }: CompanyExecutionGroupProps) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  const subtreeAgents = useMemo(
    () => agents.filter((a) => a.company_id === companyId || a.id === companyId),
    [agents, companyId],
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
      quests.filter(
        (q) => q.agent_id === companyId || (q.agent_id && subtreeNames.has(q.agent_id)),
      ),
    [quests, subtreeNames, companyId],
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
    <section
      className="company-cockpit-card company-cockpit-card--operations"
      aria-labelledby="company-operations-heading"
    >
      <header className="company-cockpit-card-header">
        <h2 id="company-operations-heading" className="company-cockpit-card-title">
          Operations
        </h2>
        <span className="company-cockpit-card-sub">Operating work</span>
      </header>
      <div className="company-cockpit-inner-grid company-cockpit-inner-grid--split">
        <PrimitiveCard
          to={`${basePath}/agents`}
          icon={<Users size={16} strokeWidth={1.5} />}
          label="Agents"
          value={formatInteger(activeAgents)}
          hint={`of ${subtreeAgents.length}`}
          sub={subtreeAgents.length === 0 ? "Add first Agent" : ""}
          footer={
            subtreeAgents.length > 0 ? (
              <span className="company-quest-signals" aria-label="agent online breakdown">
                <span className="company-quest-signal" title="Online">
                  <span className="company-agent-dot company-agent-dot--online" aria-hidden />
                  {activeAgents}
                </span>
                <span className="company-quest-signal" title="Offline">
                  <span className="company-agent-dot company-agent-dot--offline" aria-hidden />
                  {subtreeAgents.length - activeAgents}
                </span>
              </span>
            ) : undefined
          }
        />
        <PrimitiveCard
          to={`${basePath}/quests`}
          icon={<Target size={16} strokeWidth={1.5} />}
          label="Quests"
          value={formatInteger(inflightQuests)}
          hint="in flight"
          footer={
            <span className="company-quest-signals" aria-label="quest status breakdown">
              <span className="company-quest-signal" title="In progress">
                <span className="quest-status-dot quest-status-dot--in_progress" aria-hidden />
                {questBreakdown.inProgress}
              </span>
              <span className="company-quest-signal" title="In review">
                <span className="quest-status-dot quest-status-dot--in_review" aria-hidden />
                {questBreakdown.inReview}
              </span>
              <span className="company-quest-signal" title="Done in last 24h">
                <span className="quest-status-dot quest-status-dot--done" aria-hidden />
                {questBreakdown.doneRecent}
              </span>
            </span>
          }
        />
      </div>
      <div className="company-cockpit-secondary-row">
        <Link
          to={`${basePath}/events`}
          className="company-cockpit-secondary-cell"
          aria-label="Events in the last 24 hours"
        >
          <Activity size={14} strokeWidth={1.5} aria-hidden />
          <span className="company-cockpit-secondary-label">Events</span>
          <span className="company-cockpit-secondary-value">{recent24hEvents}</span>
          <span className="company-cockpit-secondary-hint">last 24h</span>
        </Link>
        <Link
          to={`${basePath}/ideas`}
          className="company-cockpit-secondary-cell"
          aria-label="Ideas"
        >
          <Lightbulb size={14} strokeWidth={1.5} aria-hidden />
          <span className="company-cockpit-secondary-label">Ideas</span>
          <span className="company-cockpit-secondary-value company-cockpit-secondary-value--placeholder">
            —
          </span>
        </Link>
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
    <Link to={to} className="company-cockpit-mini">
      <span className="company-primitive-icon" aria-hidden>
        {icon}
      </span>
      <span className="company-primitive-label">{label}</span>
      <span className="company-primitive-value">
        {value}
        {hint && <span className="company-primitive-hint"> {hint}</span>}
      </span>
      {footer ? footer : sub ? <span className="company-primitive-sub">{sub}</span> : null}
    </Link>
  );
}
