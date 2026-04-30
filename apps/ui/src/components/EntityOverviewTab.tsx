import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import type { Role, Quest } from "@/lib/types";

/**
 * `/c/<entity>/overview` — the company cockpit. Lands on every visit
 * to a company; this is where direction, execution, decisions,
 * momentum, and ownership read at a glance.
 *
 * Modules surface state and decisions, never chronological scroll:
 *   - Header: company name + agent / open-quest cadence subtitle
 *   - In flight: in-progress quests scoped to the company subtree
 *   - Awaiting you: inbox slice filtered to entity_id
 *   - Momentum: last 24h events grouped by agent
 *   - Org: top roles (link to full /roles tab)
 *
 * Reuses `.dashboard-*` classes from the global cockpit at `/`. Same
 * visual language across both surfaces — they're both "grid of
 * surface cards." If the visual diverges later, fork the classes
 * with a less location-coupled prefix.
 */
export default function EntityOverviewTab({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const events = useDaemonStore((s) => s.events);

  // Inbox: subscribe to raw fields and useMemo the entity-filtered
  // slice. A selector that filters inline returns a fresh array
  // every call and breaks `useSyncExternalStore`'s identity check
  // (React error #185).
  const inboxAllItems = useInboxStore((s) => s.items);
  const inboxPending = useInboxStore((s) => s.pendingDismissal);
  const entityInbox = useMemo(
    () => inboxAllItems.filter((i) => i.entity_id === entityId && !inboxPending.has(i.session_id)),
    [inboxAllItems, inboxPending, entityId],
  );

  const subtreeAgents = useMemo(
    () => agents.filter((a) => a.entity_id === entityId || a.id === entityId),
    [agents, entityId],
  );
  const entity = subtreeAgents[0] ?? agents.find((a) => a.id === entityId);
  const subtreeIds = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.id)),
    [subtreeAgents],
  );
  const subtreeNames = useMemo(
    () => new Set<string>(subtreeAgents.map((a) => a.name)),
    [subtreeAgents],
  );

  const inFlightQuests = useMemo(
    () =>
      quests
        .filter(
          (q) =>
            q.status === "in_progress" &&
            ((q.agent_id && subtreeIds.has(q.agent_id)) || q.agent_id === entityId),
        )
        .sort(
          (a, b) => parseTs(b.updated_at ?? b.created_at) - parseTs(a.updated_at ?? a.created_at),
        )
        .slice(0, 5),
    [quests, subtreeIds, entityId],
  );

  const openQuestCount = useMemo(
    () =>
      quests.filter(
        (q) =>
          (q.status === "todo" || q.status === "in_progress") &&
          ((q.agent_id && subtreeIds.has(q.agent_id)) || q.agent_id === entityId),
      ).length,
    [quests, subtreeIds, entityId],
  );

  // Momentum: last-24h events whose `agent` field matches a name in
  // the subtree, grouped by agent so the user sees "who did what"
  // not a flat chronology. Top 5 agents by event count.
  const momentum = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = events.filter(
      (ev) => ev.agent && subtreeNames.has(ev.agent) && parseTs(ev.timestamp) >= cutoff,
    );
    const byAgent = new Map<string, { count: number; latest: string; sample: string }>();
    for (const ev of recent) {
      const k = ev.agent!;
      const cur = byAgent.get(k);
      const decision = ev.decision_type.replace(/_/g, " ");
      if (!cur) {
        byAgent.set(k, { count: 1, latest: ev.timestamp, sample: decision });
      } else {
        cur.count += 1;
        if (parseTs(ev.timestamp) > parseTs(cur.latest)) {
          cur.latest = ev.timestamp;
          cur.sample = decision;
        }
      }
    }
    return [...byAgent.entries()]
      .map(([agent, v]) => ({ agent, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [events, subtreeNames]);

  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .getRoles(entityId)
      .then((resp) => {
        if (cancelled) return;
        setRoles(resp.roles ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${subtreeAgents.length} ${subtreeAgents.length === 1 ? "agent" : "agents"}`);
    parts.push(`${openQuestCount} open ${openQuestCount === 1 ? "quest" : "quests"}`);
    if (entityInbox.length > 0) parts.push(`${entityInbox.length} awaiting you`);
    return parts.join(" · ");
  }, [subtreeAgents.length, openQuestCount, entityInbox.length]);

  const basePath = `/c/${encodeURIComponent(entityId)}`;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="dashboard-heading">{entity?.name || entityId}.</h1>
        <p className="dashboard-sub">{subtitle}</p>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" aria-labelledby="cockpit-flight">
          <div className="dashboard-card-head">
            <h2 id="cockpit-flight" className="dashboard-card-title">
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
              {inFlightQuests.map((q) => {
                const agent = q.agent_id ? agents.find((a) => a.id === q.agent_id) : null;
                return (
                  <li key={q.id} className="dashboard-list-row">
                    <button
                      type="button"
                      className="dashboard-list-btn"
                      onClick={() => navigate(`${basePath}/quests/${encodeURIComponent(q.id)}`)}
                    >
                      <span className="dashboard-list-from">{agent?.name ?? "Agent"}</span>
                      <span className="dashboard-list-text">
                        {q.idea?.name ?? "untitled quest"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="cockpit-attention">
          <div className="dashboard-card-head">
            <h2 id="cockpit-attention" className="dashboard-card-title">
              Awaiting you
            </h2>
            {entityInbox.length > 0 && (
              <Link to="/me/inbox" className="dashboard-card-link">
                Open inbox →
              </Link>
            )}
          </div>
          {entityInbox.length === 0 ? (
            <p className="dashboard-quiet">Nothing waiting from this company.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {entityInbox.slice(0, 5).map((item) => {
                const fromName = item.agent_name || "Agent";
                const preview =
                  item.awaiting_subject || item.last_agent_message || item.session_name;
                return (
                  <li key={item.session_id} className="dashboard-list-row">
                    <button
                      type="button"
                      className="dashboard-list-btn"
                      onClick={() => navigate(`/sessions/${encodeURIComponent(item.session_id)}`)}
                    >
                      <span className="dashboard-list-from">{fromName}</span>
                      <span className="dashboard-list-text">{preview}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="cockpit-momentum">
          <div className="dashboard-card-head">
            <h2 id="cockpit-momentum" className="dashboard-card-title">
              Momentum
            </h2>
            <span className="dashboard-card-meta">last 24h</span>
          </div>
          {momentum.length === 0 ? (
            <p className="dashboard-quiet">Quiet day. No agent activity in the last 24h.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {momentum.map((m) => (
                <li key={m.agent} className="dashboard-list-row">
                  <button
                    type="button"
                    className="dashboard-list-btn"
                    onClick={() => navigate(`${basePath}/events`)}
                  >
                    <span className="dashboard-list-from">
                      {m.agent} · {m.count}
                    </span>
                    <span className="dashboard-list-text">{m.sample}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="cockpit-org">
          <div className="dashboard-card-head">
            <h2 id="cockpit-org" className="dashboard-card-title">
              Org
            </h2>
            <Link to={`${basePath}/roles`} className="dashboard-card-link">
              {roles.length} {roles.length === 1 ? "role" : "roles"} →
            </Link>
          </div>
          {roles.length === 0 ? (
            <p className="dashboard-quiet">No roles defined yet.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {roles.slice(0, 5).map((p) => (
                <li key={p.id} className="dashboard-list-row">
                  <button
                    type="button"
                    className="dashboard-list-btn"
                    onClick={() => navigate(`${basePath}/roles`)}
                  >
                    <span className="dashboard-list-from">{p.title}</span>
                    <span className="dashboard-list-text">
                      {p.occupant_kind === "vacant"
                        ? "vacant"
                        : p.occupant_kind === "human"
                          ? "human"
                          : "agent"}
                    </span>
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
