/**
 * IdeaConversationPanel — vertical Comments + Activity surface for an Idea.
 *
 * Linear-style stacked sections, both visible in one scroll:
 *   • Subscribe pill — top-right of the panel; flips on click via add_participant
 *   • Comments     — user / agent / position messages, composer at bottom
 *   • Activity     — system-emitted events shown as a compact peek strip
 *
 * The conversation belongs to the idea's backing session — the Quest surface
 * passes its `quest.idea_id` here so "Quest IS its idea" is visible in the UI.
 *
 * Subscribe is one-way today: clicking POSTs `/api/ideas/:id/subscribe`,
 * which lazy-creates the idea's backing session if one doesn't exist yet
 * and adds the caller as a `user`-kind participant. Unsubscribe has no
 * backend verb yet — when the caller is already subscribed the pill is
 * disabled with a "Coming soon" tooltip rather than removed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Loading, Tooltip } from "@/components/ui";
import { getIdeaComments, subscribeToIdea, type CommentRow } from "@/api/sessions";
import { useAuthStore } from "@/store/auth";
import { useNav } from "@/hooks/useNav";
import IdeaActivityFeed from "./IdeaActivityFeed";
import IdeaCommentsList from "./IdeaCommentsList";
import IdeaCommentComposer from "./IdeaCommentComposer";

interface IdeaConversationPanelProps {
  ideaId: string;
  activityRefreshKey?: unknown;
}

// ─── SubscribeBar ─────────────────────────────────────────────────────────────

interface SubscribeBarProps {
  subscribed: boolean;
  onSubscribe: () => void;
  disabled?: boolean;
  busy?: boolean;
}

function SubscribeBar({ subscribed, onSubscribe, disabled, busy }: SubscribeBarProps) {
  if (subscribed) {
    return (
      <div className="idea-convo-subscribe-bar">
        <Tooltip content="Unsubscribe coming soon">
          <Button
            variant="secondary"
            size="sm"
            disabled
            aria-pressed="true"
            leadingIcon={<CheckIcon />}
          >
            Subscribed
          </Button>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="idea-convo-subscribe-bar">
      <Button
        variant="secondary"
        size="sm"
        onClick={onSubscribe}
        disabled={disabled || busy}
        loading={busy}
        aria-pressed="false"
      >
        Subscribe
      </Button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function IdeaConversationPanel({
  ideaId,
  activityRefreshKey,
}: IdeaConversationPanelProps) {
  const user = useAuthStore((s) => s.user);
  const { trustId } = useNav();

  const [comments, setComments] = useState<CommentRow[]>([]);
  // sessionId is tracked so subsequent operations (e.g. unsubscribe, polling)
  // have a stable handle once the backend lazy-creates it. Currently only
  // written; future surfaces will read it.
  const [, setSessionId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [subscribeBusy, setSubscribeBusy] = useState(false);
  const [activityCount, setActivityCount] = useState(0);

  // Toast for comment / subscribe errors (cleared after 4 s)
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

  // Load comments + envelope (sessionId, subscribed)
  useEffect(() => {
    let cancelled = false;
    setLoadingComments(true);
    setCommentError(null);
    getIdeaComments(ideaId)
      .then((payload) => {
        if (cancelled) return;
        setComments(payload.rows);
        setSessionId(payload.sessionId);
        setSubscribed(payload.subscribed);
        setLoadingComments(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setCommentError(e instanceof Error ? e.message : "Failed to load comments");
        setLoadingComments(false);
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

  const handleSubscribe = useCallback(async () => {
    if (subscribeBusy || subscribed) return;
    if (!user?.id) {
      showToast("Sign in to subscribe.");
      return;
    }
    setSubscribeBusy(true);
    // The backend lazy-creates the session if needed, so a fresh idea with
    // no comments is still subscribable.
    const res = await subscribeToIdea(ideaId);
    setSubscribeBusy(false);
    if (res.ok) {
      setSubscribed(true);
      if (res.sessionId) setSessionId(res.sessionId);
    } else {
      showToast(res.error ?? "Could not subscribe.");
    }
  }, [ideaId, subscribed, subscribeBusy, user, showToast]);

  const commentCount = useMemo(() => comments.filter((r) => !r.pending).length, [comments]);

  return (
    <div className="idea-convo-root">
      {toastMsg && (
        <div className="idea-convo-toast" role="alert">
          {toastMsg}
        </div>
      )}

      <div className="idea-convo-head">
        <div className="idea-convo-title">
          <span>Comments</span>
          <span className="idea-convo-section-count">{commentCount}</span>
        </div>
        <SubscribeBar
          subscribed={subscribed}
          onSubscribe={handleSubscribe}
          disabled={!user?.id}
          busy={subscribeBusy}
        />
      </div>

      <section className="idea-convo-panel" aria-label="Comments">
        {loadingComments ? (
          <div className="idea-convo-loading">
            <Loading size="sm" />
          </div>
        ) : commentError ? (
          <div className="idea-convo-error">{commentError}</div>
        ) : (
          <IdeaCommentsList rows={comments} trustId={trustId} />
        )}
        <IdeaCommentComposer
          ideaId={ideaId}
          onOptimistic={handleOptimistic}
          onConfirm={handleConfirm}
          onError={handleError}
        />
      </section>

      <section className="idea-convo-activity-peek" aria-label="Recent activity">
        <div className="idea-convo-peek-head">
          <span>Activity</span>
          <span className="idea-convo-section-count">{activityCount}</span>
        </div>
        <IdeaActivityFeed
          ideaId={ideaId}
          refreshKey={activityRefreshKey}
          limit={4}
          onCount={setActivityCount}
        />
      </section>
    </div>
  );
}
