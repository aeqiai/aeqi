/**
 * IdeaConversationPanel — vertical Activity + Comments surface for an Idea.
 *
 * Linear-style stacked sections, both visible in one scroll:
 *   • Subscribe pill — top-right of the panel; flips on click via add_participant
 *   • Activity     — system-emitted events (no avatars, structured rows)
 *   • Comments     — user / agent / position messages, composer at bottom
 *
 * The conversation belongs to the idea's backing session — the Quest surface
 * passes its `quest.idea_id` here so "Quest IS its idea" is visible in the UI.
 *
 * Subscribe is one-way today: clicking adds the caller as a `user`-kind
 * participant on the session. Unsubscribe has no backend verb yet — when the
 * caller is already subscribed the pill is disabled with a "Coming soon"
 * tooltip rather than removed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Spinner, Tooltip } from "@/components/ui";
import { addSessionParticipant, getIdeaComments, type CommentRow } from "@/api/sessions";
import { useAuthStore } from "@/store/auth";
import { useNav } from "@/hooks/useNav";
import IdeaActivityFeed from "./IdeaActivityFeed";
import IdeaCommentsList from "./IdeaCommentsList";
import IdeaCommentComposer from "./IdeaCommentComposer";

interface IdeaConversationPanelProps {
  ideaId: string;
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
          <Button variant="secondary" size="sm" disabled aria-pressed="true">
            <CheckIcon />
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
        aria-pressed="false"
      >
        {busy ? <Spinner size="sm" /> : null}
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

export default function IdeaConversationPanel({ ideaId }: IdeaConversationPanelProps) {
  const user = useAuthStore((s) => s.user);
  const { entityId } = useNav();

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
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
    if (!sessionId) {
      showToast("Add a comment first to open the conversation.");
      return;
    }
    if (!user?.id) {
      showToast("Sign in to subscribe.");
      return;
    }
    setSubscribeBusy(true);
    const res = await addSessionParticipant({
      sessionId,
      kind: "user",
      id: user.id,
    });
    setSubscribeBusy(false);
    if (res.ok) {
      setSubscribed(true);
    } else {
      showToast(res.error ?? "Could not subscribe.");
    }
  }, [sessionId, subscribed, subscribeBusy, user, showToast]);

  const commentCount = useMemo(() => comments.filter((r) => !r.pending).length, [comments]);

  return (
    <div className="idea-convo-root">
      {toastMsg && (
        <div className="idea-convo-toast" role="alert">
          {toastMsg}
        </div>
      )}

      <SubscribeBar
        subscribed={subscribed}
        onSubscribe={handleSubscribe}
        disabled={!sessionId || !user?.id}
        busy={subscribeBusy}
      />

      <section className="idea-convo-section" aria-labelledby={`idea-convo-${ideaId}-activity`}>
        <h3 className="idea-convo-section-title" id={`idea-convo-${ideaId}-activity`}>
          Activity
          {activityCount > 0 && <span className="idea-convo-section-count">{activityCount}</span>}
        </h3>
        <IdeaActivityFeed ideaId={ideaId} onCount={setActivityCount} />
      </section>

      <section className="idea-convo-section" aria-labelledby={`idea-convo-${ideaId}-comments`}>
        <h3 className="idea-convo-section-title" id={`idea-convo-${ideaId}-comments`}>
          Comments
          {commentCount > 0 && <span className="idea-convo-section-count">{commentCount}</span>}
        </h3>
        {loadingComments ? (
          <div className="idea-convo-loading">
            <Spinner size="sm" />
          </div>
        ) : commentError ? (
          <div className="idea-convo-error">{commentError}</div>
        ) : (
          <IdeaCommentsList rows={comments} entityId={entityId} />
        )}
        <IdeaCommentComposer
          ideaId={ideaId}
          onOptimistic={handleOptimistic}
          onConfirm={handleConfirm}
          onError={handleError}
        />
      </section>
    </div>
  );
}
