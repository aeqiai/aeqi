import { useEffect, useRef } from "react";
import type { InboxRow, InboxGroup } from "./types";
import { GROUP_ORDER, relativeTime, initials } from "./types";

export interface InboxListProps {
  rows: InboxRow[];
  selectedId: string | null;
  newIds: Set<string>; // IDs that just arrived via WS — pulse animation
  onSelect: (id: string) => void;
}

export default function InboxList({ rows, selectedId, newIds, onSelect }: InboxListProps) {
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // j/k traversal — driven by the parent via custom event so the keyboard
  // handler in MeInboxPage stays the single owner.
  useEffect(() => {
    const handler = (e: Event) => {
      const { direction } = (e as CustomEvent).detail as { direction: "next" | "prev" };
      if (!rows.length) return;
      const currentIdx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
      let nextIdx: number;
      if (direction === "next") {
        nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
      }
      const next = rows[nextIdx];
      if (next) {
        onSelect(next.id);
        rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("inbox:traverse", handler);
    return () => window.removeEventListener("inbox:traverse", handler);
  }, [rows, selectedId, onSelect]);

  if (rows.length === 0) {
    return (
      <div className="inbox-list-empty">
        <span className="inbox-list-empty-text">Inbox is clear.</span>
      </div>
    );
  }

  // Group rows by time bucket
  const grouped = new Map<InboxGroup, InboxRow[]>();
  for (const row of rows) {
    const g = groupRow(row);
    const existing = grouped.get(g) ?? [];
    existing.push(row);
    grouped.set(g, existing);
  }

  return (
    <div className="inbox-list" role="list">
      {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => {
        const groupRows = grouped.get(group)!;
        return (
          <section key={group} className="inbox-list-group">
            <div className="inbox-list-group-label">{group}</div>
            {groupRows.map((row) => {
              const selected = row.id === selectedId;
              const isNew = newIds.has(row.id);
              const ago = relativeTime(row.created_at);
              const ini = initials(row.from.name);
              return (
                <button
                  key={row.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(row.id, el);
                    else rowRefs.current.delete(row.id);
                  }}
                  type="button"
                  className={[
                    "inbox-list-row",
                    selected ? "is-selected" : "",
                    isNew ? "is-new" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelect(row.id)}
                  aria-selected={selected}
                >
                  {/* Decision-request accent dot — 3px, accent color, left-edge pin */}
                  {row.kind === "decision_request" && (
                    <span className="inbox-row-decision-dot" aria-hidden />
                  )}

                  {/* Unread dot — visual restraint: one 5px graphite dot */}
                  <span className="inbox-row-unread-dot" aria-hidden />

                  {/* Avatar initials */}
                  <span className="inbox-row-avatar" aria-hidden>
                    {ini}
                  </span>

                  {/* Content */}
                  <span className="inbox-row-body">
                    <span className="inbox-row-from">{row.from.name}</span>
                    <span className="inbox-row-subject">{row.subject}</span>
                  </span>

                  {/* Timestamp */}
                  <span className="inbox-row-time" aria-label={`Received ${ago}`}>
                    {ago}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// Re-export so InboxList doesn't have to import types independently at call sites
import { groupOf } from "./types";
function groupRow(row: InboxRow): InboxGroup {
  return groupOf(row.created_at);
}
