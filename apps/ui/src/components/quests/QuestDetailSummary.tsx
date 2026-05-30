import { useState } from "react";
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
import {
  CopyableRow,
  PropertyGroup,
  ReadOnlyRow,
  compactAddress,
} from "../roles/RoleInspectorPrimitives";
import "@/styles/roles.css";

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

function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="role-inspector-row quest-detail-control-row">
      <span className="role-inspector-row-label">{label}</span>
      <div className="role-inspector-row-control quest-detail-control">{children}</div>
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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const display = assigneeDisplay(assignee, agents, users);
  const sharedCount = quest.sibling_quest_ids?.length ?? 0;
  const doneChildren = childQuests.filter((q) => q.status === "done").length;
  const due = dueValue(dueAt);
  const idea = quest.idea;

  async function copy(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1200);
    } catch {
      setCopiedField(null);
    }
  }

  return (
    <aside
      className="quest-detail-summary ideas-workspace-inspector role-inspector role-inspector--page"
      aria-label="Quest details"
    >
      <header className="role-inspector-topbar">
        <span className="role-inspector-object">Details</span>
        <small title={quest.updated_at ? formatDateTime(quest.updated_at) : undefined}>
          {quest.updated_at ? timeAgo(quest.updated_at) : quest.id}
        </small>
      </header>

      <div className="role-inspector-body">
        {idea && (
          <PropertyGroup title="Idea" defaultOpen>
            <ReadOnlyRow label="Scope">
              <span className="role-inspector-meta">{SCOPE_LABEL[scope] ?? scope}</span>
            </ReadOnlyRow>
            <ReadOnlyRow label="Type">
              <span className="role-inspector-meta">Quest</span>
            </ReadOnlyRow>
            <CopyableRow
              label="Idea ID"
              title={compactAddress(idea.id)}
              copied={copiedField === "ideaId"}
              onCopy={() => copy(idea.id, "ideaId")}
            />
            <div className="role-inspector-field-block">
              <span className="role-inspector-row-label">Tags</span>
              <div className="role-inspector-field-body">
                <TagsEditor
                  tags={idea.tags ?? []}
                  typed={idea.tags ?? []}
                  suggestions={tagSuggestions}
                  onAdd={onTagAdd}
                  onRemove={onTagRemove}
                />
              </div>
            </div>
            <div className="role-inspector-field-block">
              <span className="role-inspector-row-label">References</span>
              <div className="role-inspector-field-body">
                <IdeaLinksPanel ideaId={idea.id} agentId={quest.agent_id ?? ""} />
              </div>
            </div>
          </PropertyGroup>
        )}

        <PropertyGroup title="Quest" defaultOpen>
          <ControlRow label="Status">
            <QuestStatusPopover
              status={status}
              onChange={onStatusChange}
              open={statusOpen}
              onOpenChange={onStatusOpenChange}
            />
          </ControlRow>
          <ControlRow label="Assignee">
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
          </ControlRow>
          <ControlRow label="Priority">
            <QuestPriorityPopover
              priority={priority}
              onChange={onPriorityChange}
              open={priorityOpen}
              onOpenChange={onPriorityOpenChange}
            />
          </ControlRow>
          <ControlRow label="Due">
            <QuestDueDatePopover
              due_at={dueAt}
              onChange={onDueChange}
              open={dueOpen}
              onOpenChange={onDueOpenChange}
            />
          </ControlRow>
          {childQuests.length > 0 && (
            <ReadOnlyRow label="Progress">
              <span className="role-inspector-meta">
                {doneChildren}/{childQuests.length} done
              </span>
            </ReadOnlyRow>
          )}
        </PropertyGroup>

        <PropertyGroup title="Access" defaultOpen>
          <div className="quest-detail-scope-picker">
            <div
              className="ideas-workspace-scope-options"
              role="radiogroup"
              aria-label="Quest access"
            >
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
        </PropertyGroup>

        <PropertyGroup title="Work">
          <CopyableRow
            label="Quest ID"
            title={compactAddress(quest.id)}
            copied={copiedField === "questId"}
            onCopy={() => copy(quest.id, "questId")}
          />
          <ReadOnlyRow label="Status">
            <span className="role-inspector-meta">
              <StatusDot status={status} />
              {STATUS_LABEL[status]}
            </span>
          </ReadOnlyRow>
          <ReadOnlyRow label="Priority">
            <span className="role-inspector-meta">
              <PriorityIcon priority={priority} />
              {PRIORITY_LABEL[priority]}
            </span>
          </ReadOnlyRow>
          <ReadOnlyRow label="Due">
            <span title={dueAt ? formatDateTime(dueAt) : undefined}>{due}</span>
          </ReadOnlyRow>
          <ReadOnlyRow label="Kind">
            <span className="role-inspector-meta">{formatKind(quest.kind)}</span>
          </ReadOnlyRow>
          {quest.project && (
            <ReadOnlyRow label="Project">
              <span className="role-inspector-meta">{quest.project}</span>
            </ReadOnlyRow>
          )}
          {sharedCount > 0 && (
            <ReadOnlyRow label="Shared">
              <span className="role-inspector-meta">{sharedCount + 1} quests</span>
            </ReadOnlyRow>
          )}
          {quest.depends_on?.length ? (
            <ReadOnlyRow label="Depends">
              <span className="role-inspector-meta">{quest.depends_on.join(", ")}</span>
            </ReadOnlyRow>
          ) : null}
          {quest.worktree_branch && (
            <ReadOnlyRow label="Branch">
              <span className="role-inspector-meta">{quest.worktree_branch}</span>
            </ReadOnlyRow>
          )}
          {quest.outcome?.summary && (
            <ReadOnlyRow label="Outcome">
              <span className="role-inspector-meta">{quest.outcome.summary}</span>
            </ReadOnlyRow>
          )}
          {quest.created_at && (
            <ReadOnlyRow label="Created">
              <span title={formatDateTime(quest.created_at)}>{timeAgo(quest.created_at)}</span>
            </ReadOnlyRow>
          )}
          {quest.updated_at && (
            <ReadOnlyRow label="Updated">
              <span title={formatDateTime(quest.updated_at)}>{timeAgo(quest.updated_at)}</span>
            </ReadOnlyRow>
          )}
        </PropertyGroup>

        {idea && (
          <PropertyGroup title="Activity">
            <IdeaActivityFeed ideaId={idea.id} refreshKey={activityRefreshKey} limit={4} />
          </PropertyGroup>
        )}
      </div>
    </aside>
  );
}
