/**
 * IdeaCommentsList — chat-bubble rows for user / agent / position messages.
 *
 * Sources:
 *   • GET /ideas/:id/comments  (session_messages where role != 'system')
 *
 * Grouped by date bucket: Today / Yesterday / This week / Earlier.
 * Shows avatar initials, author name, body, and relative timestamp.
 */

import type { CommentRow } from "@/api/sessions";

// ─── Time grouping (same logic as IdeaActivityFeed) ──────────────────────────

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

function groupByBucket(rows: CommentRow[]): Map<TimeBucket, CommentRow[]> {
  const map = new Map<TimeBucket, CommentRow[]>();
  for (const row of rows) {
    const b = getBucket(row.timestamp);
    if (!map.has(b)) map.set(b, []);
    map.get(b)!.push(row);
  }
  return map;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic hue for an author string (for avatar bg) */
function authorHue(author: string): number {
  let h = 0;
  for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) & 0xffff;
  return h % 360;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

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
  else label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <time className="idea-convo-ts" dateTime={iso} title={d.toLocaleString()}>
      {label}
    </time>
  );
}

// ─── Comment bubble ───────────────────────────────────────────────────────────

function CommentBubble({ row }: { row: CommentRow }) {
  const hue = authorHue(row.author);
  const avatarStyle = {
    background: `hsl(${hue} 30% 82%)`,
    color: `hsl(${hue} 40% 28%)`,
  };

  return (
    <div className={`idea-convo-comment${row.pending ? " idea-convo-comment--pending" : ""}`}>
      <div className="idea-convo-comment-avatar" style={avatarStyle} aria-hidden>
        {initials(row.author)}
      </div>
      <div className="idea-convo-comment-main">
        <div className="idea-convo-comment-header">
          <span className="idea-convo-comment-author">{row.author}</span>
          <span className="idea-convo-comment-kind">{row.author_kind}</span>
          <RelativeTime iso={row.timestamp} />
        </div>
        <p className="idea-convo-comment-body">{row.body}</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface IdeaCommentsListProps {
  rows: CommentRow[];
}

export default function IdeaCommentsList({ rows }: IdeaCommentsListProps) {
  if (rows.length === 0) {
    return (
      <div className="idea-convo-empty">
        <span className="idea-convo-empty-text">No comments yet — be the first.</span>
      </div>
    );
  }

  // Newest-last so the composer at the bottom is the natural reading end.
  const sorted = [...rows].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const grouped = groupByBucket(sorted);

  return (
    <div className="idea-convo-comments-list">
      {BUCKET_ORDER.filter((b) => grouped.has(b)).map((bucket) => (
        <div key={bucket} className="idea-convo-group">
          <div className="idea-convo-group-label">{bucket}</div>
          <div className="idea-convo-group-rows">
            {grouped.get(bucket)!.map((row) => (
              <CommentBubble key={String(row.id)} row={row} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
