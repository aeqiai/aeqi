import { useEffect } from "react";
import { useDaemonStore } from "@/store/daemon";
import { runtimeLabel } from "@/lib/runtime";
import { timeAgo } from "@/lib/format";
import Header from "@/components/Header";

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}


export default function DashboardPage() {
  const status = useDaemonStore((s) => s.status);
  const quests = useDaemonStore((s) => s.quests);
  const agents = useDaemonStore((s) => s.agents);
  const cost = useDaemonStore((s) => s.cost);
  const events = useDaemonStore((s) => s.events);
  const fetchAll = useDaemonStore((s) => s.fetchAll);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const pendingQuests = quests.filter((q: any) => q.status === "pending");
  const activeQuests = quests.filter((q: any) => q.status === "in_progress");
  const blockedQuests = quests.filter((q: any) => q.status === "blocked");
  const doneQuests = quests
    .filter((q: any) => q.status === "done")
    .sort((a: any, b: any) =>
      new Date(b.updated_at || b.created_at).getTime() -
      new Date(a.updated_at || a.created_at).getTime()
    )
    .slice(0, 5);
  const activeWorkers = status?.active_workers ?? activeQuests.length;
  const spent = cost?.spent_today_usd ?? 0;
  const budget = cost?.daily_budget_usd ?? 10;
  const remaining = Math.max(0, budget - spent);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const activeAgentCount = agents.filter((a: any) => {
    const s = (a.status || "").toLowerCase();
    return s === "active" || s === "working" || s === "running";
  }).length;

  return (
    <div className="page-content">
      <Header title="Dashboard" />

      {/* Hero stats bar */}
      <div className="dash-hero">
        <div className="dash-hero-stat">
          <div className="dash-hero-value">{activeWorkers}</div>
          <div className="dash-hero-label">Active Workers</div>
        </div>
        <div className="dash-hero-stat">
          <div className="dash-hero-value">{activeAgentCount}</div>
          <div className="dash-hero-label">Agents Online</div>
        </div>
        <div className="dash-hero-stat">
          <div className="dash-hero-value">{pendingQuests.length}</div>
          <div className="dash-hero-label">Pending Quests</div>
        </div>
        <div className="dash-hero-stat">
          <div className={`dash-hero-value${blockedQuests.length > 0 ? " dash-hero-value-warning" : ""}`}>
            {blockedQuests.length}
          </div>
          <div className="dash-hero-label">Blocked</div>
        </div>
        <div className="dash-hero-stat">
          <div className="dash-hero-value">{formatUsd(spent)}</div>
          <div className="dash-hero-label">Usage Today</div>
        </div>
      </div>

      {/* Budget utilization bar */}
      <div className="dash-budget">
        <div className="dash-budget-header">
          <span className="dash-budget-title">Daily Usage</span>
          <span className="dash-budget-numbers">
            {formatUsd(spent)} / {formatUsd(budget)} ({pct.toFixed(0)}%)
          </span>
        </div>
        <div className="dash-budget-track">
          <div className="dash-budget-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Two column grid */}
      <div className="dash-grid">
        <div className="dash-col">
          {/* Active Work panel */}
          <div className="dash-panel">
            <div className="dash-panel-header">
              <span className="dash-panel-title">Active Quests</span>
            </div>
            {activeQuests.length === 0 ? (
              <div className="dash-panel-empty">No active quests</div>
            ) : (
              activeQuests.map((q: any) => {
                const phase = runtimeLabel(q.runtime);
                return (
                  <div key={q.id} className="dash-active-row">
                    <span className="dash-active-agent">
                      {q.assignee || q.agent || "\u2014"}
                    </span>
                    <span className="dash-active-subject">{q.subject}</span>
                    {phase && <span className="dash-active-phase">{phase}</span>}
                    <span className="dash-done-time">
                      {timeAgo(q.started_at || q.updated_at || q.created_at)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Blocked Work panel */}
          <div className="dash-panel">
            <div className="dash-panel-header">
              <span className="dash-panel-title">Blocked</span>
            </div>
            {blockedQuests.length === 0 ? (
              <div className="dash-panel-empty">Nothing blocked</div>
            ) : (
              blockedQuests.map((q: any) => (
                <div key={q.id} className="dash-blocked-row">
                  <span className="dash-blocked-subject">
                    {q.id} — {q.subject}
                  </span>
                  {q.blocked_reason && (
                    <span className="dash-blocked-reason">{q.blocked_reason}</span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Recently Completed */}
          <div className="dash-panel">
            <div className="dash-panel-header">
              <span className="dash-panel-title">Recently Completed</span>
            </div>
            {doneQuests.length === 0 ? (
              <div className="dash-panel-empty">No completed quests</div>
            ) : (
              doneQuests.map((q: any) => (
                <div key={q.id} className="dash-done-row">
                  <span className="dash-done-subject">{q.subject}</span>
                  <span className="dash-done-time">
                    {timeAgo(q.updated_at || q.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dash-col">
          {/* Activity Feed */}
          <div className="dash-panel">
            <div className="dash-panel-header">
              <span className="dash-panel-title">Activity</span>
            </div>
            {events.length === 0 ? (
              <div className="dash-panel-empty">No recent activity</div>
            ) : (
              events.slice(0, 15).map((e: any, i: number) => (
                <div key={e.id || i} className="dash-audit-row">
                  <span className="dash-audit-time">
                    {timeAgo(e.timestamp || e.created_at)}
                  </span>
                  <span className="dash-audit-agent">
                    {e.agent || e.actor || "\u2014"}
                  </span>
                  <span className="dash-audit-summary">
                    {e.summary || e.reasoning || e.description || e.decision_type || "\u2014"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
