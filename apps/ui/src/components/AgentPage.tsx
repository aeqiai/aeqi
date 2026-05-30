import { MessageSquare, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AgentAvatar from "./AgentAvatar";
import SurfaceHeader from "./SurfaceHeader";
import { Button, Icon } from "@/components/ui";
import { useNav } from "@/hooks/useNav";
import { entityPathFromId } from "@/lib/entityPath";
import { timeAgo } from "@/lib/format";
import { formatSpendUsd } from "@/lib/spend";
import { useDaemonStore } from "@/store/daemon";

/**
 * Drilled-agent landing.
 *
 * Clicking an agent should not open a nested inbox clone or a settings tab.
 * The canonical default is a compact identity/status card with explicit
 * exits to top-level Sessions and agent configuration.
 */
export default function AgentPage({
  agentId,
}: {
  agentId: string;
  // Kept for AppLayout's call-site compatibility. Drilled-agent default
  // always renders the detail card.
  tab?: string;
  itemId?: string | null;
}) {
  const navigate = useNavigate();
  const { base, trustId } = useNav();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);

  const agentName = agent?.name || agentId;
  const backHref = trustId ? entityPathFromId(entities, trustId, "agents") : `${base}/agents`;
  const settingsHref = `${base}/agents/${encodeURIComponent(agentId)}/settings`;
  const sessionsHref = `${base}/sessions?agent=${encodeURIComponent(agentId)}`;

  const liveness =
    agent?.status === "active" ? "online" : agent?.status === "stopped" ? "offline" : "idle";
  const lastActive = agent?.last_active ? timeAgo(agent.last_active) : null;
  const spend = formatSpendUsd(agent?.lifetime_cost_usd ?? 0);
  const sessionCount = agent?.session_count ?? 0;

  const title = (
    <span className="agent-surface-header-agent">
      <span className="agent-surface-header-avatar" aria-hidden>
        <AgentAvatar name={agentName} src={agent?.avatar} />
      </span>
      <span className="agent-surface-header-name">{agentName}</span>
    </span>
  );

  return (
    <div className="agent-detail-surface">
      <SurfaceHeader backHref={backHref} backLabel="Agents" title={title} />

      <main className="agent-detail-page" aria-label="Agent detail">
        <section className="agent-detail-card" aria-labelledby="agent-detail-title">
          <div className="agent-detail-card-head">
            <div className="agent-detail-avatar" aria-hidden>
              <AgentAvatar name={agentName} src={agent?.avatar} />
            </div>
            <div className="agent-detail-title-block">
              <h1 id="agent-detail-title" className="agent-detail-title">
                {agentName}
              </h1>
              <div className="agent-detail-subtitle">
                {agent?.execution_mode || "Runtime"} {"\u00b7"}{" "}
                {agent?.model || "No model selected"}
              </div>
            </div>
            <span className={`agent-liveness agent-liveness--${liveness}`}>
              <span className={`agent-liveness-dot agent-liveness-dot--${liveness}`} aria-hidden />
              {liveness === "online" ? "Online" : liveness === "offline" ? "Offline" : "Idle"}
            </span>
          </div>

          <dl className="agent-detail-facts">
            <div>
              <dt>Sessions</dt>
              <dd>{sessionCount}</dd>
            </div>
            <div>
              <dt>Last active</dt>
              <dd>{lastActive ?? "No activity"}</dd>
            </div>
            <div>
              <dt>Spend</dt>
              <dd>{spend}</dd>
            </div>
            <div>
              <dt>Agent ID</dt>
              <dd title={agentId}>{shortId(agentId)}</dd>
            </div>
          </dl>

          <div className="agent-detail-actions">
            <Button
              variant="primary"
              onClick={() => navigate(sessionsHref)}
              leadingIcon={<Icon icon={MessageSquare} size="sm" />}
            >
              Sessions
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(settingsHref)}
              leadingIcon={<Icon icon={Settings} size="sm" />}
            >
              Settings
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}
