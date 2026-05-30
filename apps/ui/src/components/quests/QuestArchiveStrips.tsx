import { useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Quest, QuestStatus, User } from "@/lib/types";
import StatusDot from "./StatusDot";
import QuestActiveCard from "./QuestActiveCard";
import type { QuestDiscoveryHit } from "./agentQuestsHelpers";

/**
 * Backlog + Cancelled rendered as visible secondary Kanban lanes beneath
 * the four active columns. They are still real drop targets and use the
 * same card component as the main board, so parking or cancelling work
 * remains part of the workflow instead of disappearing into an archive.
 */
export interface QuestArchiveStripsProps {
  grouped: Record<QuestStatus, Quest[]>;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  dropTarget: QuestStatus | null;
  setDropTarget: (status: QuestStatus | null) => void;
  onDrop: (id: string, target: QuestStatus) => void | Promise<void>;
  optimistic: Record<string, QuestStatus>;
  focusId: string | null;
  onPick: (id: string) => void;
  onTake: (id: string) => void | Promise<void>;
  onCreated: () => void;
  onError: (msg: string) => void;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  searchMatches: Map<string, QuestDiscoveryHit>;
}

const STRIPS: Array<{ status: QuestStatus; label: string }> = [
  { status: "backlog", label: "Backlog" },
  { status: "cancelled", label: "Cancelled" },
];

export default function QuestArchiveStrips({
  grouped,
  dragging,
  setDragging,
  dropTarget,
  setDropTarget,
  onDrop,
  optimistic,
  focusId,
  onPick,
  onTake,
  onCreated,
  onError,
  agents,
  users,
  searchMatches,
}: QuestArchiveStripsProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    backlog: true,
    cancelled: true,
  });
  const allCollapsed = STRIPS.every((strip) => collapsed[strip.status]);
  const toggleLane = (status: QuestStatus) =>
    setCollapsed((prev) => ({ ...prev, [status]: !prev[status] }));
  const toggleLaneFromKeyboard = (event: KeyboardEvent<HTMLElement>, status: QuestStatus) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleLane(status);
  };

  return (
    <div
      className="quest-secondary-lanes"
      aria-label="Backlog and cancelled lanes"
      data-collapsed={allCollapsed || undefined}
    >
      {STRIPS.map((col) => {
        const list = grouped[col.status] || [];
        const isTarget = dropTarget === col.status;
        const isCollapsed = !!collapsed[col.status];
        return (
          <section
            key={col.status}
            className="quest-col quest-secondary-lane"
            data-status={col.status}
            data-archive-collapsed={isCollapsed || undefined}
            data-drop-target={isTarget || undefined}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== col.status) setDropTarget(col.status);
            }}
            onDragLeave={(e) => {
              const related = e.relatedTarget as Node | null;
              if (related && e.currentTarget.contains(related)) return;
              if (dropTarget === col.status) setDropTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragging;
              if (id) void onDrop(id, col.status);
              setDragging(null);
              setDropTarget(null);
            }}
          >
            <header
              role="button"
              tabIndex={0}
              className="quest-col-header quest-col-header--toggle"
              onClick={() => toggleLane(col.status)}
              onKeyDown={(event) => toggleLaneFromKeyboard(event, col.status)}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? "Expand lane" : "Collapse lane"}
            >
              <StatusDot status={col.status} />
              <span className="quest-col-label">{col.label}</span>
              <span className="quest-col-count">{list.length}</span>
              <span className="quest-col-collapse" aria-hidden>
                {isCollapsed ? (
                  <ChevronRight size={14} strokeWidth={1.8} />
                ) : (
                  <ChevronDown size={14} strokeWidth={1.8} />
                )}
              </span>
            </header>
            {!isCollapsed && (
              <div className="quest-col-body">
                {list.length === 0 ? (
                  <div className="quest-col-empty">{isTarget ? "Drop here" : "Nothing here"}</div>
                ) : (
                  list.map((q) => (
                    <QuestActiveCard
                      key={q.id}
                      q={q}
                      optimistic={optimistic}
                      dragging={dragging}
                      focusId={focusId}
                      setDragging={setDragging}
                      setDropTarget={setDropTarget}
                      onPick={onPick}
                      onTake={onTake}
                      onCreated={onCreated}
                      onError={onError}
                      agents={agents}
                      users={users}
                      searchMatch={searchMatches.get(q.id)}
                    />
                  ))
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
