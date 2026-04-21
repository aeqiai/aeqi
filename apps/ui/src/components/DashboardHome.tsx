import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useChatStore } from "@/store/chat";
import { useUIStore } from "@/store/ui";
import { useNav } from "@/hooks/useNav";
import { Button } from "@/components/ui";
import { runtimeLabel } from "@/lib/runtime";
import { timeAgo } from "@/lib/format";
import type { Agent } from "@/lib/types";

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "working" || s === "running") return "var(--success)";
  if (s === "paused" || s === "idle") return "var(--text-muted)";
  if (s === "error" || s === "failed") return "var(--error)";
  return "var(--text-muted)";
}

function dateGroupKey(ts: string | null | undefined): string {
  if (!ts) return "earlier";
  const d = new Date(ts);
  const now = new Date();
  const dayDiff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (dayDiff < 1) return "today";
  if (dayDiff < 2) return "yesterday";
  return "earlier";
}

const GROUP_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

export default function DashboardHome() {
  const navigate = useNavigate();
  const { href, goAgent } = useNav();
  const quests = useDaemonStore((s) => s.quests);
  const agents = useDaemonStore((s) => s.agents);
  const cost = useDaemonStore((s) => s.cost);
  const events = useDaemonStore((s) => s.events);
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const activeRoot = useUIStore((s) => s.activeRoot);
  // Children of the root agent — what the user can actually delegate to.
  const childAgents = agents.filter((a) => a.id !== activeRoot && a.parent_id);

  const activeQuests = quests.filter((q) => q.status === "in_progress");
  const blockedQuests = quests.filter((q) => q.status === "blocked");
  const spent = (cost?.spent_today_usd as number) ?? 0;
  const budget = (cost?.daily_budget_usd as number) ?? 10;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const activeAgentCount = agents.filter((a) => {
    const s = (a.status || "").toLowerCase();
    return s === "active" || s === "working" || s === "running";
  }).length;

  const handleAgentClick = (agent: Agent) => {
    setSelectedAgent({
      id: agent.id,
      name: agent.name,
      display_name: agent.display_name,
      model: agent.model,
    });
    goAgent(agent.id);
  };

  // Group recent events by Today / Yesterday / Earlier
  const activityGroups = useMemo(() => {
    const recent = events.slice(0, 12);
    const order = ["today", "yesterday", "earlier"];
    const buckets: Record<string, typeof recent> = { today: [], yesterday: [], earlier: [] };
    for (const e of recent) {
      const key = dateGroupKey(e.timestamp ?? e.created_at);
      buckets[key].push(e);
    }
    return order
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({
        key: k,
        label: GROUP_LABELS[k],
        items: buckets[k],
      }));
  }, [events]);

  return (
    <div className="dash-home">
      {/* Quick stats */}
      <div className="dash-home-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{activeAgentCount}</span>
          <span className="dash-stat-label">Agents Online</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{activeQuests.length}</span>
          <span className="dash-stat-label">Active Quests</span>
        </div>
        <div className="dash-stat">
          <span className={`dash-stat-value${blockedQuests.length > 0 ? " dash-stat-warn" : ""}`}>
            {blockedQuests.length}
          </span>
          <span className="dash-stat-label">Blocked</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{formatUsd(spent)}</span>
          <span className="dash-stat-label">Usage Today</span>
        </div>
      </div>

      {/* Budget bar */}
      {budget > 0 && (
        <div className="dash-home-budget">
          <div className="dash-home-budget-header">
            <span>Daily limit</span>
            <span>
              {formatUsd(spent)} / {formatUsd(budget)}
            </span>
          </div>
          <div className="dash-home-budget-track">
            <div className="dash-home-budget-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Agent grid -- click to open session */}
      {childAgents.length === 0 ? (
        <div className="dash-home-welcome">
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="24" cy="20" r="8" />
            <path d="M12 40c0-6.6 5.4-12 12-12s12 5.4 12 12" />
          </svg>
          <h2 className="dash-home-welcome-title">Your workspace is ready</h2>
          <p className="dash-home-welcome-copy">
            Agents research, code, and ship. Hire your first one to get started.
          </p>
          <Button
            variant="primary"
            className="dash-home-welcome-cta"
            onClick={() =>
              navigate(activeRoot ? `/new?parent=${encodeURIComponent(activeRoot)}` : "/new")
            }
          >
            Hire an agent
          </Button>
        </div>
      ) : (
        <>
          {quests.length === 0 && (
            <div className="dash-home-nudge">
              <p className="dash-home-nudge-copy">
                Your agents are ready.{" "}
                <a href={href("/quests")} className="dash-home-nudge-link">
                  Create a quest
                </a>{" "}
                to put them to work.
              </p>
            </div>
          )}
          <div className="dash-home-section">
            <div className="dash-home-section-title">Agents</div>
            <div className="dash-agent-grid">
              {childAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className="dash-agent-card"
                  onClick={() => handleAgentClick(agent)}
                >
                  <div className="dash-agent-card-header">
                    <span
                      className="dash-agent-dot"
                      style={{ background: statusColor(agent.status) }}
                    />
                    <span className="dash-agent-name">{agent.display_name || agent.name}</span>
                  </div>
                  {agent.model && <span className="dash-agent-model">{agent.model}</span>}
                  <span className="dash-agent-status">{agent.status}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Active quests */}
      {activeQuests.length > 0 && (
        <div className="dash-home-section">
          <div className="dash-home-section-title">Active Quests</div>
          <div className="dash-quest-list">
            {activeQuests.map((q: any) => (
              <button
                key={q.id}
                type="button"
                className="dash-quest-row"
                data-status={q.status}
                onClick={() => q.agent_id && goAgent(q.agent_id, "quests", q.id)}
                disabled={!q.agent_id}
              >
                <span className="dash-quest-agent">{q.agent_id || "\u2014"}</span>
                <span className="dash-quest-subject">{q.subject}</span>
                {runtimeLabel(q.runtime) && (
                  <span className="dash-quest-phase">{runtimeLabel(q.runtime)}</span>
                )}
                <span className="dash-quest-time">{timeAgo(q.started_at || q.updated_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      {events.length > 0 && (
        <div className="dash-home-section">
          <div className="dash-home-section-title">Recent Activity</div>
          <div className="dash-activity-list">
            {activityGroups.map((group) => (
              <div key={group.key}>
                <div className="dash-activity-group">
                  <div className="dash-activity-group-label">{group.label}</div>
                </div>
                {group.items.map((e: any, i: number) => (
                  <div key={e.id || i} className="dash-activity-row">
                    <span className="dash-activity-time">
                      {timeAgo(e.timestamp || e.created_at)}
                    </span>
                    <span className="dash-activity-agent">{e.agent || e.actor || "\u2014"}</span>
                    <span className="dash-activity-summary">
                      {e.summary || e.reasoning || e.description || e.decision_type || "\u2014"}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
