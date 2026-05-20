import { Eye, Sparkles } from "lucide-react";
import type { QuestStatus } from "@/lib/types";

interface QuestColumnEmptyStateProps {
  status: QuestStatus;
  isDropTarget: boolean;
}

/**
 * Centered empty state for a kanban column — icon + title + hint.
 *
 * Per-status messaging:
 *   in_progress → "Keep it moving"  / "You're making good progress."
 *   in_review   → "Almost there"    / "Review and iterate."
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
  if (status === "in_progress") {
    return (
      <div className="quest-col-empty quest-col-empty--centered">
        <Sparkles size={22} strokeWidth={1.5} className="quest-col-empty-icon" aria-hidden />
        <p className="quest-col-empty-title">Keep it moving</p>
        <p className="quest-col-empty-hint">You're making good progress.</p>
      </div>
    );
  }
  if (status === "in_review") {
    return (
      <div className="quest-col-empty quest-col-empty--centered">
        <Eye size={22} strokeWidth={1.5} className="quest-col-empty-icon" aria-hidden />
        <p className="quest-col-empty-title">Almost there</p>
        <p className="quest-col-empty-hint">Review and iterate.</p>
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
