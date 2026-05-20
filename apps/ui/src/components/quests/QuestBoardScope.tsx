import { ArrowUp, ExternalLink, FolderOpen, X } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Quest } from "@/lib/types";
import StatusDot from "./StatusDot";

/**
 * Single-row scope band above the kanban. Two display modes:
 *
 *   1. Empty (`scope` undefined) — dashed-border placeholder inviting
 *      drag-from-board or click-from-list. The board below shows every
 *      top-level project as its own scope.
 *   2. Scoped (`scope` set) — one full-width quest card with title,
 *      subquest count, age, and right-edge actions (Up to parent,
 *      Clear back to root, Open the quest detail). The board below
 *      filters to direct children of this scope.
 *
 * Accepts the same drag payload as the kanban columns
 * (`dataTransfer.getData("text/plain") = questId`) so users can promote
 * any quest to scope by dragging it up into the band.
 */
export interface QuestBoardScopeProps {
  scope?: Quest;
  childCount: number;
  /** When scoped, the immediate parent quest id (or `null` if the
   *  scope is a root project). `Up` navigates here. */
  parentScopeId: string | null;
  /** Total root-level project count, shown as a hint in the empty
   *  state ("12 projects available — drag one up"). */
  projectCount: number;
  dragging: string | null;
  dropActive: boolean;
  onDropActiveChange: (next: boolean) => void;
  onDrop: (questId: string) => void;
  onUp: () => void;
  onClear: () => void;
  onOpen: () => void;
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

  if (!scope) {
    return (
      <div
        className="quest-scope"
        data-empty
        data-drop-target={dropActive || undefined}
        {...dragProps}
      >
        <div className="quest-scope-empty">
          <span className="quest-scope-empty-icon" aria-hidden>
            <FolderOpen size={20} strokeWidth={1.6} />
          </span>
          <span className="quest-scope-empty-copy">
            <span className="quest-scope-empty-title">Workspace · Root</span>
            <span className="quest-scope-empty-hint">
              Drop a quest here to scope the board to its children
              {projectCount > 0 && (
                <>
                  <span className="quest-scope-empty-sep" aria-hidden>
                    ·
                  </span>
                  {projectCount} {projectCount === 1 ? "project" : "projects"} below
                </>
              )}
            </span>
          </span>
        </div>
      </div>
    );
  }

  const title = scope.idea?.name ?? scope.id;
  return (
    <div className="quest-scope" data-drop-target={dropActive || undefined} {...dragProps}>
      <button
        type="button"
        className="quest-scope-action quest-scope-up"
        onClick={onUp}
        title={parentScopeId ? "Up to parent quest" : "Back to Workspace"}
        aria-label={parentScopeId ? "Up to parent quest" : "Back to workspace"}
      >
        <ArrowUp size={16} strokeWidth={1.8} />
      </button>
      <div
        className="quest-scope-card"
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onOpen();
        }}
      >
        <StatusDot status={scope.status} />
        <div className="quest-scope-text">
          <span className="quest-scope-kicker">Project scope</span>
          <span className="quest-scope-title" title={title}>
            {title}
          </span>
        </div>
        <span className="quest-scope-meta">
          <span className="quest-scope-count">
            <FolderOpen size={12} strokeWidth={1.7} aria-hidden />
            {childCount} {childCount === 1 ? "subquest" : "subquests"}
          </span>
          {scope.updated_at && (
            <span className="quest-scope-age">updated {timeAgo(scope.updated_at)}</span>
          )}
        </span>
      </div>
      <button
        type="button"
        className="quest-scope-action quest-scope-open"
        onClick={onOpen}
        title="Open quest detail"
        aria-label="Open quest detail"
      >
        <ExternalLink size={15} strokeWidth={1.7} />
      </button>
      <button
        type="button"
        className="quest-scope-action quest-scope-clear"
        onClick={onClear}
        title="Clear scope, back to Workspace"
        aria-label="Clear scope"
      >
        <X size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}
