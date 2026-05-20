import { FolderOpen } from "lucide-react";
import { api } from "@/lib/api";
import { dueLabel, isOverdue, timeAgo } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";
import type { Quest, QuestStatus, User } from "@/lib/types";
import { Icon } from "../ui";
import AssigneeAvatar from "./AssigneeAvatar";
import AssigneePicker from "./AssigneePicker";
import PriorityIcon from "./PriorityIcon";
import QuestScopeChip from "./QuestScopeChip";
import StatusDot from "./StatusDot";

/**
 * One draggable card on the active board. Carries the quest's identity
 * (status dot + subject) and lifecycle controls (priority · scope · take
 * · assignee · due · time). Extracted from `QuestBoard` so the column
 * shell stays inside the file's max-lines budget.
 *
 * Drag/drop state is owned by the parent board so dragging across
 * columns + into the archive strips works through a single source of
 * truth.
 */
export interface QuestActiveCardProps {
  q: Quest;
  optimistic: Record<string, QuestStatus>;
  dragging: string | null;
  focusId: string | null;
  setDragging: (id: string | null) => void;
  setDropTarget: (status: QuestStatus | null) => void;
  onPick: (id: string) => void;
  onTake: (id: string) => void | Promise<void>;
  onCreated: () => void;
  onError: (msg: string) => void;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  childCount?: number;
  /** When false, the card opts out of HTML5 drag-and-drop. Used by the
   *  scope band, which renders the same card chrome but is itself a
   *  drop target — letting the card be its own drag source would
   *  re-fire the drop on itself. Default: true. */
  draggable?: boolean;
  /** When true, the card paints the scope highlight ring — visual
   *  cue that this quest is the active board scope. The card stays
   *  fully draggable so the user can change its status without
   *  leaving the scoped view. */
  isScope?: boolean;
}

export default function QuestActiveCard({
  q,
  optimistic,
  dragging,
  focusId,
  setDragging,
  setDropTarget,
  onPick,
  onTake,
  onCreated,
  onError,
  agents,
  users,
  childCount = 0,
  draggable = true,
  isScope = false,
}: QuestActiveCardProps) {
  const canTake =
    q.status !== "in_progress" &&
    q.status !== "in_review" &&
    q.status !== "done" &&
    q.status !== "cancelled";

  return (
    <article
      className="quest-card"
      data-priority={q.priority}
      data-dragging={dragging === q.id || undefined}
      data-focused={focusId === q.id || undefined}
      data-scope={isScope || undefined}
      draggable={draggable}
      role="button"
      tabIndex={0}
      aria-label={
        childCount > 0
          ? `Open board for ${q.idea?.name ?? q.id}, ${childCount} subquests`
          : `Open quest ${q.idea?.name ?? q.id}`
      }
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", q.id);
              setDragging(q.id);
            }
          : undefined
      }
      onDragEnd={
        draggable
          ? () => {
              setDragging(null);
              setDropTarget(null);
            }
          : undefined
      }
      onClick={() => onPick(q.id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onPick(q.id);
      }}
    >
      <div className="quest-card-head">
        <StatusDot status={optimistic[q.id] ?? q.status} />
        <span className="quest-card-subject" title={q.idea?.name ?? q.id}>
          {q.idea?.name ?? q.id}
        </span>
        {childCount > 0 && (
          <span className="quest-child-count" aria-label={`${childCount} subquests`}>
            <Icon icon={FolderOpen} size="xs" />
            {childCount}
          </span>
        )}
      </div>
      <div className="quest-card-meta">
        <span className="quest-card-meta-left">
          <PriorityIcon priority={q.priority} />
          {q.scope && q.scope !== "self" && <QuestScopeChip scope={q.scope} />}
          {canTake && (
            <button
              type="button"
              className="quest-take-btn"
              onClick={(e) => {
                e.stopPropagation();
                void onTake(q.id);
              }}
            >
              Take
            </button>
          )}
        </span>
        <span className="quest-card-meta-right">
          <span
            className="quest-card-assignee"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <AssigneePicker
              assignee={q.assignee}
              agents={agents}
              users={users}
              onChange={async (next) => {
                try {
                  await api.updateQuest(q.id, { assignee: next });
                  onCreated();
                } catch (e) {
                  onError(e instanceof Error ? e.message : "Failed to reassign");
                }
              }}
              renderTrigger={({ open, display }) => (
                <button
                  type="button"
                  className={`quest-row-assignee quest-row-assignee--labeled${open ? " open" : ""}`}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={
                    display
                      ? `Assigned to ${display.name}. Click to reassign.`
                      : "Unassigned. Click to assign."
                  }
                  title={display ? `Assigned to ${display.name}` : "Unassigned"}
                >
                  <AssigneeAvatar assignee={q.assignee} agents={agents} users={users} size={18} />
                  <span className="quest-row-assignee-name">{display?.name ?? "Unassigned"}</span>
                </button>
              )}
            />
          </span>
          {q.due_at && (
            <span
              className={`quest-due-chip${isOverdue(q.due_at) ? " quest-due-chip--overdue" : ""}`}
              title={`Due ${formatDateTime(q.due_at)}`}
            >
              {dueLabel(q.due_at)}
            </span>
          )}
          {q.updated_at && <span className="quest-card-time">{timeAgo(q.updated_at)}</span>}
        </span>
      </div>
    </article>
  );
}
