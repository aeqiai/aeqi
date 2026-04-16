import { type SessionInfo, sessionLabel } from "./types";

interface SessionSidebarProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onNewConversation: () => void;
  onSelectSession: (sid: string) => void;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onNewConversation,
  onSelectSession,
}: SessionSidebarProps) {
  return (
    <div className="asv-sidebar">
      <div className="asv-sidebar-list">
        {sessions.length === 0 && <div className="asv-sidebar-empty">No sessions yet</div>}
        {sessions.map((s) => {
          const n = s.name?.toLowerCase() || "";
          const transport = n.includes("telegram")
            ? "TG"
            : n.includes("whatsapp")
              ? "WA"
              : s.session_type === "web"
                ? "Web"
                : null;
          return (
            <div
              key={s.id}
              className={`asv-session-item${s.id === activeSessionId ? " active" : ""}`}
              onClick={() => onSelectSession(s.id)}
            >
              <div className="asv-session-item-top">
                <span className="asv-session-item-name">{sessionLabel(s)}</span>
                {transport && <span className="asv-session-item-transport">{transport}</span>}
              </div>
              {s.first_message && (
                <div className="asv-session-item-bottom">
                  <span className="asv-session-item-preview">{s.first_message.slice(0, 40)}</span>
                  <span className="asv-session-item-date">
                    {s.created_at
                      ? new Date(s.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })
                      : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
