import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import type { Idea, Quest } from "@/lib/types";
import { sessionDeepUrl } from "@/lib/sessionUrl";

/**
 * `/c/<entity>/agents/<agent>/overview` — the agent cockpit. Mirrors
 * the company cockpit at `/c/<entity>/overview`, scoped to a single
 * agent.
 *
 * Modules:
 *   - Header: agent name + cadence (in-flight quests, awaiting you)
 *   - Mission: identity idea content (first 200 chars). What this
 *     agent is for.
 *   - In flight: this agent's in-progress quests
 *   - Awaiting you: inbox sessions belonging to this agent
 *   - Momentum: last-24h events emitted by this agent
 *
 * Reuses `.dashboard-*` classes — the surface pattern is shared with
 * the Dashboard at `/` and the company cockpit.
 */
export default function AgentOverviewTab({
  agentId,
  entityId,
}: {
  agentId: string;
  entityId: string;
}) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  const inboxAllItems = useInboxStore((s) => s.items);
  const inboxPending = useInboxStore((s) => s.pendingDismissal);
  const agentInbox = useMemo(
    () => inboxAllItems.filter((i) => i.agent_id === agentId && !inboxPending.has(i.session_id)),
    [inboxAllItems, inboxPending, agentId],
  );

  const agent = agents.find((a) => a.id === agentId);

  const inFlightQuests = useMemo(
    () =>
      quests
        .filter((q) => q.status === "in_progress" && q.agent_id === agentId)
        .sort(
          (a, b) => parseTs(b.updated_at ?? b.created_at) - parseTs(a.updated_at ?? a.created_at),
        )
        .slice(0, 5),
    [quests, agentId],
  );

  const openQuestCount = useMemo(
    () =>
      quests.filter(
        (q) => (q.status === "todo" || q.status === "in_progress") && q.agent_id === agentId,
      ).length,
    [quests, agentId],
  );

  const recentEvents = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    if (!agent) return [];
    return events
      .filter((ev) => ev.agent === agent.name && parseTs(ev.timestamp) >= cutoff)
      .sort((a, b) => parseTs(b.timestamp) - parseTs(a.timestamp))
      .slice(0, 5);
  }, [events, agent]);

  // Mission: fetch this agent's identity idea (the "Persona" seed
  // every blueprint creates) and take its first paragraph. If the
  // agent doesn't have one, the module quietly disappears — Mission
  // shouldn't ship a placeholder, the absence is the signal.
  const [persona, setPersona] = useState<Idea | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getIdeas({ agent_id: agentId, limit: 50 })
      .then((data) => {
        if (cancelled) return;
        const ideas = ((data.ideas as Idea[] | undefined) ?? []) as Idea[];
        const identity =
          ideas.find((i) => (i.tags ?? []).includes("identity")) ??
          ideas.find((i) => i.name?.toLowerCase().startsWith("persona")) ??
          null;
        setPersona(identity);
      })
      .catch(() => {
        if (cancelled) return;
        setPersona(null);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${openQuestCount} open ${openQuestCount === 1 ? "quest" : "quests"}`);
    if (agentInbox.length > 0) parts.push(`${agentInbox.length} awaiting you`);
    return parts.join(" · ");
  }, [openQuestCount, agentInbox.length]);

  const basePath = `/c/${encodeURIComponent(entityId)}/agents/${encodeURIComponent(agentId)}`;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="dashboard-heading">{agent?.name ?? agentId}.</h1>
        {subtitle && <p className="dashboard-sub">{subtitle}</p>}
      </header>

      <div className="dashboard-grid">
        {persona && (
          <section className="dashboard-card" aria-labelledby="agent-mission">
            <div className="dashboard-card-head">
              <h2 id="agent-mission" className="dashboard-card-title">
                Mission
              </h2>
              <Link to={`${basePath}/ideas`} className="dashboard-card-link">
                Ideas →
              </Link>
            </div>
            <p className="dashboard-mission-body">{firstSentence(persona.content)}</p>
          </section>
        )}

        <section className="dashboard-card" aria-labelledby="agent-flight">
          <div className="dashboard-card-head">
            <h2 id="agent-flight" className="dashboard-card-title">
              In flight
            </h2>
            {openQuestCount > 0 && (
              <Link to={`${basePath}/quests`} className="dashboard-card-link">
                Open quests →
              </Link>
            )}
          </div>
          {inFlightQuests.length === 0 ? (
            <p className="dashboard-quiet">Nothing in progress right now.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {inFlightQuests.map((q) => (
                <li key={q.id} className="dashboard-list-row">
                  <button
                    type="button"
                    className="dashboard-list-btn"
                    onClick={() => navigate(`${basePath}/quests/${encodeURIComponent(q.id)}`)}
                  >
                    <span className="dashboard-list-from">in progress</span>
                    <span className="dashboard-list-text">{q.idea?.name ?? "untitled quest"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="agent-attention">
          <div className="dashboard-card-head">
            <h2 id="agent-attention" className="dashboard-card-title">
              Awaiting you
            </h2>
            {agentInbox.length > 0 && (
              <Link to="/" className="dashboard-card-link">
                Open inbox →
              </Link>
            )}
          </div>
          {agentInbox.length === 0 ? (
            <p className="dashboard-quiet">Nothing waiting from this agent.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {agentInbox.slice(0, 5).map((item) => (
                <li key={item.session_id} className="dashboard-list-row">
                  <button
                    type="button"
                    className="dashboard-list-btn"
                    onClick={() =>
                      navigate(sessionDeepUrl(item.entity_id, item.agent_id, item.session_id))
                    }
                  >
                    <span className="dashboard-list-from">
                      {item.agent_name ?? agent?.name ?? "Agent"}
                    </span>
                    <span className="dashboard-list-text">
                      {item.awaiting_subject || item.last_agent_message || item.session_name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="agent-momentum">
          <div className="dashboard-card-head">
            <h2 id="agent-momentum" className="dashboard-card-title">
              Momentum
            </h2>
            <span className="dashboard-card-meta">last 24h</span>
          </div>
          {recentEvents.length === 0 ? (
            <p className="dashboard-quiet">No activity in the last 24h.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {recentEvents.map((ev) => (
                <li key={ev.id} className="dashboard-list-row">
                  <button
                    type="button"
                    className="dashboard-list-btn"
                    onClick={() => navigate(`${basePath}/events`)}
                  >
                    <span className="dashboard-list-from">
                      {ev.decision_type.replace(/_/g, " ")}
                    </span>
                    <span className="dashboard-list-text">{ev.summary || ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function parseTs(value: string | undefined): number {
  if (!value) return 0;
  const d = Date.parse(value);
  return Number.isFinite(d) ? d : 0;
}

function firstSentence(text: string | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  // Heuristic: cut at the first period followed by space-or-newline,
  // capped at 240 characters so the Mission card stays scannable. The
  // full content lives in the Ideas tab; this is just the headline
  // sentence, like a tagline.
  const dotIdx = trimmed.search(/\.[\s\n]/);
  if (dotIdx > 0 && dotIdx < 240) return trimmed.slice(0, dotIdx + 1);
  if (trimmed.length <= 240) return trimmed;
  return trimmed.slice(0, 240).replace(/\s+\S*$/, "") + "…";
}
