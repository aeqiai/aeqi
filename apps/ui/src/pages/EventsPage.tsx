import { useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { useChatStore } from "@/store/chat";
import { timeAgo } from "@/lib/format";
import { DataState } from "@/components/ui";

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
      (e: any) => e.agent === selectedAgent.name || e.agent?.includes(selectedAgent.name)
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

  return (
    <div className="page-content">
      <div className="q-hero">
        <div className="q-hero-left">
          <h1 className="q-hero-title">Events</h1>
          <p className="q-hero-subtitle">Real-time activity stream across all agents</p>
        </div>
      </div>

      {selectedAgent && (
        <div className="filters">
          <span className="filter-agent-badge">
            Filtered: {selectedAgent.display_name || selectedAgent.name}
          </span>
        </div>
      )}

      <DataState
        loading={loading}
        empty={filtered.length === 0}
        emptyTitle="No events"
        emptyDescription="No events recorded yet."
        loadingText="Loading events..."
      >
        <div className="events-stream">
          {grouped.map((group) => (
            <div key={group.key}>
              <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 500, color: "rgba(0,0,0,0.25)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {group.label}
              </div>
              {group.events.map((event: any, i: number) => (
                <div key={event.id || i} className="event-row">
                  <span className="event-time">{timeAgo(event.timestamp || event.created_at)}</span>
                  <span className="event-type-badge">
                    {formatDecisionType(event.decision_type || event.event_type || "event")}
                  </span>
                  <span className="event-agent">{event.agent || "\u2014"}</span>
                  <span className="event-summary">
                    {event.summary || event.reasoning || event.description || "\u2014"}
                  </span>
                  {event.task_id && (
                    <code className="event-quest-id">{event.task_id}</code>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </DataState>
    </div>
  );
}
