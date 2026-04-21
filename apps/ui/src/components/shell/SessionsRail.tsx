import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useNav } from "@/hooks/useNav";
import { sessionLabel, type SessionInfo } from "@/components/session/types";

// Stable empty-array reference. Returning a fresh `[]` from a Zustand
// selector on every render triggers React error #185 (infinite update loop).
const NO_SESSIONS: SessionInfo[] = [];

interface ThreadRow {
  id: string;
  name: string;
  badge?: string;
  meta?: string;
  status?: string;
  group: string;
  sortKey: number;
}

function recencyBucket(ts: number): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  if (ts >= today) return "Today";
  if (ts >= today - dayMs) return "Yesterday";
  if (ts >= today - 7 * dayMs) return "This week";
  if (ts >= today - 30 * dayMs) return "This month";
  return "Earlier";
}

/**
 * Threads rail — the left-adjacent index column for the Inbox surface.
 *
 * Mounted between the primary LeftSidebar and the main content column when
 * the current tab is Inbox (sessions). Other tabs keep their right rail via
 * ContentCTA. The rail lists chat sessions for the current agent with a
 * "New message" CTA header and the recency grouping the right rail used to
 * own. Click behavior is unchanged — `goAgent(agentId, "sessions", id)`.
 */
export default function SessionsRail() {
  const { agentId, itemId } = useParams<{ agentId?: string; itemId?: string }>();
  const { goAgent } = useNav();

  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );

  const items = useMemo<ThreadRow[]>(() => {
    return (
      sessions
        // Quest execution sessions belong in the Quests tab, not the Inbox.
        .filter((s) => s.session_type !== "task")
        .map((s) => {
          const n = s.name?.toLowerCase() || "";
          const badge = n.includes("telegram")
            ? "TG"
            : n.includes("whatsapp")
              ? "WA"
              : s.session_type === "web"
                ? "Web"
                : undefined;
          const tsRaw = s.last_active || s.created_at;
          const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
          const label = sessionLabel(s);
          const meta =
            s.message_count != null && s.message_count > 0 ? `${s.message_count}` : undefined;
          return {
            id: s.id,
            name: label,
            badge,
            meta,
            status: s.status,
            group: ts ? recencyBucket(ts) : "Earlier",
            sortKey: ts,
          };
        })
        .sort((a, b) => b.sortKey - a.sortKey)
    );
  }, [sessions]);

  const handleSelect = (id: string) => {
    if (!agentId) return;
    goAgent(agentId, "sessions", id, { replace: true });
  };

  const fireNewSession = () => window.dispatchEvent(new CustomEvent("aeqi:new-session"));

  return (
    <div className="asv-sidebar">
      <div className="asv-sidebar-header">
        <button
          type="button"
          className="asv-session-new-btn"
          onClick={fireNewSession}
          aria-label="New message"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 2.5v7M2.5 6h7" />
          </svg>
          New message
        </button>
      </div>
      <div className="asv-sidebar-list">
        {items.length === 0 && (
          <div className="asv-sidebar-empty">No threads yet. Type below to start one.</div>
        )}
        {items.map((item, i) => {
          const showHeader = i === 0 || items[i - 1]?.group !== item.group;
          return (
            <div key={item.id} className="asv-sidebar-row">
              {showHeader && <div className="asv-sidebar-group-header">{item.group}</div>}
              <button
                type="button"
                className={`asv-session-item${item.id === itemId ? " active" : ""}`}
                data-status={item.status}
                aria-current={item.id === itemId ? "true" : undefined}
                onClick={() => handleSelect(item.id)}
              >
                <div className="asv-session-item-top">
                  <span className="asv-session-item-name">{item.name}</span>
                  {item.badge && <span className="asv-session-item-transport">{item.badge}</span>}
                </div>
                {item.meta && (
                  <div className="asv-session-item-bottom">
                    <span className="asv-session-item-count">{item.meta}</span>
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
