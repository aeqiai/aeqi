import { ArrowUp, X } from "lucide-react";
import { Button, IconButton } from "../ui";
import type { Quest, QuestStatus, User } from "@/lib/types";
import QuestActiveCard from "./QuestActiveCard";
import type { QuestDiscoveryHit } from "./agentQuestsHelpers";

/**
 * Focus band — a single card-sized drop slot above the board.
 *
 * Header actions (shown only when scoped):
 *   - Up — moves up one level. If a parent quest exists, navigates to
 *     it; otherwise returns to the workspace root. Always visible
 *     when there's a scope to leave.
 *   - Clear — jumps straight to the workspace root.
 *
 * Slot:
 *   - empty — card-sized dashed drop placeholder. The slot accepts
 *     the same `text/plain = questId` drag payload as the kanban
 *     columns; dropping promotes that quest to focus.
 *   - scoped — a real `QuestActiveCard` constrained to the same
 *     fixed slot width. The card opts out of drag so the slot itself
 *     stays the drop target.
 */
export interface QuestBoardScopeProps {
  scope?: Quest;
  childCount: number;
  parentScopeId: string | null;
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
  searchMatches: Map<string, QuestDiscoveryHit>;
}

export default function QuestBoardScope({
  scope,
  childCount,
  parentScopeId,
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
  searchMatches,
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
    <section className="quest-scope" aria-label="Board focus">
      <header className="quest-scope-header">
        <span className="quest-scope-header-copy">
          <span className="quest-scope-header-label">Focus</span>
        </span>
        {scope && (
          <span className="quest-scope-header-actions">
            <Button size="sm" variant="secondary" onClick={onOpen} title="Open focused quest">
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
              aria-label="Clear focus"
              title="Clear focus"
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
            searchMatch={searchMatches.get(scope.id)}
            draggable={false}
            isScope
          />
        ) : (
          <div className="quest-scope-empty">
            <span className="quest-scope-empty-copy">
              <span className="quest-scope-empty-title">Drop project here</span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
