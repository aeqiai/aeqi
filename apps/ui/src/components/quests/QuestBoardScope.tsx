import { ArrowUp, FolderOpen, X } from "lucide-react";
import { Button, Icon, IconButton } from "../ui";
import type { Quest, QuestStatus, User } from "@/lib/types";
import QuestActiveCard from "./QuestActiveCard";

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
  dragging: string | null;
  dropActive: boolean;
  onDropActiveChange: (next: boolean) => void;
  onDrop: (questId: string) => void;
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
}

export default function QuestBoardScope({
  scope,
  childCount,
  parentScopeId,
  projectCount,
  dragging,
  dropActive,
  onDropActiveChange,
  onDrop,
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
}: QuestBoardScopeProps) {
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
        <span className="quest-scope-header-label">Scope</span>
        {scope && (
          <span className="quest-scope-header-actions">
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
            draggable={false}
          />
        ) : (
          <div className="quest-scope-empty">
            <span className="quest-scope-empty-icon" aria-hidden>
              <FolderOpen size={18} strokeWidth={1.6} />
            </span>
            <span className="quest-scope-empty-copy">
              <span className="quest-scope-empty-title">
                Drop a quest here to scope the board to its children
              </span>
              {projectCount > 0 && (
                <span className="quest-scope-empty-hint">
                  <span
                    className="quest-child-count"
                    aria-label={`${projectCount} ${projectCount === 1 ? "project" : "projects"} below`}
                  >
                    <Icon icon={FolderOpen} size="xs" />
                    {projectCount}
                  </span>
                  <span className="quest-scope-empty-hint-suffix">
                    {projectCount === 1 ? "project below" : "projects below"}
                  </span>
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
