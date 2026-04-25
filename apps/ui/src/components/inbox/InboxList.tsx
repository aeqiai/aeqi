import { useState } from "react";
import type { InboxItem as InboxItemData } from "@/lib/api";
import InboxItem from "./InboxItem";

interface InboxListProps {
  items: InboxItemData[];
}

/**
 * Single-open accordion of inbox rows. Owns the `expandedSessionId`
 * state so opening a second row collapses the first — keeps the page
 * calm (no wall of textareas) and forces the user toward one decision
 * at a time, which matches the inbox's job.
 *
 * `aria-live="polite"` so assistive tech announces newly-arriving items.
 * `aria-relevant="additions"` so dismissals (which the user just
 * triggered) don't get re-announced.
 */
export default function InboxList({ items }: InboxListProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  return (
    <ul className="inbox-list" role="list" aria-live="polite" aria-relevant="additions">
      {items.map((item) => {
        const isExpanded = expandedSessionId === item.session_id;
        return (
          <InboxItem
            key={item.session_id}
            item={item}
            expanded={isExpanded}
            onToggleExpand={() => {
              setExpandedSessionId(isExpanded ? null : item.session_id);
            }}
            onAnswered={() => {
              // Optimistic dismissal happens inside the store's
              // `answerItem`; we just close the accordion here so the
              // next row click expands cleanly.
              setExpandedSessionId(null);
            }}
          />
        );
      })}
    </ul>
  );
}
