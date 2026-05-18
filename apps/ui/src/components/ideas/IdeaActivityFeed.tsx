/**
 * IdeaActivityFeed — structured, muted feed of system-emitted events.
 *
 * Sources:
 *   • GET /ideas/:id/activity  (activity_log rows + role=system session_messages)
 *
 * Rows are grouped by date bucket: Today / Yesterday / This week / Earlier.
 * No avatars — activity is system-emitted and author-less.
 */

import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { getIdeaActivity, type ActivityRow } from "@/api/sessions";
import { formatDateTime, formatShortDate } from "@/lib/i18n";

// ─── Time grouping ────────────────────────────────────────────────────────────

type TimeBucket = "Today" | "Yesterday" | "This week" | "Earlier";

function getBucket(isoTs: string): TimeBucket {
  const now = new Date();
  const d = new Date(isoTs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  if (d >= todayStart) return "Today";
  if (d >= yesterdayStart) return "Yesterday";
  if (d >= weekStart) return "This week";
  return "Earlier";
}

const BUCKET_ORDER: TimeBucket[] = ["Today", "Yesterday", "This week", "Earlier"];

function groupByBucket(rows: ActivityRow[]): Map<TimeBucket, ActivityRow[]> {
  const map = new Map<TimeBucket, ActivityRow[]>();
  for (const row of rows) {
    const b = getBucket(row.timestamp);
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(row);
  }
  return map;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RelativeTime({ iso }: { iso: string }) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);

  let label: string;
  if (mins < 1) label = "just now";
  else if (mins < 60) label = `${mins}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else label = formatShortDate(d);

  return (
    <time className="idea-convo-ts" dateTime={iso} title={formatDateTime(d)}>
      {label}
    </time>
  );
}

function ActivityItem({ row }: { row: ActivityRow }) {
  const label = row.event_type
    ? row.event_type.replace(/_/g, " ").replace(/^(\w)/, (c) => c.toUpperCase())
    : null;

  return (
    <div className="idea-convo-activity-row">
      <span className="idea-convo-activity-dot" aria-hidden />
      <div className="idea-convo-activity-body">
        {label && <span className="idea-convo-activity-type">{label}</span>}
        <span className="idea-convo-activity-summary">{row.summary}</span>
      </div>
      <RelativeTime iso={row.timestamp} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface IdeaActivityFeedProps {
  ideaId: string;
  refreshKey?: unknown;
  limit?: number;
  /** Optional callback fired with the row count after each load — lets the
   *  parent section header render an item-count badge without re-fetching. */
  onCount?: (count: number) => void;
}

export default function IdeaActivityFeed({
  ideaId,
  refreshKey,
  limit,
  onCount,
}: IdeaActivityFeedProps) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getIdeaActivity(ideaId)
      .then((r) => {
        if (cancelled) return;
        const sorted = r.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        setRows(sorted);
        setLoading(false);
        onCount?.(sorted.length);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load activity");
        setLoading(false);
        onCount?.(0);
      });
    return () => {
      cancelled = true;
    };
  }, [ideaId, refreshKey, onCount]);

  if (loading) {
    return (
      <div className="idea-convo-loading">
        <Loading size="sm" />
      </div>
    );
  }

  if (error) {
    return <div className="idea-convo-error">{error}</div>;
  }

  if (rows.length === 0) {
    // Quiet inline empty state — this is a section, not a full surface.
    return <div className="idea-convo-section-empty">No activity yet</div>;
  }

  const visibleRows = typeof limit === "number" ? rows.slice(0, limit) : rows;
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);
  const grouped = groupByBucket(visibleRows);

  return (
    <div className="idea-convo-activity-feed">
      {BUCKET_ORDER.filter((b) => grouped.has(b)).map((bucket) => (
        <div key={bucket} className="idea-convo-group">
          <div className="idea-convo-group-label">{bucket}</div>
          <div className="idea-convo-group-rows">
            {grouped.get(bucket)!.map((row) => (
              <ActivityItem key={String(row.id)} row={row} />
            ))}
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div className="idea-convo-activity-more" aria-label={`${hiddenCount} more activity rows`}>
          +{hiddenCount} more
        </div>
      )}
    </div>
  );
}
