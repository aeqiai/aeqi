import { api } from "@/lib/api";
import { dueLabel, isOverdue, timeAgo } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";
import type { Quest, QuestStatus, User } from "@/lib/types";
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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", q.id);
        setDragging(q.id);
      }}
      onDragEnd={() => {
        setDragging(null);
        setDropTarget(null);
      }}
      onClick={() => onPick(q.id)}
    >
      <div className="quest-card-head">
        <StatusDot status={optimistic[q.id] ?? q.status} />
        <span className="quest-card-subject">{q.idea?.name ?? q.id}</span>
      </div>
      <div className="quest-card-meta">
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
            renderTrigger={({ open }) => (
              <button
                type="button"
                className={`quest-row-assignee${open ? " open" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={
                  q.assignee
                    ? `Assigned: ${q.assignee}. Click to reassign.`
                    : "Unassigned. Click to assign."
                }
              >
                <AssigneeAvatar assignee={q.assignee} agents={agents} users={users} size={18} />
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
      </div>
    </article>
  );
}
