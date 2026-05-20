import { CircleCheck, CircleDashed, Eye, PlayCircle } from "lucide-react";
import type { QuestStatus } from "@/lib/types";

interface QuestColumnEmptyStateProps {
  status: QuestStatus;
  isDropTarget: boolean;
}

/**
 * Centered empty state for a kanban column — icon + title + hint.
 *
 * Per-status messaging:
 *   todo        → ready queue
 *   in_progress → active work
 *   in_review   → review queue
 *   done        → completed work
 *   others      → legacy bare "Nothing here" text.
 *
 * When the column is an active drop target the centered variant
 * gets swapped for the existing left-aligned "Drop here" affordance
 * so the drag visual stays consistent.
 */
export default function QuestColumnEmptyState({
  status,
  isDropTarget,
}: QuestColumnEmptyStateProps) {
  if (isDropTarget) {
    return <div className="quest-col-empty quest-col-empty--drop">Drop here</div>;
  }
  if (status === "todo") {
    return (
      <div className="quest-col-empty quest-col-empty--centered">
        <CircleDashed size={22} strokeWidth={1.5} className="quest-col-empty-icon" aria-hidden />
        <p className="quest-col-empty-title">Ready queue empty</p>
        <p className="quest-col-empty-hint">New quests land here first.</p>
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="quest-col-empty quest-col-empty--centered">
        <PlayCircle size={22} strokeWidth={1.5} className="quest-col-empty-icon" aria-hidden />
        <p className="quest-col-empty-title">No active quests</p>
        <p className="quest-col-empty-hint">In-flight work appears here.</p>
      </div>
    );
  }
  if (status === "in_review") {
    return (
      <div className="quest-col-empty quest-col-empty--centered">
        <Eye size={22} strokeWidth={1.5} className="quest-col-empty-icon" aria-hidden />
        <p className="quest-col-empty-title">No quests in review</p>
        <p className="quest-col-empty-hint">Review-ready work appears here.</p>
      </div>
    );
  }
  if (status === "done") {
    return (
      <div className="quest-col-empty quest-col-empty--centered">
        <CircleCheck size={22} strokeWidth={1.5} className="quest-col-empty-icon" aria-hidden />
        <p className="quest-col-empty-title">Nothing completed</p>
        <p className="quest-col-empty-hint">Closed quests settle here.</p>
      </div>
    );
  }
  return <div className="quest-col-empty">Nothing here</div>;
}

/**
 * Statuses whose column body collapses to header-only by default
 * (chevron toggle in the header expands them in place).
 */
export const COLLAPSIBLE_STATUSES = new Set<QuestStatus>(["backlog", "cancelled"]);
