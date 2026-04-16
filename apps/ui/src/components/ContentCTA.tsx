import { useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useNav } from "@/hooks/useNav";
import { sessionLabel, type SessionInfo } from "@/components/session/types";

// Stable empty-array reference. Returning a fresh `[]` from a Zustand
// selector on every render triggers React error #185 (infinite update loop).
const NO_SESSIONS: SessionInfo[] = [];

/** Page-keyed primary action shown at the top of the right rail. */
const PAGE_ACTIONS: Record<string, { label: string; event: string } | null> = {
  agents: { label: "New agent", event: "aeqi:create" },
  events: { label: "New event", event: "aeqi:create" },
  quests: { label: "New quest", event: "aeqi:create" },
  ideas: { label: "New idea", event: "aeqi:create" },
  sessions: { label: "New chat", event: "aeqi:new-session" },
  settings: null,
  profile: null,
  tools: null,
};

/**
 * Unified right rail inside the content card.
 *
 * Version B: every URL is `/:agentId/:tab(/:itemId)?`. The tab segment tells
 * us which rail content to show. For sessions, we render the session list
 * backed by chat store (same data `AgentSessionView` populates).
 */
export default function ContentCTA() {
  const { agentId, tab, itemId } = useParams<{
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const { goAgent } = useNav();

  const section = tab || "";
  const isChat = section === "sessions";
  const chatAgentId = isChat ? agentId || null : null;
  const activeSessionId = isChat ? itemId || null : null;

  const action = PAGE_ACTIONS[section] ?? null;

  const sessions = useChatStore((s) =>
    chatAgentId ? s.sessionsByAgent[chatAgentId] || NO_SESSIONS : NO_SESSIONS,
  );

  const handleSelectSession = (sid: string) => {
    if (!chatAgentId) return;
    goAgent(chatAgentId, "sessions", sid, { replace: true });
  };

  return (
    <div className="asv-sidebar">
      {action && (
        <div className="asv-sidebar-header">
          <button
            className="asv-session-new-btn"
            onClick={() => window.dispatchEvent(new CustomEvent(action.event))}
          >
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
            {action.label}
          </button>
        </div>
      )}
      <div className="asv-sidebar-list">
        {isChat && sessions.length === 0 && (
          <div className="asv-sidebar-empty">No sessions yet</div>
        )}
        {isChat &&
          sessions.map((s) => {
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
                onClick={() => handleSelectSession(s.id)}
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
