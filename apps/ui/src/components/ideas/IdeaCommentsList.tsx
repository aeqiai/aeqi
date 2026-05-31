/**
 * IdeaCommentsList — chat-bubble rows for user / agent / role messages.
 *
 * Sources:
 *   • GET /ideas/:id/comments  (session_messages where role != 'system')
 *
 * Grouped by date bucket: Today / Yesterday / This week / Earlier.
 * Avatar uses the canonical wrappers (UserAvatar / BlockAvatar) keyed
 * off the resolved display name + (for users) the platform-side
 * `avatar_url`, so a comment bubble renders the same image as the
 * author's profile / sidebar / topbar.
 */

import type { CommentRow } from "@/api/sessions";
import MentionText from "@/components/MentionText";
import UserAvatar from "@/components/UserAvatar";
import BlockAvatar from "@/components/BlockAvatar";
import { formatDateTime, formatShortDate } from "@/lib/i18n";

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

// ─── Comment bubble ───────────────────────────────────────────────────────────

function CommentAvatar({ row }: { row: CommentRow }) {
  // Agents render as block avatars (aeqi convention: round=human, block=agent).
  // User and role both render as round — a role's current occupant is a human
  // and we want their visual identity to read consistently with the rest of
  // the app. System messages don't render comments (they live in the activity
  // section), so this branch is never hit.
  if (row.author_kind === "agent") {
    return <BlockAvatar name={row.author} size={24} />;
  }
  return <UserAvatar name={row.author} size={24} src={row.avatar_url} />;
}

function CommentBubble({ row, companyId }: { row: CommentRow; companyId?: string }) {
  return (
    <div className={`idea-convo-comment${row.pending ? " idea-convo-comment--pending" : ""}`}>
      <CommentAvatar row={row} />
      <div className="idea-convo-comment-main">
        <div className="idea-convo-comment-header">
          <span className="idea-convo-comment-author">{row.author}</span>
          <RelativeTime iso={row.timestamp} />
        </div>
        <p className="idea-convo-comment-body">
          <MentionText body={row.body} companyId={companyId} />
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface IdeaCommentsListProps {
  rows: CommentRow[];
  companyId?: string;
}

export default function IdeaCommentsList({ rows, companyId }: IdeaCommentsListProps) {
  // Empty state intentionally renders nothing — the composer below this
  // list IS the invitation. Generic "No comments yet, be the first" copy
  // was retired 2026-05-17.
  if (rows.length === 0) return null;

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
              <CommentBubble key={String(row.id)} row={row} companyId={companyId} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
