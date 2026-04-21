import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "./BlockAvatar";
import type { Agent, ActivityEntry, Quest } from "@/lib/types";

const NO_AGENTS: Agent[] = [];
const NO_QUESTS: unknown[] = [];
const NO_EVENTS: ActivityEntry[] = [];

const ACTIVE_STATUSES = new Set(["pending", "in_progress", "blocked"]);

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Welcome back";
  if (h < 22) return "Good evening";
  return "Welcome back";
}

function firstName(name: string | undefined): string | null {
  if (!name) return null;
  const raw = name.includes("@") ? name.split("@")[0] : name;
  const seg = raw.split(/[\s._-]+/)[0];
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "";
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(d: Date): string {
  return `${DAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Home dashboard — root-level landing at `/`. User-scoped, company-agnostic
 * view of what moved since they were last here. Uses the same shell as
 * per-agent pages; the sidebar's tree lets them jump into any company.
 *
 * Sections (top to bottom):
 *   1. Welcome hero — greeting + first name, editorial display weight
 *   2. Stat strip — companies, active quests, agents deployed
 *   3. Recent activity — cross-company feed, click to jump in
 *   4. Active quests — anything still moving
 *   5. Companies — entity picker, tap to enter
 */
export default function HomeDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const agents = useDaemonStore((s) => s.agents) || NO_AGENTS;
  const quests = useDaemonStore((s) => s.quests) || NO_QUESTS;
  const events = useDaemonStore((s) => s.events) || NO_EVENTS;

  useEffect(() => {
    document.title = "home · æqi";
  }, []);

  const name = firstName(user?.name);
  const greet = greeting();

  const companies = useMemo(() => agents.filter((a) => !a.parent_id), [agents]);
  const agentCountsByRoot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of agents) {
      if (a.parent_id) counts.set(a.parent_id, (counts.get(a.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [agents]);

  const activeQuests = useMemo(() => {
    const typed = quests as unknown as Quest[];
    return typed
      .filter((q) => ACTIVE_STATUSES.has(q.status))
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at).getTime() -
          new Date(a.updated_at || a.created_at).getTime(),
      );
  }, [quests]);

  const recent = useMemo(() => events.slice(0, 12), [events]);

  const agentNameToRoot = useMemo(() => {
    const byName = new Map<string, Agent>();
    for (const a of agents) byName.set(a.name, a);
    const rootOf = (agentNameOrId: string): string | null => {
      let cur = byName.get(agentNameOrId) ?? agents.find((a) => a.id === agentNameOrId);
      for (let i = 0; i < 20 && cur; i++) {
        if (!cur.parent_id) return cur.id;
        cur = agents.find((a) => a.id === cur!.parent_id);
      }
      return null;
    };
    return rootOf;
  }, [agents]);

  const openEvent = (e: ActivityEntry) => {
    if (!e.agent) return;
    const rootId = agentNameToRoot(e.agent);
    if (rootId) navigate(`/${encodeURIComponent(rootId)}`);
  };

  const openQuest = (q: Quest) => {
    if (!q.agent_id) return;
    const rootId = agentNameToRoot(q.agent_id) ?? q.agent_id;
    navigate(`/${encodeURIComponent(rootId)}/quests/${encodeURIComponent(q.id)}`);
  };

  const openCompany = (id: string) => navigate(`/${encodeURIComponent(id)}`);

  return (
    <div className="home-dash">
      <div className="home-dash-eyebrow">
        <span className="home-dash-eyebrow-kind">Home</span>
        <span className="home-dash-eyebrow-sep" aria-hidden>
          ·
        </span>
        <span className="home-dash-eyebrow-date">{formatDate(new Date())}</span>
      </div>

      <h1 className="home-dash-hero">
        {greet}
        {name ? `, ${name}` : ""}.
      </h1>

      <div className="home-dash-stats">
        <HomeStat
          value={companies.length}
          label={companies.length === 1 ? "company" : "companies"}
        />
        <span className="home-dash-stats-sep" aria-hidden>
          ·
        </span>
        <HomeStat
          value={activeQuests.length}
          label={activeQuests.length === 1 ? "quest moving" : "quests moving"}
        />
        <span className="home-dash-stats-sep" aria-hidden>
          ·
        </span>
        <HomeStat
          value={agents.length}
          label={agents.length === 1 ? "agent deployed" : "agents deployed"}
        />
      </div>

      <section className="home-dash-section">
        <SectionHead label="Recent activity" count={recent.length} />
        {recent.length === 0 ? (
          <div className="home-dash-empty">Nothing moved. Quiet while you were away.</div>
        ) : (
          <div className="home-dash-feed">
            {recent.map((e) => (
              <button
                key={e.id}
                type="button"
                className="home-dash-feed-row"
                onClick={() => openEvent(e)}
              >
                <span className="home-dash-feed-kind">{e.decision_type}</span>
                <span className="home-dash-feed-summary">{e.summary}</span>
                {e.agent && <span className="home-dash-feed-agent">{e.agent}</span>}
                <span className="home-dash-feed-time">
                  {relativeTime(e.created_at || e.timestamp)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {activeQuests.length > 0 && (
        <section className="home-dash-section">
          <SectionHead label="Active quests" count={activeQuests.length} />
          <div className="home-dash-feed">
            {activeQuests.slice(0, 8).map((q) => (
              <button
                key={q.id}
                type="button"
                className="home-dash-feed-row"
                onClick={() => openQuest(q)}
              >
                <span
                  className={`home-dash-quest-dot status-${q.status.replace(/_/g, "-")}`}
                  aria-hidden
                />
                <span className="home-dash-feed-summary">{q.subject}</span>
                {q.agent_id && <span className="home-dash-feed-agent">{q.agent_id}</span>}
                <span className="home-dash-feed-kind">{q.status.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="home-dash-section">
        <SectionHead
          label="Companies"
          count={companies.length}
          action={
            <button
              type="button"
              className="home-dash-section-action"
              onClick={() => navigate("/new")}
            >
              + New
            </button>
          }
        />
        {companies.length === 0 ? (
          <div className="home-dash-empty">
            No companies yet.{" "}
            <button
              type="button"
              className="home-dash-empty-link"
              onClick={() => navigate("/templates")}
            >
              Pick a template
            </button>{" "}
            or{" "}
            <button type="button" className="home-dash-empty-link" onClick={() => navigate("/new")}>
              spin one up
            </button>
            .
          </div>
        ) : (
          <div className="home-dash-companies">
            {companies.map((c) => {
              const label = c.display_name || c.name;
              const childCount = agentCountsByRoot.get(c.id) ?? 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="home-dash-company-row"
                  onClick={() => openCompany(c.id)}
                >
                  <BlockAvatar name={label} size={28} />
                  <span className="home-dash-company-name">{label}</span>
                  <span className="home-dash-company-meta">
                    {childCount} {childCount === 1 ? "agent" : "agents"}
                  </span>
                  <span className="home-dash-company-arrow" aria-hidden>
                    →
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function HomeStat({ value, label }: { value: number; label: string }) {
  return (
    <span className="home-dash-stat">
      <span className="home-dash-stat-num">{value}</span>
      <span className="home-dash-stat-label">{label}</span>
    </span>
  );
}

function SectionHead({
  label,
  count,
  action,
}: {
  label: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="home-dash-section-head">
      <span className="home-dash-section-label">{label}</span>
      <span className="home-dash-section-rule" />
      <span className="home-dash-section-count">{count}</span>
      {action}
    </div>
  );
}
