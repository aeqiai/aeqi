import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useInboxStore } from "@/store/inbox";
import { useNav } from "@/hooks/useNav";
import { ThinkingDot } from "@/components/ui";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort, type RecencyBucket } from "@/lib/format";

const NO_SESSIONS: SessionInfo[] = [];

interface ThreadRow {
  id: string;
  name: string;
  badge?: string;
  time: string;
  status?: string;
  group: RecencyBucket;
  sortKey: number;
}

/**
 * Threads rail — the left-adjacent index column for the Inbox surface.
 *
 * Mounted between the primary LeftSidebar and the main content column when
 * the current tab is Inbox (sessions). Other tabs render their own inline
 * picker inside the content column. Dense single-line rows with a status
 * dot, the thread label, and a right-aligned relative timestamp —
 * Bloomberg-Terminal-for-threads.
 */
export default function SessionsRail() {
  const { agentId, itemId } = useParams<{ agentId?: string; itemId?: string }>();
  const { goAgent } = useNav();

  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );
  const streamingSessions = useChatStore((s) => s.streamingSessions);
  const inboxItems = useInboxStore((s) => s.items);
  const awaitingSessionIds = useMemo(
    () => new Set(inboxItems.map((i) => i.session_id)),
    [inboxItems],
  );

  const items = useMemo<ThreadRow[]>(() => {
    return sessions
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
        return {
          id: s.id,
          name: sessionLabel(s),
          badge,
          // `timeShort` matches the home inbox's compact mono column —
          // `5m` / `3h` / `2d` / `Apr 12` — same vocabulary across both
          // surfaces.
          time: timeShort(tsRaw ?? null),
          status: s.status,
          group: recencyBucket(tsRaw ?? null),
          sortKey: ts,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [sessions]);

  const handleSelect = (id: string) => {
    if (!agentId) return;
    goAgent(agentId, "sessions", id, { replace: true });
  };

  return (
    <div className="threads-rail">
      <div className="threads-rail-list">
        {items.length === 0 && (
          <div className="threads-rail-empty">
            <div className="threads-rail-empty-title">No threads yet</div>
            <div className="threads-rail-empty-hint">Type below to start one</div>
          </div>
        )}
        {items.map((item, i) => {
          const showHeader = i === 0 || items[i - 1]?.group !== item.group;
          return (
            <div key={item.id}>
              {showHeader && (
                <div className="threads-rail-group">
                  <span className="threads-rail-group-label">{item.group}</span>
                  <span className="threads-rail-group-rule" />
                </div>
              )}
              <button
                type="button"
                className={`threads-rail-row${item.id === itemId ? " active" : ""}`}
                data-status={item.status}
                aria-current={item.id === itemId ? "true" : undefined}
                onClick={() => handleSelect(item.id)}
              >
                {streamingSessions[item.id] ? (
                  <ThinkingDot size="md" className="threads-rail-row-thinking" />
                ) : (
                  <span
                    className={`threads-rail-row-status${
                      item.status === "active" ? "" : " threads-rail-row-status--idle"
                    }`}
                  />
                )}
                <span className="threads-rail-row-name">{item.name}</span>
                {item.badge && <span className="threads-rail-row-badge">{item.badge}</span>}
                {awaitingSessionIds.has(item.id) && (
                  <span className="sessions-rail-awaiting-dot" aria-label="awaiting your reply" />
                )}
                <span className="threads-rail-row-time">{item.time}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
