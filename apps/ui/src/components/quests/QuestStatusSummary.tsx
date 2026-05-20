import type { Quest, QuestStatus } from "@/lib/types";
import StatusDot from "./StatusDot";

interface QuestStatusSummaryProps {
  columns: Array<{ status: QuestStatus; label: string }>;
  grouped: Record<QuestStatus, Quest[]>;
}

export default function QuestStatusSummary({ columns, grouped }: QuestStatusSummaryProps) {
  return (
    <div className="quest-status-summary" role="list" aria-label="Quest status counts">
      {columns.map((col) => (
        <div
          key={col.status}
          className="quest-status-summary-item"
          data-status={col.status}
          role="listitem"
          aria-label={`${col.label}: ${grouped[col.status]?.length ?? 0}`}
        >
          <StatusDot status={col.status} />
          <span className="quest-status-summary-label">{col.label}</span>
          <span className="quest-status-summary-count">{grouped[col.status]?.length ?? 0}</span>
        </div>
      ))}
    </div>
  );
}
