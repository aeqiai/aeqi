import { useState } from "react";
import type { ReactNode } from "react";
import { timeAgo } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";
import { parseAssignee, resolveAssigneeDisplay, type AssigneeDisplay } from "@/lib/assignee";
import type { Quest, QuestPriority, QuestStatus, ScopeValue, User } from "@/lib/types";
import IdeaInspectorGroup from "../ideas/IdeaInspectorGroup";
import { Button } from "../ui";
import AssigneeAvatar from "./AssigneeAvatar";
import AssigneePicker from "./AssigneePicker";
import QuestDueDatePopover from "./QuestDueDatePopover";
import QuestPriorityPopover from "./QuestPriorityPopover";
import QuestStatusPopover from "./QuestStatusPopover";
import {
  CopyableRow,
  PropertyGroup,
  ReadOnlyRow,
  compactAddress,
} from "../roles/RoleInspectorPrimitives";
import "@/styles/roles.css";

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

function MultilineReadOnlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="role-inspector-row role-inspector-row--readonly quest-detail-multiline-row">
      <span className="role-inspector-row-label">{label}</span>
      <div className="role-inspector-row-value">{children}</div>
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
        <IdeaInspectorGroup
          idea={idea}
          agentId={quest.agent_id ?? ""}
          scope={scope}
          typeLabel="Quest idea"
          tagSuggestions={tagSuggestions}
          emptyStatus="No canonical idea linked"
          onScopeChange={onScopeChange}
          onTagAdd={onTagAdd}
          onTagRemove={onTagRemove}
        />

        <PropertyGroup title="Quest" defaultOpen>
          <CopyableRow
            label="Quest ID"
            title={compactAddress(quest.id)}
            copied={copiedField === "questId"}
            onCopy={() => copy(quest.id, "questId")}
          />
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
            <MultilineReadOnlyRow label="Outcome">
              <span
                className="role-inspector-meta quest-detail-outcome"
                title={quest.outcome.summary}
              >
                {quest.outcome.summary}
              </span>
            </MultilineReadOnlyRow>
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
      </div>
    </aside>
  );
}
