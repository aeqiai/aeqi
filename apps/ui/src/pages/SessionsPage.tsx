import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useDaemonStore } from "@/store/daemon";
import { useCompanyNav } from "@/hooks/useCompanyNav";
import { DataState } from "@/components/ui";
import type { Agent } from "@/lib/types";
import styles from "./SessionsPage.module.css";

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
  return <span className={active ? styles.statusActive : styles.statusClosed} />;
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
    <div className={`page-content ${styles.page}`}>
      {/* Stats bar */}
      {stats.total > 0 && (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.total}</span>
            <span className={styles.statLabel}>Total</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={styles.statValue}>{stats.active}</span>
            <span className={styles.statLabel}>Active</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.stat}>
            <span className={`${styles.statValue} ${styles.statMuted}`}>{stats.closed}</span>
            <span className={styles.statLabel}>Closed</span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      {stats.total > 0 && (
        <div className={styles.toolbar}>
          <div className={styles.filterTabs}>
            {statusFilters.map((f) => (
              <button
                key={f.key}
                className={statusFilter === f.key ? styles.filterTabActive : styles.filterTab}
                onClick={() => setStatusFilter(f.key)}
                type="button"
              >
                {f.label}
                {f.key === "active" && stats.active > 0 && (
                  <span className={styles.filterTabCount}>{stats.active}</span>
                )}
              </button>
            ))}
          </div>

          <div className={styles.toolbarRight}>
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} viewBox="0 0 16 16" fill="none">
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
                className={styles.search}
                placeholder="Filter sessions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className={styles.agentFilter}
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
      <div className={styles.list}>
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
          <div className={styles.rowHeader}>
            <div className={styles.cellStatus} />
            <div className={styles.cellAgent}>Agent</div>
            <div className={styles.cellName}>Session</div>
            <div className={styles.cellStatusLabel}>Status</div>
            <div className={styles.cellSpacer} />
            <div className={styles.cellDuration}>Duration</div>
            <div className={styles.cellTime}>Created</div>
          </div>

          {/* Rows */}
          {sorted.map((s) => {
            const active = isActive(s);
            const duration = computeDuration(s);
            const avatar = agentAvatar(agents, s.agent_id);

            return (
              <div
                key={s.id}
                className={`${styles.rowData}${!active ? ` ${styles.rowClosed}` : ""}`}
                onClick={() => handleRowClick(s)}
              >
                <div className={styles.cellStatus}>
                  <SessionStatusDot active={active} />
                </div>
                <div className={styles.cellAgent}>
                  {avatar ? (
                    <img className={styles.agentAvatar} src={avatar} alt="" />
                  ) : (
                    <span className={styles.agentAvatarFallback}>
                      {agentDisplayName(agents, s.agent_id).charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className={styles.agentName}>{agentDisplayName(agents, s.agent_id)}</span>
                </div>
                <div className={styles.cellName}>
                  <span className={styles.sessionName}>{s.name || s.id.slice(0, 12)}</span>
                </div>
                <div className={styles.cellStatusLabel}>
                  <span className={active ? styles.badgeActive : styles.badgeClosed}>
                    {active ? "active" : "closed"}
                  </span>
                </div>
                <div className={styles.cellSpacer} />
                <div className={styles.cellDuration}>{formatDuration(duration)}</div>
                <div className={styles.cellTime}>{timeAgo(s.created_at)}</div>
              </div>
            );
          })}
        </DataState>
      </div>
    </div>
  );
}
