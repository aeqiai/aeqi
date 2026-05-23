import type { ReactNode } from "react";
import { dueLabel, timeAgo } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";
import { parseAssignee, resolveAssigneeDisplay, type AssigneeDisplay } from "@/lib/assignee";
import type { Quest, QuestPriority, QuestStatus, ScopeValue, User } from "@/lib/types";
import IdeaLinksPanel from "../IdeaLinksPanel";
import TagsEditor from "../TagsEditor";
import IdeaActivityFeed from "../ideas/IdeaActivityFeed";
import { type IdeasFilter, SCOPE_HINT, SCOPE_LABEL, SCOPE_PICKER_VALUES } from "../ideas/types";
import { Button } from "../ui";
import AssigneeAvatar from "./AssigneeAvatar";
import AssigneePicker from "./AssigneePicker";
import PriorityIcon from "./PriorityIcon";
import QuestDueDatePopover from "./QuestDueDatePopover";
import QuestPriorityPopover from "./QuestPriorityPopover";
import QuestStatusPopover from "./QuestStatusPopover";
import StatusDot from "./StatusDot";

const STATUS_LABEL: Record<QuestStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

const PRIORITY_LABEL: Record<QuestPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

function formatKind(kind: string | undefined): string {
  if (!kind || kind === "task") return "Task";
  if (kind === "project") return "Project";
  if (kind.startsWith("custom:")) return kind.slice(7) || "Custom";
  return kind;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="quest-detail-meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function assigneeDisplay(
  assignee: string | null | undefined,
  agents: { id: string; name: string }[],
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[],
): AssigneeDisplay | null {
  const parsed = parseAssignee(assignee);
  return parsed ? resolveAssigneeDisplay(parsed, agents, users) : null;
}

function dueValue(dueAt: string | null): string {
  return dueAt ? dueLabel(dueAt) : "No due date";
}

function accessDescription(scope: ScopeValue): string {
  return SCOPE_HINT[scope as IdeasFilter] ?? "Visible according to this quest's scope.";
}

export default function QuestDetailSummary({
  quest,
  status,
  priority,
  assignee,
  scope,
  dueAt,
  agents,
  users,
  tagSuggestions,
  childQuests,
  activityRefreshKey,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onScopeChange,
  onDueChange,
  onTagAdd,
  onTagRemove,
  statusOpen,
  onStatusOpenChange,
  priorityOpen,
  onPriorityOpenChange,
  assigneeOpen,
  onAssigneeOpenChange,
  dueOpen,
  onDueOpenChange,
}: {
  quest: Quest;
  status: QuestStatus;
  priority: QuestPriority;
  assignee: string | null;
  scope: ScopeValue;
  dueAt: string | null;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  tagSuggestions: string[];
  childQuests: Quest[];
  activityRefreshKey?: unknown;
  onStatusChange: (next: QuestStatus) => void;
  onPriorityChange: (next: QuestPriority) => void;
  onAssigneeChange: (next: string | null) => void;
  onScopeChange: (next: ScopeValue) => void;
  onDueChange: (next: string | null) => void;
  onTagAdd: (tag: string) => void;
  onTagRemove: (tag: string) => void;
  statusOpen?: boolean;
  onStatusOpenChange?: (next: boolean) => void;
  priorityOpen?: boolean;
  onPriorityOpenChange?: (next: boolean) => void;
  assigneeOpen?: boolean;
  onAssigneeOpenChange?: (next: boolean) => void;
  dueOpen?: boolean;
  onDueOpenChange?: (next: boolean) => void;
}) {
  const display = assigneeDisplay(assignee, agents, users);
  const sharedCount = quest.sibling_quest_ids?.length ?? 0;
  const doneChildren = childQuests.filter((q) => q.status === "done").length;
  const due = dueValue(dueAt);
  const idea = quest.idea;

  return (
    <aside className="quest-detail-summary ideas-workspace-inspector" aria-label="Quest details">
      <header className="ideas-workspace-inspector-head">
        <span>Details</span>
        <small title={quest.updated_at ? formatDateTime(quest.updated_at) : undefined}>
          {quest.updated_at ? timeAgo(quest.updated_at) : quest.id}
        </small>
      </header>

      <div className="quest-detail-context ideas-workspace-section quest-detail-settings">
        <h2>Quest</h2>
        <dl className="quest-detail-meta">
          <DetailRow label="Status">
            <QuestStatusPopover
              status={status}
              onChange={onStatusChange}
              open={statusOpen}
              onOpenChange={onStatusOpenChange}
            />
          </DetailRow>
          <DetailRow label="Assignee">
            <AssigneePicker
              assignee={assignee}
              agents={agents}
              users={users}
              onChange={onAssigneeChange}
              open={assigneeOpen}
              onOpenChange={onAssigneeOpenChange}
              renderTrigger={({ open }) => (
                <Button
                  variant="secondary"
                  size="sm"
                  className={`quest-detail-field-btn quest-assignee-btn${open ? " open" : ""}`}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  title={display ? `Assigned to ${display.name}` : "Unassigned"}
                  leadingIcon={
                    <AssigneeAvatar assignee={assignee} agents={agents} users={users} size={16} />
                  }
                >
                  <span className="quest-assignee-btn-name">{display?.name ?? "Unassigned"}</span>
                </Button>
              )}
            />
          </DetailRow>
          <DetailRow label="Priority">
            <QuestPriorityPopover
              priority={priority}
              onChange={onPriorityChange}
              open={priorityOpen}
              onOpenChange={onPriorityOpenChange}
            />
          </DetailRow>
          <DetailRow label="Due">
            <QuestDueDatePopover
              due_at={dueAt}
              onChange={onDueChange}
              open={dueOpen}
              onOpenChange={onDueOpenChange}
            />
          </DetailRow>
          {childQuests.length > 0 && (
            <DetailRow label="Progress">
              {doneChildren}/{childQuests.length} done
            </DetailRow>
          )}
        </dl>
      </div>

      <div className="quest-detail-context ideas-workspace-section ideas-workspace-scope">
        <h2>Access</h2>
        <div className="ideas-workspace-scope-options" role="radiogroup" aria-label="Quest access">
          {SCOPE_PICKER_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              title={SCOPE_HINT[value]}
              className={`ideas-workspace-scope-option${scope === value ? " active" : ""}`}
              onClick={() => onScopeChange(value)}
            >
              <span className={`scope-dot scope-dot--${value}`} aria-hidden />
              <span>{SCOPE_LABEL[value]}</span>
            </button>
          ))}
        </div>
        <p>{accessDescription(scope)}</p>
      </div>

      {idea && (
        <>
          <div className="quest-detail-context ideas-workspace-section ideas-workspace-tags">
            <h2>Tags</h2>
            <TagsEditor
              tags={idea.tags ?? []}
              typed={idea.tags ?? []}
              suggestions={tagSuggestions}
              onAdd={onTagAdd}
              onRemove={onTagRemove}
            />
          </div>
          <div className="quest-detail-context ideas-workspace-section ideas-workspace-refs">
            <h2>References</h2>
            <IdeaLinksPanel ideaId={idea.id} agentId={quest.agent_id ?? ""} />
          </div>
          <div className="quest-detail-context ideas-workspace-section ideas-workspace-activity">
            <h2>Activity</h2>
            <IdeaActivityFeed ideaId={idea.id} refreshKey={activityRefreshKey} limit={6} />
          </div>
        </>
      )}

      {(sharedCount > 0 || quest.depends_on?.length || quest.worktree_branch || quest.outcome) && (
        <section className="quest-detail-context ideas-workspace-section">
          <h2>Linked work</h2>
          {sharedCount > 0 && <p>Shared spec with {sharedCount + 1} tracked quests.</p>}
          {quest.depends_on?.length ? <p>Depends on {quest.depends_on.join(", ")}</p> : null}
          {quest.worktree_branch && <p>Branch: {quest.worktree_branch}</p>}
          {quest.outcome?.summary && <p>Outcome: {quest.outcome.summary}</p>}
        </section>
      )}

      <dl className="quest-detail-meta ideas-workspace-meta">
        <DetailRow label="ID">{quest.id}</DetailRow>
        <DetailRow label="Status">
          <span className="quest-detail-value">
            <StatusDot status={status} />
            {STATUS_LABEL[status]}
          </span>
        </DetailRow>
        <DetailRow label="Priority">
          <span className="quest-detail-value">
            <PriorityIcon priority={priority} />
            {PRIORITY_LABEL[priority]}
          </span>
        </DetailRow>
        <DetailRow label="Due">
          <span title={dueAt ? formatDateTime(dueAt) : undefined}>{due}</span>
        </DetailRow>
        <DetailRow label="Kind">{formatKind(quest.kind)}</DetailRow>
        {quest.project && <DetailRow label="Project">{quest.project}</DetailRow>}
        {quest.created_at && (
          <DetailRow label="Created">
            <span title={formatDateTime(quest.created_at)}>{timeAgo(quest.created_at)}</span>
          </DetailRow>
        )}
        {quest.updated_at && (
          <DetailRow label="Updated">
            <span title={formatDateTime(quest.updated_at)}>{timeAgo(quest.updated_at)}</span>
          </DetailRow>
        )}
      </dl>
    </aside>
  );
}
