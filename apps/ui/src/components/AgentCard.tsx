import { Link } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import type { Agent } from "@/lib/types";

interface AgentCardProps {
  agent: Agent;
  compact?: boolean;
}

export default function AgentCard({ agent, compact = false }: AgentCardProps) {
  const label = agent.display_name || agent.name;

  if (compact) {
    return (
      <Link to={`/agents/${agent.name}`} className="agent-card-compact">
        <div className="agent-card-compact-header">
          <div className="agent-name-row">
            <span className="agent-name">{label}</span>
          </div>
          <StatusBadge status={agent.status} size="sm" />
        </div>
        {agent.model && (
          <div className="agent-model">{agent.model}</div>
        )}
      </Link>
    );
  }

  return (
    <Link to={`/agents/${agent.name}`} className="agent-card">
      <div className="agent-card-header">
        <div>
          <div className="agent-name-row">
            <span className="agent-name">{label}</span>
          </div>
          {agent.model && (
            <div className="agent-role-model">
              <span className="agent-model">{agent.model}</span>
            </div>
          )}
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="agent-expertise">
          {agent.capabilities.map((cap) => (
            <span key={cap} className="expertise-tag">
              {cap}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
