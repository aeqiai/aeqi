import type { ReactNode } from "react";
import { dueLabel, timeAgo } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";
import { parseAssignee, resolveAssigneeDisplay, type AssigneeDisplay } from "@/lib/assignee";
import type { Quest, QuestPriority, QuestStatus, ScopeValue, User } from "@/lib/types";
import { SCOPE_LABEL } from "../ideas/types";
import AssigneeAvatar from "./AssigneeAvatar";
import PriorityIcon from "./PriorityIcon";
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

export default function QuestDetailSummary({
  quest,
  status,
  priority,
  assignee,
  scope,
  dueAt,
  agents,
  users,
}: {
  quest: Quest;
  status: QuestStatus;
  priority: QuestPriority;
  assignee: string | null;
  scope: ScopeValue;
  dueAt: string | null;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
}) {
  const display = assigneeDisplay(assignee, agents, users);
  const due = dueAt ? dueLabel(dueAt) : "No due date";
  const sharedCount = quest.sibling_quest_ids?.length ?? 0;

  return (
    <aside className="quest-detail-summary" aria-label="Quest details">
      <header className="quest-detail-summary-head">
        <span className="quest-detail-summary-kicker">Quest</span>
        <span className="quest-detail-summary-id">{quest.id}</span>
      </header>

      <dl className="quest-detail-meta">
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
        <DetailRow label="Assignee">
          <span className="quest-detail-value">
            <AssigneeAvatar assignee={assignee} agents={agents} users={users} size={18} />
            {display?.name ?? "Unassigned"}
          </span>
        </DetailRow>
        <DetailRow label="Due">
          <span className="quest-detail-value" title={dueAt ? formatDateTime(dueAt) : undefined}>
            {due}
          </span>
        </DetailRow>
        <DetailRow label="Visibility">{SCOPE_LABEL[scope]}</DetailRow>
        <DetailRow label="Kind">{formatKind(quest.kind)}</DetailRow>
        {quest.project && <DetailRow label="Project">{quest.project}</DetailRow>}
        {quest.updated_at && <DetailRow label="Updated">{timeAgo(quest.updated_at)}</DetailRow>}
        {quest.created_at && (
          <DetailRow label="Created">
            <span title={formatDateTime(quest.created_at)}>{timeAgo(quest.created_at)}</span>
          </DetailRow>
        )}
      </dl>

      {(sharedCount > 0 || quest.outcome || quest.worktree_branch) && (
        <section className="quest-detail-context">
          <h2>Context</h2>
          {sharedCount > 0 && <p>Shared spec with {sharedCount + 1} tracked quests.</p>}
          {quest.worktree_branch && <p>Branch: {quest.worktree_branch}</p>}
          {quest.outcome?.summary && <p>Outcome: {quest.outcome.summary}</p>}
        </section>
      )}
    </aside>
  );
}
