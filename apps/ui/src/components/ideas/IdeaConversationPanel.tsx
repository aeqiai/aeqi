/**
 * IdeaConversationPanel — unified Activity + Comments surface for an Idea.
 *
 * Three lenses via the canonical Tabs primitive:
 *   All      — activity rows and comment bubbles interleaved chronologically
 *   Comments — only user/agent/position messages; composer at bottom
 *   Activity — only system-emitted events (structured, no avatar)
 *
 * The Quest surface passes its quest.idea_id here — "Quest IS its idea"
 * insight is visible in the UI: the conversation belongs to the idea.
 *
 * API stubs return empty arrays while the Senior Architect's backend
 * endpoints are in flight. The panel renders empty states + a gated composer
 * (disabled with "Coming soon" tooltip) until wired.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner, Tabs } from "@/components/ui";
import { getIdeaComments, type ActivityRow, type CommentRow } from "@/api/sessions";
import IdeaActivityFeed from "./IdeaActivityFeed";
import IdeaCommentsList from "./IdeaCommentsList";
import IdeaCommentComposer from "./IdeaCommentComposer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IdeaConversationPanelProps {
  ideaId: string;
}

// ─── All-view: interleave activity + comment rows chronologically ─────────────

type FeedRow = ActivityRow | CommentRow;

function AllFeed({
  activityRows,
  commentRows,
}: {
  activityRows: ActivityRow[];
  commentRows: CommentRow[];
}) {
  const all: FeedRow[] = [...activityRows, ...commentRows].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  if (all.length === 0) {
    return (
      <div className="idea-convo-empty">
        <span className="idea-convo-empty-text">No activity or comments yet.</span>
      </div>
    );
  }

  return (
    <div className="idea-convo-all-feed">
      {all.map((row) => {
        if (row.kind === "activity") {
          const r = row as ActivityRow;
          const label = r.event_type
            ? r.event_type.replace(/_/g, " ").replace(/^(\w)/, (c) => c.toUpperCase())
            : null;
          return (
            <div key={`a-${String(r.id)}`} className="idea-convo-activity-row">
              <span className="idea-convo-activity-dot" aria-hidden />
              <div className="idea-convo-activity-body">
                {label && <span className="idea-convo-activity-type">{label}</span>}
                <span className="idea-convo-activity-summary">{r.summary}</span>
              </div>
              <time
                className="idea-convo-ts"
                dateTime={r.timestamp}
                title={new Date(r.timestamp).toLocaleString()}
              >
                {fmtRelative(r.timestamp)}
              </time>
            </div>
          );
        }
        // comment
        const r = row as CommentRow;
        const hue = authorHue(r.author);
        const avatarStyle = {
          background: `hsl(${hue} 30% 82%)`,
          color: `hsl(${hue} 40% 28%)`,
        };
        return (
          <div
            key={`c-${String(r.id)}`}
            className={`idea-convo-comment${r.pending ? " idea-convo-comment--pending" : ""}`}
          >
            <div className="idea-convo-comment-avatar" style={avatarStyle} aria-hidden>
              {initials(r.author)}
            </div>
            <div className="idea-convo-comment-main">
              <div className="idea-convo-comment-header">
                <span className="idea-convo-comment-author">{r.author}</span>
                <span className="idea-convo-comment-kind">{r.author_kind}</span>
                <time
                  className="idea-convo-ts"
                  dateTime={r.timestamp}
                  title={new Date(r.timestamp).toLocaleString()}
                >
                  {fmtRelative(r.timestamp)}
                </time>
              </div>
              <p className="idea-convo-comment-body">{r.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function IdeaConversationPanel({ ideaId }: IdeaConversationPanelProps) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentError, setCommentError] = useState<string | null>(null);
  // Toast for comment errors (cleared after 4 s)
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Load comments
  useEffect(() => {
    let cancelled = false;
    setLoadingComments(true);
    setCommentError(null);
    getIdeaComments(ideaId)
      .then((rows) => {
        if (!cancelled) {
          setComments(rows);
          setLoadingComments(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setCommentError(e instanceof Error ? e.message : "Failed to load comments");
          setLoadingComments(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ideaId]);

  // Optimistic update handlers for the composer
  const handleOptimistic = useCallback((row: CommentRow) => {
    setComments((prev) => [...prev, row]);
  }, []);

  const handleConfirm = useCallback((tempId: string, confirmed: CommentRow) => {
    setComments((prev) => prev.map((r) => (r.temp_id === tempId ? confirmed : r)));
  }, []);

  const handleError = useCallback(
    (tempId: string, message: string) => {
      setComments((prev) => prev.filter((r) => r.temp_id !== tempId));
      showToast(message);
    },
    [showToast],
  );

  const commentsPanel = (
    <div className="idea-convo-panel-scroll">
      {loadingComments ? (
        <div className="idea-convo-loading">
          <Spinner size="sm" />
        </div>
      ) : commentError ? (
        <div className="idea-convo-error">{commentError}</div>
      ) : (
        <IdeaCommentsList rows={comments} />
      )}
      <IdeaCommentComposer
        ideaId={ideaId}
        onOptimistic={handleOptimistic}
        onConfirm={handleConfirm}
        onError={handleError}
      />
    </div>
  );

  const activityPanel = (
    <div className="idea-convo-panel-scroll">
      <IdeaActivityFeed ideaId={ideaId} />
    </div>
  );

  const allPanel = (
    <div className="idea-convo-panel-scroll">
      {loadingComments ? (
        <div className="idea-convo-loading">
          <Spinner size="sm" />
        </div>
      ) : (
        // Activity rows are fetched inside IdeaActivityFeed; the All tab needs
        // both. Simpler: re-fetch activity here too and interleave. But that
        // doubles the request. Instead we lift only the comment rows from state
        // and pass an empty activityRows placeholder — the All view shows
        // comments interleaved with nothing until activity endpoint lands.
        // When the architect ships /activity, swap in a proper shared fetch.
        <AllFeed activityRows={[]} commentRows={comments} />
      )}
    </div>
  );

  return (
    <div className="idea-convo-root">
      {toastMsg && (
        <div className="idea-convo-toast" role="alert">
          {toastMsg}
        </div>
      )}
      <Tabs
        defaultTab="comments"
        tabs={[
          {
            id: "comments",
            label: "Comments",
            count: comments.filter((r) => !r.pending).length || undefined,
            content: commentsPanel,
          },
          {
            id: "activity",
            label: "Activity",
            content: activityPanel,
          },
          {
            id: "all",
            label: "All",
            content: allPanel,
          },
        ]}
      />
    </div>
  );
}
