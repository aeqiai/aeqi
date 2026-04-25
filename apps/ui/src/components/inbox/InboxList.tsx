import { useMemo } from "react";
import type { InboxItem as InboxItemData } from "@/lib/api";
import { type RecencyBucket, recencyBucket } from "@/lib/format";
import InboxItem from "./InboxItem";

interface InboxListProps {
  items: InboxItemData[];
}

/** Order in which buckets render. */
const BUCKET_ORDER: RecencyBucket[] = ["today", "yesterday", "earlier this week", "older"];

/**
 * Inbox row list, grouped by recency. Section labels (`today` /
 * `yesterday` / etc.) sit between row clusters in small lowercase
 * mono — borrowing the rhythm from Things 3's "today / scheduled /
 * someday" panes. The label IS the only group chrome — no boxes, no
 * borders around the cluster.
 *
 * `aria-live="polite"` so assistive tech announces newly-arriving rows;
 * `aria-relevant="additions"` so dismissals don't double-announce.
 */
export default function InboxList({ items }: InboxListProps) {
  const grouped = useMemo(() => {
    const buckets = new Map<RecencyBucket, InboxItemData[]>();
    for (const item of items) {
      const key = recencyBucket(item.awaiting_at);
      const arr = buckets.get(key) ?? [];
      arr.push(item);
      buckets.set(key, arr);
    }
    return BUCKET_ORDER.flatMap((bucket) => {
      const arr = buckets.get(bucket);
      return arr && arr.length > 0 ? [{ bucket, items: arr }] : [];
    });
  }, [items]);

  return (
    <div className="inbox-groups" aria-live="polite" aria-relevant="additions">
      {grouped.map((group) => (
        <section key={group.bucket} className="inbox-group">
          <h2 className="inbox-group-label">{group.bucket}</h2>
          <ul className="inbox-list" role="list">
            {group.items.map((item) => (
              <InboxItem key={item.session_id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
