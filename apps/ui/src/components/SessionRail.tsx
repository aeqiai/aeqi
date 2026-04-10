import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
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
    navigate(`/?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(sid)}`);
  };

  const handleNew = () => {
    // Navigate without session — AgentSessionView will create one on first message
    navigate(`/?agent=${encodeURIComponent(agentId)}`);
  };

  return (
    <div className="sr">
      <div className="sr-header">Sessions</div>
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
                : s.name || s.id.slice(0, 8)}
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
