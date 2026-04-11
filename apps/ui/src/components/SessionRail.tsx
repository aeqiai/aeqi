import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { timeAgo } from "@/lib/format";
import RoundAvatar from "./RoundAvatar";
import "@/styles/session-rail.css";

interface SessionItem {
  id: string;
  status: string;
  name?: string;
  created_at?: string;
  last_active?: string;
  message_count?: number;
  first_message?: string;
}

export default function SessionRail({
  agentId,
  activeSessionId,
}: {
  agentId: string;
  activeSessionId: string | null;
}) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const agentName = agent?.display_name || agent?.name || agentId;
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  useEffect(() => {
    api
      .getSessions(agentId)
      .then((d) => {
        const list = ((d as any).sessions || []) as SessionItem[];
        setSessions(list.sort((a, b) => {
          const ta = a.last_active || a.created_at || "";
          const tb = b.last_active || b.created_at || "";
          return tb.localeCompare(ta);
        }));
      })
      .catch(() => {});
  }, [agentId]);

  const handleSelect = (sid: string) => {
    navigate(`/agents?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(sid)}`);
  };

  const handleNew = () => {
    // Navigate without session — AgentSessionView will create one on first message
    navigate(`/agents?agent=${encodeURIComponent(agentId)}`);
  };

  return (
    <div className="sr">
      <div className="sr-agent">
        <RoundAvatar name={agent?.name || agentId} size={28} />
        <div className="sr-agent-info">
          <span className="sr-agent-name">{agentName}</span>
          <span className="sr-agent-status">{agent?.status || "active"}</span>
        </div>
      </div>
      <div className="sr-section-label">Sessions</div>
      <div className="sr-list">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`sr-item ${s.id === activeSessionId ? "sr-item--active" : ""}`}
            onClick={() => handleSelect(s.id)}
          >
            <span className="sr-item-name">
              {s.first_message
                ? s.first_message.slice(0, 30) + (s.first_message.length > 30 ? "..." : "")
                : timeAgo(s.created_at || "") || s.id.slice(0, 8)}
            </span>
            <span className="sr-item-time">
              {timeAgo(s.last_active || s.created_at || "")}
            </span>
          </button>
        ))}
        {sessions.length === 0 && (
          <div className="sr-empty">No sessions yet</div>
        )}
      </div>
      <button className="sr-new" onClick={handleNew}>
        + New session
      </button>
    </div>
  );
}
