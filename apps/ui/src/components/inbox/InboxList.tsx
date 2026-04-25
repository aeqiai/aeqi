import type { InboxItem as InboxItemData } from "@/lib/api";
import InboxItem from "./InboxItem";

interface InboxListProps {
  items: InboxItemData[];
}

/**
 * Inbox row list. Each row is a single button that navigates to the
 * source session — no inline reply, no accordion, no preview pane.
 * The row is a pointer; the work happens in the session view.
 *
 * `aria-live="polite"` so assistive tech announces newly-arriving rows;
 * `aria-relevant="additions"` so dismissals (operator just answered)
 * don't double-announce.
 */
export default function InboxList({ items }: InboxListProps) {
  return (
    <ul className="inbox-list" role="list" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <InboxItem key={item.session_id} item={item} />
      ))}
    </ul>
  );
}
