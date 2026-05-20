import { useCallback, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { Button, Icon } from "../ui";
import type { Quest, QuestStatus, User } from "@/lib/types";
import { useRelativeNow } from "@/hooks/useRelativeNow";
import { dueLabel, isOverdue, timeAgo } from "@/lib/format";
import { formatDateTime } from "@/lib/i18n";
import AssigneeAvatar from "./AssigneeAvatar";
import AssigneePicker from "./AssigneePicker";
import PriorityIcon from "./PriorityIcon";
import QuestScopeChip from "./QuestScopeChip";
import StatusDot from "./StatusDot";

/**
 * List view — flat sortable rows. Reuses Ideas list-row chrome
 * (`.ideas-list-row`, `.ideas-list-row-head`, `.ideas-list-row-name`,
 * `.ideas-list-row-time`) so a future generalization of those classes
 * lifts both surfaces at once. Status dot is inline left of the name;
 * priority renders as a quiet text label (critical pops via the
 * `--critical` modifier). Empty + no-match states use the canonical
 * `.empty-state-hero` markup that IdeasListView uses.
 */
export default function QuestList({
  groups,
  optimistic,
  focusId,
  totalCount,
  onPick,
  onNew,
  onCompose,
  onAssigneeChange,
  onTake,
  search,
  onClearSearch,
  agents,
  users,
  childCounts,
}: {
  groups: Array<{ status: QuestStatus; label: string; quests: Quest[] }>;
  optimistic: Record<string, QuestStatus>;
  focusId: string | null;
  totalCount: number;
  onPick: (id: string) => void;
  onNew: () => void;
  onCompose: (status?: QuestStatus) => void;
  onAssigneeChange: (questId: string, next: string | null) => void;
  onTake: (questId: string) => void;
  search: string;
  onClearSearch: () => void;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  childCounts: Map<string, number>;
}) {
  // Per-group collapsed state. Empty groups stay hidden entirely; the
  // four canonical statuses (todo / in progress / blocked / done) all
  // render their headers when non-empty so the list mirrors the board's
  // left-to-right reading order.
  const [collapsed, setCollapsed] = useState<Partial<Record<QuestStatus, boolean>>>({});
  const toggle = useCallback((s: QuestStatus) => {
    setCollapsed((prev) => ({ ...prev, [s]: !prev[s] }));
  }, []);

  // Tick the "X ago" labels on each row once a minute.
  useRelativeNow();

  if (totalCount === 0) {
    const hasSearch = search.trim().length > 0;
    return (
      <div className="ideas-list-body">
        <div className="empty-state-hero">
          <h3 className="empty-state-hero-title">
            {hasSearch ? "No quests match." : "No quests yet."}
          </h3>
          <p className="empty-state-hero-body">
            {hasSearch
              ? "Try a different search, or start a new quest."
              : "Create the first quest to populate this board."}
          </p>
          <div className="quest-board-empty-actions">
            {hasSearch && (
              <Button variant="secondary" size="sm" onClick={onClearSearch}>
                Clear search
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={onNew}
              leadingIcon={<Icon icon={Plus} size="xs" />}
            >
              New quest
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ideas-list-body">
      {groups.map((group) => {
        if (group.quests.length === 0) return null;
        const isCollapsed = !!collapsed[group.status];
        return (
          <section key={group.status} className="ideas-list-group">
            <div className="ideas-list-group-head">
              <button
                type="button"
                className="ideas-list-group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(group.status)}
              >
                <svg
                  className={`ideas-list-group-chevron${isCollapsed ? "" : " is-open"}`}
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4.5 3 L7.5 6 L4.5 9" />
                </svg>
                <StatusDot status={group.status} />
                <span className="ideas-list-group-label">{group.label}</span>
                <span className="ideas-list-group-count">{group.quests.length}</span>
              </button>
              <button
                type="button"
                className="ideas-list-group-add"
                onClick={() => onCompose(group.status)}
                aria-label={`New ${group.label.toLowerCase()} quest`}
                title={`New quest in ${group.label}`}
              >
                <Icon icon={Plus} size="xs" />
              </button>
            </div>
            {!isCollapsed && (
              <div className="ideas-list-group-body">
                {group.quests.map((q) => {
                  const status = optimistic[q.id] ?? q.status;
                  const isFocused = focusId === q.id;
                  const childCount = childCounts.get(q.id) ?? 0;
                  return (
                    <div
                      key={q.id}
                      className={`ideas-list-row${isFocused ? " focus" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPick(q.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPick(q.id);
                        }
                      }}
                    >
                      <div className="ideas-list-row-head">
                        <StatusDot status={status} />
                        <span className="ideas-list-row-name">{q.idea?.name ?? q.id}</span>
                        {childCount > 0 && (
                          <span
                            className="quest-child-count"
                            aria-label={`${childCount} subquests`}
                          >
                            <Icon icon={FolderOpen} size="xs" />
                            {childCount}
                          </span>
                        )}
                        {q.kind === "project" && (
                          <span
                            className="quest-kind-chip quest-kind-chip--project"
                            title="Project — container of sub-Quests"
                          >
                            project
                          </span>
                        )}
                        {q.scope && q.scope !== "self" && <QuestScopeChip scope={q.scope} />}
                        <PriorityIcon priority={q.priority} />
                        {q.cost_usd > 0 && (
                          <span
                            className="quest-cost-chip"
                            title={`Inference cost across all sessions on this ${q.kind === "project" ? "project" : "quest"}`}
                          >
                            ${q.cost_usd.toFixed(2)}
                          </span>
                        )}
                        {status !== "in_progress" &&
                          status !== "in_review" &&
                          status !== "done" &&
                          status !== "cancelled" && (
                            <button
                              type="button"
                              className="quest-take-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTake(q.id);
                              }}
                            >
                              Take
                            </button>
                          )}
                        <span
                          className="ideas-list-row-assignee"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <AssigneePicker
                            assignee={q.assignee}
                            agents={agents}
                            users={users}
                            onChange={(next) => onAssigneeChange(q.id, next)}
                            renderTrigger={({ open, display }) => (
                              <button
                                type="button"
                                className={`quest-row-assignee quest-row-assignee--labeled${
                                  open ? " open" : ""
                                }`}
                                aria-haspopup="dialog"
                                aria-expanded={open}
                                aria-label={
                                  display
                                    ? `Assigned to ${display.name}. Click to reassign.`
                                    : "Unassigned. Click to assign."
                                }
                              >
                                <AssigneeAvatar
                                  assignee={q.assignee}
                                  agents={agents}
                                  users={users}
                                  size={18}
                                />
                                <span className="quest-row-assignee-name">
                                  {display?.name ?? "Unassigned"}
                                </span>
                              </button>
                            )}
                          />
                        </span>
                        {q.due_at && (
                          <span
                            className={`quest-due-chip${
                              isOverdue(q.due_at) ? " quest-due-chip--overdue" : ""
                            }`}
                            title={`Due ${formatDateTime(q.due_at)}`}
                          >
                            {dueLabel(q.due_at)}
                          </span>
                        )}
                        {q.updated_at && (
                          <span className="ideas-list-row-time">{timeAgo(q.updated_at)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
