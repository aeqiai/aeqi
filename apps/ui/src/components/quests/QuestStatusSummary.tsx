import type { Quest, QuestStatus } from "@/lib/types";
import StatusDot from "./StatusDot";

interface QuestStatusSummaryProps {
  columns: Array<{ status: QuestStatus; label: string }>;
  grouped: Record<QuestStatus, Quest[]>;
  collapsed?: Partial<Record<QuestStatus, boolean>>;
  onToggle?: (status: QuestStatus) => void;
}

export default function QuestStatusSummary({
  columns,
  grouped,
  collapsed = {},
  onToggle,
}: QuestStatusSummaryProps) {
  return (
    <div className="quest-status-summary" aria-label="Quest status counts">
      {columns.map((col) => (
        <button
          key={col.status}
          type="button"
          className="quest-status-summary-item"
          data-status={col.status}
          data-collapsed={collapsed[col.status] || undefined}
          onClick={() => onToggle?.(col.status)}
          aria-pressed={!!collapsed[col.status]}
          aria-label={`${collapsed[col.status] ? "Show" : "Hide"} ${col.label} column, ${
            grouped[col.status]?.length ?? 0
          } ${grouped[col.status]?.length === 1 ? "quest" : "quests"}`}
          title={`${collapsed[col.status] ? "Show" : "Hide"} ${col.label}`}
        >
          <StatusDot status={col.status} />
          <span className="quest-status-summary-label">{col.label}</span>
          <span className="quest-status-summary-count">{grouped[col.status]?.length ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
