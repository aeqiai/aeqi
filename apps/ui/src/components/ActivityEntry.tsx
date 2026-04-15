import type { ActivityEntry as ActivityEntryType } from "@/lib/types";

interface ActivityEntryProps {
  entry: ActivityEntryType;
  compact?: boolean;
}

const DECISION_TYPE_COLORS: Record<string, string> = {
  task_assigned: "var(--accent)",
  task_started: "var(--info)",
  task_completed: "var(--success)",
  mission_created: "var(--accent)",
  mission_decomposed: "var(--accent)",
  preflight_pass: "var(--success)",
  expertise_update: "var(--info)",
  failure_analyzed: "var(--warning)",
  watchdog_triggered: "var(--warning)",
  note_post: "var(--info)",
  notes_post: "var(--info)",
  reroute: "var(--warning)",
};

function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDecisionType(type: string): string {
  return type.replace(/_/g, " ");
}

export default function ActivityEntryComponent({ entry, compact = false }: ActivityEntryProps) {
  if (compact) {
    return (
      <div className="activity-entry-compact">
        <div className="activity-entry-compact-header">
          <span
            className="activity-type-dot"
            style={{
              backgroundColor: DECISION_TYPE_COLORS[entry.decision_type] || "var(--text-secondary)",
            }}
          />
          <span className="activity-timestamp-compact">{formatTimestamp(entry.timestamp)}</span>
        </div>
        <p className="activity-summary-compact">{entry.summary}</p>
      </div>
    );
  }

  return (
    <div className="activity-entry">
      <div className="activity-entry-header">
        <div className="activity-entry-left">
          <span className="activity-entry-id">#{entry.id}</span>
          <span
            className="activity-type-badge"
            style={{
              color: DECISION_TYPE_COLORS[entry.decision_type] || "var(--text-secondary)",
              backgroundColor: `color-mix(in srgb, ${DECISION_TYPE_COLORS[entry.decision_type] || "var(--text-secondary)"} 10%, transparent)`,
            }}
          >
            {formatDecisionType(entry.decision_type)}
          </span>
          {(entry.metadata as any)?.company && (
            <span className="activity-project">{(entry.metadata as any).company}</span>
          )}
        </div>
        <span className="activity-timestamp">{formatTimestamp(entry.timestamp)}</span>
      </div>

      <p className="activity-summary">{entry.summary}</p>

      <div className="activity-entry-footer">
        {entry.agent && <span className="activity-agent">{entry.agent}</span>}
        {entry.quest_id && <code className="activity-quest-id">{entry.quest_id}</code>}
      </div>
    </div>
  );
}
