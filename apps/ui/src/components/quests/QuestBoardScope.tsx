import { ArrowUp, FolderOpen, X } from "lucide-react";
import type { Quest, QuestStatus, User } from "@/lib/types";
import QuestActiveCard from "./QuestActiveCard";

/**
 * Scope band above the kanban — header row plus a single card slot.
 *
 * The header is the row's column-header equivalent: "Scope" label on
 * the left, Up / Clear actions on the right (shown only when scoped).
 * The slot below is either:
 *
 *   - empty (no scope) — dashed-border placeholder inviting drag-from-
 *     board or click-from-board. The whole slot is a drop target;
 *     dropping promotes the dragged quest to scope.
 *   - scoped — a real QuestActiveCard rendering the active project
 *     with the usual chrome (status dot, name, child count, priority,
 *     Take, assignee, age). Click opens detail; the card opts out of
 *     drag so the slot itself stays the drop target.
 *
 * Drag payload (`dataTransfer text/plain = questId`) matches the kanban
 * columns', so a user can drag any quest from below up into the slot
 * and re-scope.
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
  /** Pass-throughs for the real QuestActiveCard render. */
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
        <span className="quest-scope-header-sub">{scope ? "Project" : "Workspace · Root"}</span>
        {scope && (
          <span className="quest-scope-header-actions">
            {parentScopeId && (
              <button
                type="button"
                className="quest-scope-action"
                onClick={onUp}
                title="Up to parent quest"
                aria-label="Up to parent quest"
              >
                <ArrowUp size={15} strokeWidth={1.8} />
              </button>
            )}
            <button
              type="button"
              className="quest-scope-action"
              onClick={onClear}
              title="Clear scope, back to Workspace"
              aria-label="Clear scope"
            >
              <X size={15} strokeWidth={1.8} />
            </button>
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
              <FolderOpen size={20} strokeWidth={1.6} />
            </span>
            <span className="quest-scope-empty-copy">
              <span className="quest-scope-empty-title">
                Drop a quest here to scope the board to its children
              </span>
              {projectCount > 0 && (
                <span className="quest-scope-empty-hint">
                  {projectCount} {projectCount === 1 ? "project" : "projects"} below
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
