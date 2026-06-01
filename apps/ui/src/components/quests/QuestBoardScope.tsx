import { ArrowUp, X } from "lucide-react";
import { Button, IconButton } from "../ui";
import type { Quest, QuestStatus, User } from "@/lib/types";
import StatusDot from "./StatusDot";
import { QUEST_ALL_COLUMNS, type QuestDiscoveryHit } from "./agentQuestsHelpers";

/**
 * Quest focus rail — contextual anchor for viewing a quest's direct subquests.
 *
 * The rail accepts the same `text/plain = questId` drag payload as the board
 * columns; dropping a quest promotes that quest to focus.
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
}: QuestBoardScopeProps) {
  const title = scope?.idea?.name ?? scope?.id ?? "Focused quest";
  const statusLabel = scope
    ? (QUEST_ALL_COLUMNS.find((column) => column.status === scope.status)?.label ?? scope.status)
    : null;
  const childLabel = childCount === 1 ? "1 subquest" : `${childCount} subquests`;
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
    <section
      className="quest-scope"
      aria-label="Board focus"
      data-active={scope ? "" : undefined}
      data-drop-target={dropActive || undefined}
      {...dragProps}
    >
      {scope ? (
        <>
          <div className="quest-scope-main">
            <span className="quest-scope-eyebrow">Focused quest</span>
            <button
              type="button"
              className="quest-scope-title"
              onClick={onOpen}
              title="Open focused quest"
            >
              <StatusDot status={scope.status} />
              <span>{title}</span>
            </button>
            <span className="quest-scope-meta">
              <span>{statusLabel}</span>
              <span>{childLabel}</span>
              {parentScopeId && <span>Nested</span>}
            </span>
          </div>

          <span className="quest-scope-actions">
            <Button size="sm" variant="secondary" onClick={onOpen} title="Open focused quest">
              Open
            </Button>
            {parentScopeId && (
              <Button
                size="sm"
                variant="secondary"
                onClick={onUp}
                leadingIcon={<ArrowUp size={14} strokeWidth={1.8} />}
                title="Up to parent quest"
              >
                Up
              </Button>
            )}
            <IconButton
              size="sm"
              variant="ghost"
              onClick={onClear}
              aria-label="Exit focused quest"
              title="Exit focused quest"
            >
              <X size={15} strokeWidth={1.8} />
            </IconButton>
          </span>
        </>
      ) : (
        <div className="quest-scope-empty">
          <span className="quest-scope-empty-copy">
            <span className="quest-scope-empty-title">Drop quest here</span>
            <span className="quest-scope-empty-note">Focus a quest to view its subquests.</span>
          </span>
        </div>
      )}
    </section>
  );
}
