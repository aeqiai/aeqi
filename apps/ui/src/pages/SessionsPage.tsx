import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useDaemonStore } from "@/store/daemon";
import { useCompanyNav } from "@/hooks/useCompanyNav";
import { DataState } from "@/components/ui";
import type { Agent } from "@/lib/types";

/* ── Types ──────────────────────────────────────────── */

interface Session {
  id: string;
  agent_id: string;
  status: string;
  name?: string;
  created_at: string;
  closed_at?: string;
  updated_at?: string;
  duration_secs?: number;
  message_count?: number;
  cost_usd?: number;
  model?: string;
}

type StatusFilter = "all" | "active" | "closed";

/* ── Helpers ─────────────────────────────────────────── */

function formatDuration(secs: number | undefined | null): string {
  if (secs == null || secs <= 0) return "--";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function computeDuration(s: Session): number | null {
  if (s.duration_secs != null) return s.duration_secs;
  if (s.created_at) {
    const end = s.closed_at || s.updated_at;
    if (end) {
      return Math.max(
        0,
        Math.floor((new Date(end).getTime() - new Date(s.created_at).getTime()) / 1000),
      );
    }
  }
  return null;
}

function isActive(s: Session): boolean {
  const st = (s.status || "").toLowerCase();
  return st !== "closed" && st !== "done" && st !== "cancelled" && st !== "error";
}

function agentDisplayName(agents: Agent[], agentId: string): string {
  const a = agents.find((ag) => ag.id === agentId || ag.name === agentId);
  return a?.display_name || a?.name || agentId;
}

function agentAvatar(agents: Agent[], agentId: string): string | undefined {
  const a = agents.find((ag) => ag.id === agentId || ag.name === agentId);
  return a?.avatar;
}

/* ── Status Indicator ───────────────────────────────── */

function SessionStatusDot({ active }: { active: boolean }) {
  return <span className={`ss-status-dot ${active ? "ss-status-active" : "ss-status-closed"}`} />;
}

/* ── Main Page ──────────────────────────────────────── */

export default function SessionsPage() {
  const agents = useDaemonStore((s) => s.agents);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const { go } = useCompanyNav();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.getSessions(agentFilter || undefined);
      const raw = data?.sessions || [];
      setSessions(Array.isArray(raw) ? (raw as Session[]) : []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [agentFilter]);

  useEffect(() => {
    setLoading(true);
    fetchSessions();
  }, [fetchSessions]);

  // Ensure agents are loaded for display names
  useEffect(() => {
    if (agents.length === 0) fetchAgents();
  }, [agents.length, fetchAgents]);

  // Keyboard: / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Filter
  const filtered = useMemo(() => {
    let result = sessions;

    if (statusFilter === "active") {
      result = result.filter((s) => isActive(s));
    } else if (statusFilter === "closed") {
      result = result.filter((s) => !isActive(s));
    }

    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(
        (s) =>
          (s.name || "").toLowerCase().includes(term) ||
          s.id.toLowerCase().includes(term) ||
          s.agent_id.toLowerCase().includes(term) ||
          agentDisplayName(agents, s.agent_id).toLowerCase().includes(term),
      );
    }

    return result;
  }, [sessions, statusFilter, search, agents]);

  // Sort: active first, then by created_at desc
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aActive = isActive(a) ? 1 : 0;
      const bActive = isActive(b) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filtered]);

  // Stats
  const stats = useMemo(() => {
    const active = sessions.filter((s) => isActive(s)).length;
    const closed = sessions.length - active;
    return { total: sessions.length, active, closed };
  }, [sessions]);

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "closed", label: "Closed" },
  ];

  const handleRowClick = (s: Session) => {
    go(`/agents/${encodeURIComponent(s.agent_id)}/sessions/${encodeURIComponent(s.id)}`);
  };

  return (
    <div className="page-content ss-page">
      {/* Stats bar */}
      {stats.total > 0 && (
        <div className="ss-stats">
          <div className="ss-stat">
            <span className="ss-stat-value">{stats.total}</span>
            <span className="ss-stat-label">Total</span>
          </div>
          <div className="ss-stat-divider" />
          <div className="ss-stat">
            <span className="ss-stat-value">{stats.active}</span>
            <span className="ss-stat-label">Active</span>
          </div>
          <div className="ss-stat-divider" />
          <div className="ss-stat">
            <span className="ss-stat-value ss-stat-muted">{stats.closed}</span>
            <span className="ss-stat-label">Closed</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      {stats.total > 0 && (
        <div className="ss-toolbar">
          <div className="ss-filter-tabs">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                className={`ss-filter-tab${statusFilter === f.key ? " active" : ""}`}
                onClick={() => setStatusFilter(f.key)}
                type="button"
              >
                {f.label}
                {f.key === "active" && stats.active > 0 && (
                  <span className="ss-filter-tab-count">{stats.active}</span>
                )}
              </button>
            ))}
          </div>

          <div className="ss-toolbar-right">
            <div className="ss-search-wrap">
              <svg className="ss-search-icon" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M10.5 10.5L14 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                ref={searchRef}
                className="ss-search"
                placeholder="Filter sessions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className="ss-agent-filter"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id || a.name}>
                  {a.display_name || a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* List */}
      <div className="ss-list">
        <DataState
          loading={loading}
          empty={sorted.length === 0 && !loading}
          emptyTitle={stats.total === 0 ? "No sessions yet" : "No matching sessions"}
          emptyDescription={
            stats.total === 0
              ? "Sessions are created when agents start working. Chat with an agent or assign a quest to begin."
              : "Try adjusting your filters or search query."
          }
        >
          {/* Table header */}
          <div className="ss-row ss-row-header">
            <div className="ss-cell ss-cell-status" />
            <div className="ss-cell ss-cell-agent">Agent</div>
            <div className="ss-cell ss-cell-name">Session</div>
            <div className="ss-cell ss-cell-status-label">Status</div>
            <div className="ss-cell ss-cell-spacer" />
            <div className="ss-cell ss-cell-duration">Duration</div>
            <div className="ss-cell ss-cell-time">Created</div>
          </div>

          {/* Rows */}
          {sorted.map((s) => {
            const active = isActive(s);
            const duration = computeDuration(s);
            const avatar = agentAvatar(agents, s.agent_id);

            return (
              <div
                key={s.id}
                className={`ss-row ss-row-data${!active ? " ss-row-closed" : ""}`}
                onClick={() => handleRowClick(s)}
              >
                <div className="ss-cell ss-cell-status">
                  <SessionStatusDot active={active} />
                </div>
                <div className="ss-cell ss-cell-agent">
                  {avatar ? (
                    <img className="ss-agent-avatar" src={avatar} alt="" />
                  ) : (
                    <span className="ss-agent-avatar-fallback">
                      {agentDisplayName(agents, s.agent_id).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="ss-agent-name">{agentDisplayName(agents, s.agent_id)}</span>
                </div>
                <div className="ss-cell ss-cell-name">
                  <span className="ss-session-name">{s.name || s.id.slice(0, 12)}</span>
                </div>
                <div className="ss-cell ss-cell-status-label">
                  <span
                    className={`ss-status-badge${active ? " ss-badge-active" : " ss-badge-closed"}`}
                  >
                    {active ? "active" : "closed"}
                  </span>
                </div>
                <div className="ss-cell ss-cell-spacer" />
                <div className="ss-cell ss-cell-duration">{formatDuration(duration)}</div>
                <div className="ss-cell ss-cell-time">{timeAgo(s.created_at)}</div>
              </div>
            );
          })}
        </DataState>
      </div>
    </div>
  );
}
