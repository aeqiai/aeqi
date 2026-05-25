import { ArrowUp, FolderOpen, X } from "lucide-react";
import { Button, Icon, IconButton } from "../ui";
import type { Quest, QuestStatus, User } from "@/lib/types";
import QuestActiveCard from "./QuestActiveCard";
import QuestStatusSummary from "./QuestStatusSummary";
import StatusDot from "./StatusDot";
import type { QuestDiscoveryHit } from "./agentQuestsHelpers";

type ScopeSummary = {
  columns: Array<{ status: QuestStatus; label: string }>;
  grouped: Record<QuestStatus, Quest[]>;
};

/**
 * Scope band — its own kanban-column-style slab above the board.
 *
 * Mirrors the visual identity of Backlog / Cancelled: a slab on
 * `--bg-row` with a 44px header row carrying the section label and
 * actions. The label is always "Scope" — never "Workspace" or
 * "Project"; the row's purpose is constant regardless of what's
 * inside it.
 *
 * Header actions (shown only when scoped):
 *   - Up — moves up one level. If a parent quest exists, navigates to
 *     it; otherwise returns to the workspace root. Always visible
 *     when there's a scope to leave.
 *   - Clear — jumps straight to the workspace root.
 *
 * Slot below:
 *   - empty — dashed-border drop placeholder. The whole slot accepts
 *     the same `text/plain = questId` drag payload as the kanban
 *     columns; dropping promotes that quest to scope.
 *   - scoped — a real `QuestActiveCard` rendering the active project
 *     with the usual chrome (status dot, name, child count, priority,
 *     Take, assignee, age). The card opts out of drag so the slot
 *     itself stays the drop target.
 */
export interface QuestBoardScopeProps {
  scope?: Quest;
  childCount: number;
  parentScopeId: string | null;
  projectCount: number;
  scopeOptions: Quest[];
  summary?: ScopeSummary;
  dragging: string | null;
  dropActive: boolean;
  onDropActiveChange: (next: boolean) => void;
  onDrop: (questId: string) => void;
  onScopeSelect: (questId: string) => void;
  onUp: () => void;
  onClear: () => void;
  onOpen: () => void;
  optimistic: Record<string, QuestStatus>;
  focusId: string | null;
  setDragging: (id: string | null) => void;
  setDropTarget: (status: QuestStatus | null) => void;
  onTake: (id: string) => void | Promise<void>;
  onCreated: () => void;
  onError: (msg: string) => void;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  searchMatches: Map<string, QuestDiscoveryHit>;
}

export default function QuestBoardScope({
  scope,
  childCount,
  parentScopeId,
  projectCount,
  scopeOptions,
  summary,
  dragging,
  dropActive,
  onDropActiveChange,
  onDrop,
  onScopeSelect,
  onUp,
  onClear,
  onOpen,
  optimistic,
  focusId,
  setDragging,
  setDropTarget,
  onTake,
  onCreated,
  onError,
  agents,
  users,
  searchMatches,
}: QuestBoardScopeProps) {
  const shownScopeOptions = scopeOptions.slice(0, 6);
  const hiddenScopeOptions = Math.max(0, scopeOptions.length - shownScopeOptions.length);
  const dragProps = {
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dropActive) onDropActiveChange(true);
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      const related = e.relatedTarget as Node | null;
      if (related && e.currentTarget.contains(related)) return;
      if (dropActive) onDropActiveChange(false);
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragging;
      if (id) onDrop(id);
      onDropActiveChange(false);
    },
  };

  return (
    <section className="quest-scope" aria-label="Board scope">
      <header className="quest-scope-header">
        <span className="quest-scope-header-copy">
          <span className="quest-scope-header-label">Scope</span>
          <span className="quest-scope-header-note">
            {scope
              ? `${childCount} ${childCount === 1 ? "child quest" : "child quests"} visible`
              : `${projectCount} ${projectCount === 1 ? "project can" : "projects can"} focus this board`}
          </span>
        </span>
        {scope && (
          <span className="quest-scope-header-actions">
            <Button size="sm" variant="secondary" onClick={onOpen} title="Open scoped quest">
              Open
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onUp}
              leadingIcon={<ArrowUp size={14} strokeWidth={1.8} />}
              title={parentScopeId ? "Up to parent quest" : "Back to workspace"}
            >
              Up
            </Button>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={onClear}
              aria-label="Clear scope"
              title="Clear scope"
            >
              <X size={15} strokeWidth={1.8} />
            </IconButton>
          </span>
        )}
      </header>
      {summary && (
        <div className="quest-scope-summary">
          <QuestStatusSummary columns={summary.columns} grouped={summary.grouped} />
        </div>
      )}
      <div
        className="quest-scope-slot"
        data-empty={!scope || undefined}
        data-drop-target={dropActive || undefined}
        {...dragProps}
      >
        {scope ? (
          <QuestActiveCard
            q={scope}
            optimistic={optimistic}
            dragging={dragging}
            focusId={focusId}
            setDragging={setDragging}
            setDropTarget={setDropTarget}
            onPick={onOpen}
            onTake={onTake}
            onCreated={onCreated}
            onError={onError}
            agents={agents}
            users={users}
            childCount={childCount}
            searchMatch={searchMatches.get(scope.id)}
            draggable={false}
          />
        ) : (
          <div className="quest-scope-empty">
            <span className="quest-scope-empty-copy">
              <span className="quest-scope-empty-title">Focus the board by project</span>
              <span className="quest-scope-empty-hint">Drop a quest here, or pick one below.</span>
            </span>
            {shownScopeOptions.length > 0 && (
              <div className="quest-scope-projects" aria-label="Project scopes">
                {shownScopeOptions.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className="quest-scope-project"
                    onClick={() => onScopeSelect(q.id)}
                    title={`Scope to ${q.idea?.name ?? q.id}`}
                  >
                    <StatusDot status={q.status} />
                    <span>{q.idea?.name ?? q.id}</span>
                    <small>
                      <Icon icon={FolderOpen} size="xs" />
                      {q.id}
                    </small>
                  </button>
                ))}
                {hiddenScopeOptions > 0 && (
                  <span className="quest-scope-project-more">+{hiddenScopeOptions} more</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
