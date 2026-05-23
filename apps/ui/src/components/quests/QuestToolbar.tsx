import type React from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { Button, Loading, Tooltip } from "../ui";
import type { QuestPriority, QuestStatus, ScopeValue, User } from "@/lib/types";
import QuestStatusPopover from "./QuestStatusPopover";
import QuestPriorityPopover from "./QuestPriorityPopover";
import QuestDueDatePopover from "./QuestDueDatePopover";
import IdeasScopePopover from "../ideas/IdeasScopePopover";
import AssigneeAvatar from "./AssigneeAvatar";
import AssigneePicker from "./AssigneePicker";

// ─────────────────────────────────────────────────────────────────────
//  Shared toolbar — same chrome, same affordances, same field order in
//  both modes. Only the buttons that don't apply to the mode (linked-
//  idea picker, save-state loading mark) get hidden.
// ─────────────────────────────────────────────────────────────────────
export default function QuestToolbar({
  agentId,
  agents,
  users,
  status,
  priority,
  assignee,
  scope,
  due_at,
  saving,
  cancelLabel,
  cancelTitle,
  saveLabel,
  saveTitle,
  saveDisabled,
  showCancelSave,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onScopeChange,
  onDueChange,
  onBack,
  onNew,
  onCancel,
  onSave,
  linkedIdeaSlot,
  trailingSlot,
  breadcrumbLabel,
  showLifecycleControls = true,
  statusOpen,
  onStatusOpenChange,
  priorityOpen,
  onPriorityOpenChange,
  assigneeOpen,
  onAssigneeOpenChange,
  dueOpen,
  onDueOpenChange,
}: {
  agentId: string;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  status: QuestStatus;
  priority: QuestPriority;
  assignee: string | null;
  scope: ScopeValue;
  due_at: string | null;
  saving: boolean;
  cancelLabel: string;
  cancelTitle: string;
  saveLabel: string;
  saveTitle: string;
  saveDisabled: boolean;
  showCancelSave: boolean;
  onStatusChange: (next: QuestStatus) => void;
  onPriorityChange: (next: QuestPriority) => void;
  onAssigneeChange: (next: string | null) => void;
  onScopeChange: (next: ScopeValue) => void;
  onDueChange: (next: string | null) => void;
  onBack: () => void;
  onNew?: () => void;
  onCancel: () => void;
  onSave: () => void;
  linkedIdeaSlot?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  breadcrumbLabel?: string;
  showLifecycleControls?: boolean;
  /** Controlled-open hooks. Threaded so the parent (ViewCanvas) can pop
   * the popovers via the S / P / A / D keyboard shortcuts. Optional —
   * uncontrolled by default so ComposeCanvas keeps its existing UX. */
  statusOpen?: boolean;
  onStatusOpenChange?: (next: boolean) => void;
  priorityOpen?: boolean;
  onPriorityOpenChange?: (next: boolean) => void;
  assigneeOpen?: boolean;
  onAssigneeOpenChange?: (next: boolean) => void;
  dueOpen?: boolean;
  onDueOpenChange?: (next: boolean) => void;
}) {
  void agentId;
  const isDetailToolbar = !showLifecycleControls && !!breadcrumbLabel;
  const newQuestButton = onNew ? (
    <Tooltip content="New quest (N)">
      <Button
        variant="primary"
        size="sm"
        onClick={onNew}
        leadingIcon={<Plus size={13} strokeWidth={1.5} />}
      >
        New
      </Button>
    </Tooltip>
  ) : null;

  return (
    <div
      className={`ideas-toolbar ideas-canvas-toolbar${isDetailToolbar ? " quest-detail-toolbar" : ""}`}
    >
      <Tooltip content="Back to quests">
        <Button
          variant="secondary"
          size="sm"
          onClick={onBack}
          leadingIcon={<ChevronLeft size={13} strokeWidth={1.5} />}
        >
          Quests
        </Button>
      </Tooltip>
      {breadcrumbLabel && (
        <span
          className={isDetailToolbar ? "quest-detail-toolbar-pill" : "quest-detail-breadcrumb"}
          aria-label="Quest detail"
          title={breadcrumbLabel}
        >
          {isDetailToolbar ? (
            <span className="quest-detail-toolbar-pill-title">{breadcrumbLabel}</span>
          ) : (
            <>
              <span className="quest-detail-breadcrumb-sep" aria-hidden>
                /
              </span>
              <span className="quest-detail-breadcrumb-item">{breadcrumbLabel}</span>
            </>
          )}
        </span>
      )}
      {!isDetailToolbar && newQuestButton}
      {linkedIdeaSlot}
      {showLifecycleControls && (
        <>
          <QuestStatusPopover
            status={status}
            onChange={onStatusChange}
            open={statusOpen}
            onOpenChange={onStatusOpenChange}
          />
          <QuestPriorityPopover
            priority={priority}
            onChange={onPriorityChange}
            open={priorityOpen}
            onOpenChange={onPriorityOpenChange}
          />
          <AssigneePicker
            assignee={assignee}
            agents={agents}
            users={users}
            onChange={onAssigneeChange}
            open={assigneeOpen}
            onOpenChange={onAssigneeOpenChange}
            renderTrigger={({ open, display }) => (
              <Button
                variant="secondary"
                size="sm"
                className={`ideas-scope-btn quest-assignee-btn${open ? " open" : ""}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                title={display ? `Assigned to ${display.name}` : "Unassigned"}
                leadingIcon={
                  <AssigneeAvatar assignee={assignee} agents={agents} users={users} size={16} />
                }
                trailingIconMode="inline"
                trailingIcon={
                  <svg
                    className="ideas-scope-btn-chevron"
                    width="9"
                    height="9"
                    viewBox="0 0 9 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M2 3.5 L4.5 6 L7 3.5" />
                  </svg>
                }
              >
                <span className="quest-assignee-btn-name">{display?.name ?? "Unassigned"}</span>
              </Button>
            )}
          />
          <QuestDueDatePopover
            due_at={due_at}
            onChange={onDueChange}
            open={dueOpen}
            onOpenChange={onDueOpenChange}
          />
          <IdeasScopePopover scope={scope} onChange={onScopeChange} />
        </>
      )}
      {!isDetailToolbar && trailingSlot}
      <div className="ideas-toolbar-spacer" aria-hidden />
      {saving && (
        <span className="quest-detail-savestate">
          <Loading size="sm" /> Saving
        </span>
      )}
      {isDetailToolbar && trailingSlot}
      {isDetailToolbar && newQuestButton}
      {showCancelSave && (
        <>
          <Tooltip content={cancelTitle}>
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              leadingIcon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M3.2 3.2 L9.8 9.8 M9.8 3.2 L3.2 9.8" />
                </svg>
              }
            >
              {cancelLabel}
            </Button>
          </Tooltip>
          <Tooltip content={saveTitle}>
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saveDisabled}
              leadingIcon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2.8 6.6 L5.4 9.2 L10.2 4" />
                </svg>
              }
            >
              {saveLabel}
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
