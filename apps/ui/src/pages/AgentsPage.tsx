import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CreateAgentModal from "@/components/CreateAgentModal";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Agent } from "@/lib/types";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active" || status === "running" ? "#22c55e" :
    status === "idle" ? "rgba(0,0,0,0.2)" :
    status === "error" ? "#ef4444" :
    "rgba(0,0,0,0.15)";
  return (
    <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
  );
}

export default function AgentsPage() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, []);

  const loadAgents = () => {
    setLoading(true);
    api.getAgents().then((data) => {
      setAgents((data.agents || []) as Agent[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadAgents(); }, []);

  const handleModalClose = () => {
    setModalOpen(false);
    loadAgents();
  };

  const filtered = agents.filter((a) =>
    !search || a.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.display_name?.toLowerCase().includes(search.toLowerCase()) ||
    a.template?.toLowerCase().includes(search.toLowerCase())
  );

  const active = filtered.filter((a) => a.status === "active" || a.status === "running");
  const idle = filtered.filter((a) => a.status !== "active" && a.status !== "running" && a.status !== "error");
  const errored = filtered.filter((a) => a.status === "error");

  return (
    <div className="page-content q-page">
      {/* Stats */}
      {agents.length > 0 && (
        <div className="q-stats">
          <div className="q-stat">
            <span className="q-stat-value">{active.length}</span>
            <span className="q-stat-label">Active</span>
          </div>
          <div className="q-stat">
            <span className="q-stat-value">{idle.length}</span>
            <span className="q-stat-label">Idle</span>
          </div>
          <div className="q-stat">
            <span className="q-stat-value">{agents.length}</span>
            <span className="q-stat-label">Total</span>
          </div>
        </div>
      )}

      {/* Search */}
      {agents.length > 0 && (
        <div className="q-search-bar">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ color: "rgba(0,0,0,0.25)" }}>
            <circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" />
          </svg>
          <input
            className="q-search-input"
            type="text"
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Empty state */}
      {!loading && agents.length === 0 && (
        <div className="q-empty">
          <div className="q-empty-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="16" cy="12" r="6" />
              <path d="M6 28c0-5.5 4.5-10 10-10s10 4.5 10 10" />
            </svg>
          </div>
          <h3 className="q-empty-title">No agents yet</h3>
          <p className="q-empty-desc">Create your first agent to get started.</p>
          <button className="q-btn q-btn-primary" onClick={() => setModalOpen(true)} style={{ padding: "10px 24px" }}>
            New Agent
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && agents.length === 0 && (
        <div style={{ textAlign: "center", padding: 48, color: "rgba(0,0,0,0.3)", fontSize: 13 }}>
          Loading agents...
        </div>
      )}

      {/* Agent list */}
      {filtered.length > 0 && (
        <div className="q-list">
          {[
            { label: `Active (${active.length})`, items: active },
            { label: `Idle (${idle.length})`, items: idle },
            ...(errored.length > 0 ? [{ label: `Error (${errored.length})`, items: errored }] : []),
          ].filter((g) => g.items.length > 0).map((group) => (
            <div key={group.label}>
              <div className="q-group-header-static">{group.label}</div>
              {group.items.map((agent) => (
                <div
                  key={agent.name}
                  className="q-row"
                  onClick={() => navigate(`/?agent=${agent.name}`)}
                  style={{ cursor: "pointer" }}
                >
                  <StatusDot status={agent.status || "idle"} />
                  <span className="q-row-title">{agent.display_name || agent.name}</span>
                  {agent.template && (
                    <span style={{ fontSize: 11, color: "rgba(0,0,0,0.3)", marginLeft: 4 }}>{agent.template}</span>
                  )}
                  <span style={{ flex: 1 }} />
                  {agent.model && (
                    <span style={{ fontSize: 11, color: "rgba(0,0,0,0.2)", fontFamily: "var(--font-mono)" }}>{agent.model.split("/").pop()}</span>
                  )}
                  {agent.created_at && (
                    <span style={{ fontSize: 11, color: "rgba(0,0,0,0.2)", marginLeft: 12, minWidth: 50, textAlign: "right" }}>
                      {timeAgo(agent.created_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <CreateAgentModal open={modalOpen} onClose={handleModalClose} />
    </div>
  );
}
