import { useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { useChatStore } from "@/store/chat";
import { timeAgo } from "@/lib/format";
import styles from "./EventsPage.module.css";

function formatDecisionType(type: string): string {
  return type.replace(/_/g, " ");
}

function getDateGroupLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (eventDay.getTime() === today.getTime()) return "Today";
  if (eventDay.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function getDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EventsPage() {
  const events = useDaemonStore((s) => s.events);
  const loading = useDaemonStore((s) => s.loading);
  const selectedAgent = useChatStore((s) => s.selectedAgent);

  let filtered = events;
  if (selectedAgent) {
    filtered = filtered.filter(
      (e) => e.agent === selectedAgent.name || e.agent?.includes(selectedAgent.name),
    );
  }

  const grouped = useMemo(() => {
    const groups: { label: string; key: string; events: typeof filtered }[] = [];
    const seen = new Map<string, typeof filtered>();

    for (const event of filtered) {
      const ts = event.timestamp || (event as any).created_at;
      const key = ts ? getDateKey(ts) : "unknown";
      if (!seen.has(key)) {
        const arr: typeof filtered = [];
        seen.set(key, arr);
        groups.push({ label: ts ? getDateGroupLabel(ts) : "Unknown", key, events: arr });
      }
      seen.get(key)!.push(event);
    }
    return groups;
  }, [filtered]);

  if (loading) {
    return (
      <div className="page-content">
        <div
          style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)", padding: "32px 0" }}
        >
          Loading events…
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      {selectedAgent && (
        <div className="filters">
          <span className={styles.filterBadge}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
              <circle cx="4" cy="4" r="3" />
            </svg>
            Filtered: {selectedAgent.display_name || selectedAgent.name}
          </span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <svg
            className={styles.emptyIcon}
            viewBox="0 0 40 40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          >
            <rect x="6" y="6" width="28" height="28" rx="4" />
            <path d="M13 16h14M13 21h10M13 26h6" />
          </svg>
          <p className={styles.emptyTitle}>No events yet</p>
          <p className={styles.emptyDesc}>
            Events appear here as agents run quests, receive messages, and make decisions.
          </p>
        </div>
      ) : (
        <div className={styles.stream}>
          {grouped.map((group) => (
            <div key={group.key}>
              <div className={styles.dateGroup}>
                <div className={styles.dateLabel}>{group.label}</div>
              </div>
              {group.events.map((event: any, i: number) => (
                <div key={event.id || i} className={styles.row}>
                  <span className={styles.time}>
                    {timeAgo(event.timestamp || event.created_at)}
                  </span>
                  <span className={styles.typeBadge}>
                    {formatDecisionType(event.decision_type || event.event_type || "event")}
                  </span>
                  <span className={styles.agent}>{event.agent || "\u2014"}</span>
                  <span className={styles.summary}>
                    {event.summary || event.reasoning || event.description || "\u2014"}
                  </span>
                  {event.quest_id && <code className={styles.questId}>{event.quest_id}</code>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
