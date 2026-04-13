import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import CreateAgentModal from "@/components/CreateAgentModal";
import { useDaemonStore } from "@/store/daemon";
import { timeAgo } from "@/lib/format";
import RoundAvatar from "@/components/RoundAvatar";
import type { Agent } from "@/lib/types";
import "@/styles/agents-page.css";

export default function AgentsPage() {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, []);

  const handleModalClose = () => setModalOpen(false);

  const filtered = agents.filter(
    (a) =>
      !search ||
      a.name?.toLowerCase().includes(search.toLowerCase()) ||
      a.display_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.template?.toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = agents.filter(
    (a) => a.status === "active" || a.status === "running",
  ).length;

  return (
    <div className="page-content ap">
      {/* Header */}
      <div className="ap-header">
        <div className="ap-header-left">
          <h1 className="ap-title">Agents</h1>
          <span className="ap-count">{agents.length}</span>
        </div>
        <button className="ap-new-btn" onClick={() => setModalOpen(true)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
          New Agent
        </button>
      </div>

      {/* Stats strip */}
      {agents.length > 0 && (
        <div className="ap-stats">
          <div className="ap-stat">
            <span className="ap-stat-dot ap-stat-dot--active" />
            <span className="ap-stat-label">{activeCount} active</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-label ap-stat-label--muted">{agents.length - activeCount} idle</span>
          </div>
        </div>
      )}

      {/* Search */}
      {agents.length > 3 && (
        <div className="ap-search">
          <svg className="ap-search-icon" width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" />
          </svg>
          <input
            className="ap-search-input"
            type="text"
            placeholder="Filter agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className="ap-grid">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id || agent.name}
              agent={agent}
              onClick={() => navigate(`/agents?agent=${encodeURIComponent(agent.id || agent.name)}`)}
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {agents.length === 0 && (
        <div className="ap-empty">
          <div className="ap-empty-sigil">æ</div>
          <h3 className="ap-empty-title">No agents yet</h3>
          <p className="ap-empty-desc">Agents research, code, review, and operate autonomously.</p>
          <button className="ap-new-btn" onClick={() => setModalOpen(true)}>
            Create your first agent
          </button>
        </div>
      )}

      <CreateAgentModal open={modalOpen} onClose={handleModalClose} />
    </div>
  );
}

function AgentCard({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const isActive = agent.status === "active" || agent.status === "running";
  const label = agent.display_name || agent.name;
  const ideaCount = (agent as any).idea_ids?.length || (agent as any).ideas?.length || 0;

  return (
    <div className="ap-card" onClick={onClick}>
      <div className="ap-card-top">
        <RoundAvatar name={agent.name} size={36} />
        <span className={`ap-card-status ${isActive ? "ap-card-status--active" : ""}`} />
      </div>
      <div className="ap-card-name">{label}</div>
      <div className="ap-card-meta">
        <span className="ap-card-template">{agent.template || "custom"}</span>
        {agent.model && (
          <span className="ap-card-model">{agent.model.split("/").pop()}</span>
        )}
      </div>
      <div className="ap-card-footer">
        {ideaCount > 0 && (
          <span className="ap-card-tag">{ideaCount} idea{ideaCount !== 1 ? "s" : ""}</span>
        )}
        {agent.created_at && (
          <span className="ap-card-time">{timeAgo(agent.created_at)}</span>
        )}
      </div>
    </div>
  );
}
