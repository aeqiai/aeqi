import { useEffect, useState } from "react";
import { useNav } from "@/hooks/useNav";
import CreateAgentModal from "@/components/CreateAgentModal";
import { useDaemonStore } from "@/store/daemon";
import { timeAgo } from "@/lib/format";
import RoundAvatar from "@/components/RoundAvatar";
import type { Agent } from "@/lib/types";
import styles from "./AgentsPage.module.css";

export default function AgentsPage() {
  const { go } = useNav();
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
      a.model?.toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = agents.filter((a) => a.status === "active" || a.status === "running").length;

  return (
    <div className={`page-content ${styles.page}`}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Agents</h1>
          <span className={styles.count}>{agents.length}</span>
        </div>
        <button className={styles.newBtn} onClick={() => setModalOpen(true)}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M6 2.5v7M2.5 6h7" />
          </svg>
          New Agent
        </button>
      </div>

      {/* Stats strip */}
      {agents.length > 0 && (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statDotActive} />
            <span className={styles.statLabel}>{activeCount} active</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabelMuted}>{agents.length - activeCount} idle</span>
          </div>
        </div>
      )}

      {/* Search */}
      {agents.length > 3 && (
        <div className={styles.search}>
          <svg
            className={styles.searchIcon}
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          >
            <circle cx="6" cy="6" r="4.5" />
            <path d="M9.5 9.5L13 13" />
          </svg>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Filter agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div className={styles.grid}>
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id || agent.name}
              agent={agent}
              onClick={() => go(`/agents/${agent.id || agent.name}`)}
            />
          ))}
        </div>
      )}

      {/* Empty */}
      {agents.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptySigil}>ae</div>
          <h3 className={styles.emptyTitle}>No agents yet</h3>
          <p className={styles.emptyDesc}>
            Agents research, code, review, and operate autonomously.
          </p>
          <button className={styles.newBtn} onClick={() => setModalOpen(true)}>
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
    <div className={styles.card} onClick={onClick}>
      <div className={styles.cardTop}>
        <RoundAvatar name={agent.name} size={36} />
        <span className={isActive ? styles.cardStatusActive : styles.cardStatus} />
      </div>
      <div className={styles.cardName}>{label}</div>
      <div className={styles.cardMeta}>
        <span className={styles.cardTemplate}>{agent.status}</span>
        {agent.model && <span className={styles.cardModel}>{agent.model.split("/").pop()}</span>}
      </div>
      <div className={styles.cardFooter}>
        {ideaCount > 0 && (
          <span className={styles.cardTag}>
            {ideaCount} idea{ideaCount !== 1 ? "s" : ""}
          </span>
        )}
        {agent.created_at && <span className={styles.cardTime}>{timeAgo(agent.created_at)}</span>}
      </div>
    </div>
  );
}
