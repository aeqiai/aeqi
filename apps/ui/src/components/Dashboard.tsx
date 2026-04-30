import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useEntitiesQuery } from "@/queries/entities";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore, selectInboxCount, selectVisibleItems } from "@/store/inbox";
import { useAuthStore } from "@/store/auth";
import { BlueprintLaunchPicker } from "@/components/blueprints/BlueprintLaunchPicker";
import BlockAvatar from "@/components/BlockAvatar";

/**
 * `/` — global director cockpit. NOT a feed.
 *
 * Default scope is everything across every company you own; the page
 * does NOT silently inherit the currently selected company. The
 * switcher is for deeper navigation into a single company; this page
 * is the cross-cutting view.
 *
 * Modules surface state and decisions, not chronological scrolling:
 *   - Needs your attention (count → /me/inbox)
 *   - Active companies (links to each /c/<id>/overview)
 *   - Recent progress (curated activity, not infinite scroll)
 *
 * Future modules (deferred until data exists): blocked / at-risk
 * quests, portfolio snapshot, recent wins. Not infinite chronology;
 * each is a curated module the user can scan in seconds.
 *
 * Empty state at zero companies = inline BlueprintLaunchPicker. The
 * page reads your data and becomes the right thing for first-timers.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entitiesQuery = useEntitiesQuery();
  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);
  const inboxCount = useInboxStore(selectInboxCount);
  const inboxItems = useInboxStore(selectVisibleItems);

  useEffect(() => {
    document.title = "home · æqi";
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "still up";
    if (h < 12) return "good morning";
    if (h < 17) return "good afternoon";
    if (h < 22) return "good evening";
    return "welcome back";
  }, []);
  const name = firstName(user?.name, user?.email);
  const heading = name ? `${greeting}, ${name}` : greeting;

  // Top-three inbox items shown inline as a "needs attention" preview.
  // The full queue lives at /me/inbox.
  const attentionPreview = useMemo(() => inboxItems.slice(0, 3), [inboxItems]);

  // "Active" = entities the user has + status === active per the
  // entities query. We don't ping the runtime here; the periodic
  // refresh keeps `running` fresh enough for a dashboard tile.
  const activeCompanies = useMemo(() => entities.filter((e) => e.status === "active"), [entities]);

  if (entitiesQuery.isFetched && entities.length === 0) {
    return (
      <div className="dashboard dashboard--zero">
        <header className="dashboard-zero-hero">
          <h1 className="dashboard-zero-title">Start your first autonomous company.</h1>
          <p className="dashboard-zero-sub">
            Pick a blueprint, or start blank. Your agents start moving once you do.
          </p>
        </header>
        <BlueprintLaunchPicker
          mode="spawn-company"
          onSpawnedCompany={(id) => navigate(`/c/${encodeURIComponent(id)}/overview`)}
        />
      </div>
    );
  }

  if (!entitiesQuery.isFetched) return null;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="dashboard-heading">{heading}.</h1>
        <p className="dashboard-sub">
          What matters across your world — companies, agents, decisions in flight.
        </p>
      </header>

      <div className="dashboard-grid">
        <section className="dashboard-card" aria-labelledby="dash-attention">
          <div className="dashboard-card-head">
            <h2 id="dash-attention" className="dashboard-card-title">
              Needs your attention
            </h2>
            {inboxCount > 0 && (
              <Link to="/me/inbox" className="dashboard-card-link">
                Open inbox →
              </Link>
            )}
          </div>
          {inboxCount === 0 ? (
            <p className="dashboard-quiet">Nothing waiting on you right now.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {attentionPreview.map((item) => {
                const agent = item.agent_id ? agents.find((a) => a.id === item.agent_id) : null;
                const fromName = agent?.name || item.agent_name || "Agent";
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
              {inboxCount > attentionPreview.length && (
                <li className="dashboard-list-more">
                  <Link to="/me/inbox">{inboxCount - attentionPreview.length} more →</Link>
                </li>
              )}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="dash-companies">
          <div className="dashboard-card-head">
            <h2 id="dash-companies" className="dashboard-card-title">
              Active companies
            </h2>
            <span className="dashboard-card-meta">{entities.length} total</span>
          </div>
          {entities.length === 0 ? (
            <p className="dashboard-quiet">No companies yet.</p>
          ) : (
            <ul className="dashboard-list" role="list">
              {entities.map((entity) => {
                const myAgents = agents.filter((a) => a.entity_id === entity.id);
                const isActive = activeCompanies.some((e) => e.id === entity.id);
                return (
                  <li key={entity.id} className="dashboard-list-row">
                    <button
                      type="button"
                      className="dashboard-list-btn dashboard-company-row"
                      onClick={() => navigate(`/c/${encodeURIComponent(entity.id)}/overview`)}
                    >
                      <BlockAvatar name={entity.name} size={20} />
                      <span className="dashboard-company-name">{entity.name}</span>
                      <span className="dashboard-company-meta">
                        {myAgents.length} {myAgents.length === 1 ? "agent" : "agents"}
                        {isActive ? " · active" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="dashboard-card" aria-labelledby="dash-progress">
          <div className="dashboard-card-head">
            <h2 id="dash-progress" className="dashboard-card-title">
              Progress
            </h2>
            <span className="dashboard-card-meta">last 7 days</span>
          </div>
          <ProgressModule quests={quests} agents={agents} />
        </section>
      </div>
    </div>
  );
}

function ProgressModule({
  quests,
  agents,
}: {
  quests: ReturnType<typeof useDaemonStore.getState>["quests"];
  agents: ReturnType<typeof useDaemonStore.getState>["agents"];
}) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentDone = quests
    .filter((q) => q.status === "done" && parseTs(q.updated_at ?? q.created_at) >= cutoff)
    .sort((a, b) => parseTs(b.updated_at ?? b.created_at) - parseTs(a.updated_at ?? a.created_at))
    .slice(0, 5);

  if (recentDone.length === 0) {
    return (
      <p className="dashboard-quiet">
        Nothing completed yet. Activity from your companies will summarise here as it lands.
      </p>
    );
  }

  return (
    <ul className="dashboard-list" role="list">
      {recentDone.map((q) => {
        const a = agents.find((x) => x.id === q.agent_id);
        return (
          <li key={q.id} className="dashboard-list-row dashboard-progress-row">
            <span className="dashboard-progress-meta">completed</span>
            <span className="dashboard-progress-text">
              {a?.name ?? "Agent"} — {q.idea?.name ?? "untitled quest"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function firstName(name: string | undefined, email: string | undefined): string | null {
  const raw = name || email?.split("@")[0] || "";
  if (!raw) return null;
  const seg = raw.split(/[\s._-]+/)[0];
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

function parseTs(value: string | undefined): number {
  if (!value) return 0;
  const d = Date.parse(value);
  return Number.isFinite(d) ? d : 0;
}
