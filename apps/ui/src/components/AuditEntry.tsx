import type { AuditEntry as AuditEntryType } from "@/lib/types";

interface AuditEntryProps {
  entry: AuditEntryType;
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

export default function AuditEntryComponent({
  entry,
  compact = false,
}: AuditEntryProps) {
  if (compact) {
    return (
      <div className="audit-entry-compact">
        <div className="audit-entry-compact-header">
          <span
            className="audit-type-dot"
            style={{
              backgroundColor:
                DECISION_TYPE_COLORS[entry.decision_type] ||
                "var(--text-secondary)",
            }}
          />
          <span className="audit-timestamp-compact">
            {formatTimestamp(entry.timestamp)}
          </span>
        </div>
        <p className="audit-summary-compact">{entry.summary}</p>
      </div>
    );
  }

  return (
    <div className="audit-entry">
      <div className="audit-entry-header">
        <div className="audit-entry-left">
          <span className="audit-entry-id">#{entry.id}</span>
          <span
            className="audit-type-badge"
            style={{
              color:
                DECISION_TYPE_COLORS[entry.decision_type] ||
                "var(--text-secondary)",
              backgroundColor: `color-mix(in srgb, ${DECISION_TYPE_COLORS[entry.decision_type] || "var(--text-secondary)"} 10%, transparent)`,
            }}
          >
            {formatDecisionType(entry.decision_type)}
          </span>
          <span className="audit-project">{entry.company}</span>
        </div>
        <span className="audit-timestamp">
          {formatTimestamp(entry.timestamp)}
        </span>
      </div>

      <p className="audit-summary">{entry.summary}</p>

      <div className="audit-entry-footer">
        {entry.agent && (
          <span className="audit-agent">{entry.agent}</span>
        )}
        {entry.task_id && (
          <code className="audit-task-id">{entry.task_id}</code>
        )}
      </div>
    </div>
  );
}
