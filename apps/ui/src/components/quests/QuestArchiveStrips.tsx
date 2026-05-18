import { useState } from "react";
import type { Quest, QuestStatus } from "@/lib/types";
import StatusDot from "./StatusDot";
import PriorityIcon from "./PriorityIcon";

/**
 * Backlog + Cancelled rendered as collapsible horizontal strips beneath
 * the four-column active board. Each strip exposes itself as a drop
 * target, so a card from any active column can be demoted (Backlog) or
 * cancelled (Cancelled) by drag — and a chip can be promoted back into
 * the active board by dragging out.
 *
 * Visual shape mirrors the active board: same StatusDot + 32px row,
 * same `--color-card-elevated` chip surface, same `--color-accent`
 * focus ring. The horizontal scroll lives inside the strip body so the
 * page chrome doesn't have to grow when the archive does.
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
}: QuestArchiveStripsProps) {
  const [backlogOpen, setBacklogOpen] = useState(true);
  const [cancelledOpen, setCancelledOpen] = useState(false);

  return (
    <div className="quest-archive-strips">
      {STRIPS.map((col) => {
        const list = grouped[col.status] || [];
        const isOpen = col.status === "backlog" ? backlogOpen : cancelledOpen;
        const toggle = () => {
          if (col.status === "backlog") setBacklogOpen((v) => !v);
          else setCancelledOpen((v) => !v);
        };
        const isTarget = dropTarget === col.status;
        return (
          <section
            key={col.status}
            className="quest-archive-strip"
            data-status={col.status}
            data-open={isOpen || undefined}
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
            <button
              type="button"
              className="quest-archive-strip-head"
              onClick={toggle}
              aria-expanded={isOpen}
            >
              <svg
                className="quest-archive-strip-chevron"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={isOpen ? "M2 4 L5 7 L8 4" : "M4 2 L7 5 L4 8"} />
              </svg>
              <StatusDot status={col.status} />
              <span className="quest-archive-strip-label">{col.label}</span>
              <span className="quest-archive-strip-count">{list.length}</span>
            </button>
            {isOpen && (
              <div className="quest-archive-strip-body">
                {list.length === 0 ? (
                  <div className="quest-archive-strip-empty">
                    {isTarget ? "Drop here" : "Nothing here"}
                  </div>
                ) : (
                  list.map((q) => (
                    <article
                      key={q.id}
                      className="quest-archive-chip"
                      data-priority={q.priority}
                      data-dragging={dragging === q.id || undefined}
                      data-focused={focusId === q.id || undefined}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", q.id);
                        setDragging(q.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setDropTarget(null);
                      }}
                      onClick={() => onPick(q.id)}
                    >
                      <StatusDot status={optimistic[q.id] ?? q.status} />
                      <span className="quest-archive-chip-subject">{q.idea?.name ?? q.id}</span>
                      <PriorityIcon priority={q.priority} />
                    </article>
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
