import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "./BlockAvatar";
import Wordmark from "./Wordmark";
import { Button, EmptyState, HeroStats, Panel } from "./ui";
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
 * Home — root `/` landing. Company-agnostic. Editorial paper surface: Cinzel
 * greeting in ink, HeroStats strip, Panel sections for activity / active
 * quests / companies. All chrome comes from `components/ui/` primitives so
 * the page inherits tokens, row rhythm, and the one-accent rule by default.
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
    <div className="home">
      <header className="home-hero">
        <div className="home-eyebrow">
          <span className="home-eyebrow-brand">
            <Wordmark size={14} /> · home
          </span>
          <span className="home-eyebrow-date">{formatDate(new Date())}</span>
        </div>
        <h1 className="home-greeting">
          {greet}
          {name ? `, ${name}` : ""}.
        </h1>

        <HeroStats
          stats={[
            {
              value: companies.length,
              label: companies.length === 1 ? "company" : "companies",
            },
            {
              value: activeQuests.length,
              label: activeQuests.length === 1 ? "quest moving" : "quests moving",
            },
            {
              value: agents.length,
              label: agents.length === 1 ? "agent deployed" : "agents deployed",
            },
          ]}
        />
      </header>

      <Panel
        title="Recent activity"
        actions={<span className="home-panel-count">{recent.length}</span>}
      >
        {recent.length === 0 ? (
          <EmptyState
            eyebrow="Quiet"
            title="Nothing moved"
            description="Your agents will report here as soon as they act."
          />
        ) : (
          <ul className="home-rows" role="list">
            {recent.map((e) => (
              <li key={e.id}>
                <button type="button" className="home-row" onClick={() => openEvent(e)}>
                  <span className="home-row-kind">{e.decision_type}</span>
                  <span className="home-row-summary">{e.summary}</span>
                  {e.agent && <span className="home-row-agent">{e.agent}</span>}
                  <span className="home-row-time">{relativeTime(e.created_at || e.timestamp)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {activeQuests.length > 0 && (
        <Panel
          title="Active quests"
          actions={<span className="home-panel-count">{activeQuests.length}</span>}
        >
          <ul className="home-rows" role="list">
            {activeQuests.slice(0, 8).map((q) => (
              <li key={q.id}>
                <button type="button" className="home-row" onClick={() => openQuest(q)}>
                  <span
                    className={`home-row-dot status-${q.status.replace(/_/g, "-")}`}
                    aria-hidden
                  />
                  <span className="home-row-summary">{q.subject}</span>
                  {q.agent_id && <span className="home-row-agent">{q.agent_id}</span>}
                  <span className="home-row-kind">{q.status.replace(/_/g, " ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Companies"
        actions={
          <>
            <span className="home-panel-count">{companies.length}</span>
            <Button variant="ghost" size="sm" onClick={() => navigate("/new")}>
              New
            </Button>
          </>
        }
      >
        {companies.length === 0 ? (
          <EmptyState
            eyebrow="Nothing spun up"
            title="Start a company"
            description="Pick a template to inherit a working identity, or spin up an empty root."
            action={
              <>
                <Button variant="primary" size="sm" onClick={() => navigate("/templates")}>
                  Pick a template
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate("/new")}>
                  Empty root
                </Button>
              </>
            }
          />
        ) : (
          <ul className="home-companies" role="list">
            {companies.map((c) => {
              const label = c.display_name || c.name;
              const childCount = agentCountsByRoot.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button type="button" className="home-company" onClick={() => openCompany(c.id)}>
                    <BlockAvatar name={label} size={28} />
                    <span className="home-company-name">{label}</span>
                    <span className="home-company-meta">
                      {childCount} {childCount === 1 ? "agent" : "agents"}
                    </span>
                    <span className="home-company-arrow" aria-hidden>
                      →
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
