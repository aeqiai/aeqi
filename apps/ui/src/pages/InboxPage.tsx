import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "@/components/BlockAvatar";
import "@/styles/inbox.css";

interface InboxItem {
  id: string;
  type: "message" | "approval" | "notification";
  agent: string;
  agentId?: string;
  sessionId?: string;
  summary: string;
  detail?: string;
  timestamp: string;
  read: boolean;
}

type Filter = "all" | "unread" | "messages" | "approvals";

export default function InboxPage() {
  const navigate = useNavigate();
  const events = useDaemonStore((s) => s.events);
  const agents = useDaemonStore((s) => s.agents);
  const [filter, setFilter] = useState<Filter>("all");
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("aeqi:inbox-read") || "[]"));
    } catch {
      return new Set();
    }
  });

  // Derive inbox items from events + agent activity
  const items: InboxItem[] = useMemo(() => {
    const result: InboxItem[] = [];

    // Agent messages and decisions from events
    for (const event of events.slice(0, 100)) {
      const meta = (event.metadata || {}) as Record<string, string>;
      const eventType = event.decision_type || "";
      const summary = event.summary || meta.reasoning || meta.description || "";
      const agent = event.agent || meta.actor || "";
      if (!summary || !agent) continue;

      const isApproval =
        eventType.includes("approval") ||
        eventType.includes("confirm") ||
        eventType.includes("blocked");
      const isMessage =
        eventType.includes("message") ||
        eventType.includes("complete") ||
        eventType.includes("handoff");

      if (isApproval || isMessage) {
        const agentRecord = agents.find(
          (a) => a.name === agent || a.display_name === agent,
        );
        result.push({
          id: String(event.id),
          type: isApproval ? "approval" : "message",
          agent,
          agentId: agentRecord?.id,
          sessionId: meta.session_id,
          summary,
          detail: meta.reasoning || meta.description,
          timestamp: event.timestamp,
          read: readIds.has(String(event.id)),
        });
      }
    }

    // Notification-style items from recent quest updates
    const quests = useDaemonStore.getState().quests || [];
    for (const quest of quests.slice(0, 20)) {
      if (quest.status === "blocked" || quest.status === "done") {
        const agentRecord = agents.find((a) => a.name === quest.assignee);
        result.push({
          id: `quest-${quest.id}`,
          type: "notification",
          agent: quest.assignee || "system",
          agentId: agentRecord?.id,
          summary: `Quest "${quest.subject}" is ${quest.status}`,
          detail: quest.closed_reason || quest.description,
          timestamp: quest.updated_at || quest.created_at,
          read: readIds.has(`quest-${quest.id}`),
        });
      }
    }

    // Sort by timestamp descending
    result.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    return result;
  }, [events, agents, readIds]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "unread":
        return items.filter((i) => !i.read);
      case "messages":
        return items.filter((i) => i.type === "message");
      case "approvals":
        return items.filter((i) => i.type === "approval");
      default:
        return items;
    }
  }, [items, filter]);

  const unreadCount = items.filter((i) => !i.read).length;

  const markRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("aeqi:inbox-read", JSON.stringify([...next]));
      return next;
    });
  };

  const markAllRead = () => {
    const allIds = items.map((i) => i.id);
    setReadIds(new Set(allIds));
    localStorage.setItem("aeqi:inbox-read", JSON.stringify(allIds));
  };

  const handleClick = (item: InboxItem) => {
    markRead(item.id);
    if (item.sessionId) {
      navigate(
        `/?agent=${encodeURIComponent(item.agentId || item.agent)}&session=${encodeURIComponent(item.sessionId)}`,
      );
    } else if (item.agentId) {
      navigate(`/?agent=${encodeURIComponent(item.agentId)}`);
    }
  };

  const typeIcon = (type: InboxItem["type"]) => {
    switch (type) {
      case "message":
        return "💬";
      case "approval":
        return "⚠";
      case "notification":
        return "🔔";
    }
  };

  return (
    <div className="inbox">
      <div className="inbox-header">
        <div className="inbox-title">
          <h2>Events</h2>
          {unreadCount > 0 && (
            <span className="inbox-unread-badge">{unreadCount}</span>
          )}
        </div>
        <div className="inbox-actions">
          {unreadCount > 0 && (
            <button className="inbox-mark-all" onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="inbox-filters">
        {(["all", "unread", "messages", "approvals"] as Filter[]).map((f) => (
          <button
            key={f}
            className={`inbox-filter ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
            {f === "unread" && unreadCount > 0 && (
              <span className="inbox-filter-count">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="inbox-list">
        {filtered.length === 0 ? (
          <div className="inbox-empty">
            {filter === "unread"
              ? "All caught up."
              : "No items yet."}
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className={`inbox-item ${item.read ? "read" : "unread"}`}
              onClick={() => handleClick(item)}
            >
              <div className="inbox-item-left">
                <span className="inbox-item-dot" />
                <BlockAvatar name={item.agent} size={28} />
              </div>
              <div className="inbox-item-content">
                <div className="inbox-item-top">
                  <span className="inbox-item-agent">{item.agent}</span>
                  <span className="inbox-item-type">{typeIcon(item.type)}</span>
                  <span className="inbox-item-time">
                    {timeAgo(item.timestamp)}
                  </span>
                </div>
                <div className="inbox-item-summary">{item.summary}</div>
                {item.detail && (
                  <div className="inbox-item-detail">{item.detail}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
