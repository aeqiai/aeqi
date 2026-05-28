/**
 * SessionDetail — universal session-pane primitive.
 *
 * Per `architecture_session_primitive.md`: Session is the universal
 * conversation primitive (chat / inbox / comments / activity / channels /
 * mentions). This primitive collapses the right-pane render path into one
 * component. Each surface adapts its data layer (Zustand inbox-store
 * polling, WebSocket streaming, react-query polling, …) into the same
 * prop contract; the primitive renders identically across them.
 *
 * Layout, top-to-bottom:
 *   1. ParticipantStrip      — multi-participant avatars (always-on).
 *   2. Header row            — title + subtitle + headerExtras slot.
 *   3. Messages list         — MessageItem stream, auto-scroll, empty state.
 *   4. Composer              — full <Composer> primitive at the bottom.
 *
 * Transport-agnostic. The primitive does not own:
 *   - Where messages come from (inbox-store, WS dispatcher, react-query, …).
 *   - How `onSend` posts (inbox.answerItem, WS dispatchMessage, …).
 *   - Streaming state (caller passes isStreaming if relevant).
 *
 * Visual variant matches the inbox + agent surfaces' shipped state:
 *   composer-wrap + persistent-composer + Composer variant="shell".
 */

import { useEffect, useRef, useState } from "react";
import Composer from "@/components/composer/Composer";
import MessageItem from "@/components/session/MessageItem";
import ParticipantStrip from "@/components/sessions/ParticipantStrip";
import type { Message } from "@/components/session/types";
import type { ComposerAttachmentKind, ComposerFile } from "@/components/composer/Composer";
import { useRelativeNow } from "@/hooks/useRelativeNow";
import { timeAgo } from "@/lib/format";

/** Compact relative-time for the chat header — wraps `timeAgo`'s ISO API
 *  for the millisecond timestamps message rows carry. */
function formatRelative(ms: number): string {
  return timeAgo(new Date(ms).toISOString());
}

export interface SessionDetailProps {
  // Session identity — drives ParticipantStrip, MessageItem author resolution.
  sessionId: string | null;
  /** When provided, scoped to this entity (proxy injects authed
   * X-Trust for participant lookups). */
  trustId?: string;
  /** Agent ID for the session — used by MessageItem's resolveAuthor for
   * legacy fallback when from_kind is not set on the row. Optional. */
  agentId?: string;

  // Header.
  title?: string;
  subtitle?: string;
  /** Right-aligned slot in the header row (e.g. "Open" / "Back" buttons). */
  headerExtras?: React.ReactNode;

  // Stream.
  messages: Message[];
  isStreaming?: boolean;

  // Composer.
  onSend: (body: string) => void | Promise<void>;
  onStop?: () => void;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  attachmentTypes?: ComposerAttachmentKind[];
  historySource?: string[];
  composerPlaceholder?: string;
  /** Disable input + send (renders chrome but locks composer). */
  composerDisabled?: boolean;
  /** Idea/quest picker chips above the input (parent-managed state). */
  attachedIdeas?: string[];
  setAttachedIdeas?: React.Dispatch<React.SetStateAction<string[]>>;
  attachedQuest?: { id: string; name: string } | null;
  setAttachedQuest?: (next: { id: string; name: string } | null) => void;
  attachedFiles?: ComposerFile[];
  setAttachedFiles?: React.Dispatch<React.SetStateAction<ComposerFile[]>>;
  onAttachClick?: (kind: "idea" | "quest") => void;
  onReadFiles?: (files: FileList | File[]) => void;

  // Empty state — shown when messages.length === 0.
  emptyTitle?: string;
  emptyHint?: string;

  /** Full-width slot rendered between the header row and the thread — for
   * urgency strips (decision-request tag, awaiting banner, etc.). */
  preThreadSlot?: React.ReactNode;

  /** Slot rendered inside the thread, AFTER the messages map and BEFORE the
   * empty-state. Used by the agent surface to render <StreamingMessage> and
   * queued drafts that don't fit cleanly into the static messages array. */
  threadTrailingSlot?: React.ReactNode;

  /** Per-message interaction handlers — threaded into MessageItem. Optional;
   * when absent the message bubbles render without those affordances (the
   * inbox surface doesn't expose fork/edit/resend). */
  onFork?: (messageId: number) => void;
  onEdit?: (messageId: number, text: string) => void;
  onResend?: (text: string) => void;

  // Inline error banner — rendered above the composer.
  errorMessage?: string | null;

  /** Hide the composer chrome entirely (e.g. when an external chrome owns it).
   * Default: composer renders inside the primitive. */
  hideComposer?: boolean;
  /** Hide the pane-local header when a parent shell owns the context header. */
  hideHeader?: boolean;
  /** Shared visual surface. Recessed is the Inbox/agent chat canvas. */
  surface?: "plain" | "recessed";
}

// Distance (px) from the bottom of the thread within which the user is still
// considered "stuck to bottom" — small jitter from sub-pixel scroll positions
// or short fade-gradient slop shouldn't detach the auto-scroll.
const SCROLL_BOTTOM_TOLERANCE = 32;

export default function SessionDetail({
  sessionId,
  trustId,
  agentId,
  title,
  subtitle,
  headerExtras,
  messages,
  isStreaming = false,
  onSend,
  onStop,
  composerRef,
  attachmentTypes,
  historySource,
  composerPlaceholder = "Message…",
  composerDisabled = false,
  attachedIdeas,
  setAttachedIdeas,
  attachedQuest,
  setAttachedQuest,
  attachedFiles,
  setAttachedFiles,
  onAttachClick,
  onReadFiles,
  emptyTitle,
  emptyHint,
  preThreadSlot,
  threadTrailingSlot,
  onFork,
  onEdit,
  onResend,
  errorMessage,
  hideComposer = false,
  hideHeader = false,
  surface = "plain",
}: SessionDetailProps) {
  // Subscribe to the shared 60 s tick so the header's "Active 2m ago" label
  // advances even when no new message arrives.
  useRelativeNow();

  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);
  // Whether the thread is currently pinned at (or very near) the bottom.
  // Driven by the scroll handler; consulted by the messages effect to decide
  // whether to auto-scroll new arrivals or surface a "↓ N new" jump button.
  const stuckRef = useRef(true);
  const prevMessageCountRef = useRef(0);
  const [unreadWhileDetached, setUnreadWhileDetached] = useState(0);
  const [body, setBody] = useState("");

  // Reset per-session draft + scroll posture when selection changes.
  // Pin to bottom on session switch — a fresh thread should land at the
  // newest message, not whatever scroll position the previous session held.
  useEffect(() => {
    setBody("");
    stuckRef.current = true;
    prevMessageCountRef.current = messages.length;
    setUnreadWhileDetached(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // New messages: auto-scroll only when the user was already at the bottom.
  // If they had scrolled up, leave them alone and count arrivals so the jump
  // button can surface "↓ N new". Same idiom every mature chat app uses.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevLen = prevMessageCountRef.current;
    const newLen = messages.length;
    prevMessageCountRef.current = newLen;

    if (stuckRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnreadWhileDetached((c) => (c === 0 ? c : 0));
    } else if (newLen > prevLen) {
      setUnreadWhileDetached((c) => c + (newLen - prevLen));
    }
  }, [messages]);

  const handleThreadScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nowStuck = distance <= SCROLL_BOTTOM_TOLERANCE;
    if (nowStuck === stuckRef.current) return;
    stuckRef.current = nowStuck;
    if (nowStuck) setUnreadWhileDetached(0);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuckRef.current = true;
    setUnreadWhileDetached(0);
  };

  // Publish the composer's live height as `--inbox-composer-height` on
  // the nearest recessed surface so the thread's bottom padding and the
  // fade-gradient grow with the draft. Mirrors the prior InboxComposer
  // ResizeObserver — same idiom, scoped variable, shared CSS consumer.
  useEffect(() => {
    if (hideComposer) return;
    const el = wrapRef.current;
    if (!el) return;
    const detail = el.closest<HTMLElement>(".session-detail--recessed, .inbox-pane-detail");
    if (!detail) return;

    const apply = () => {
      const newHeight = Math.ceil(el.offsetHeight);
      if (newHeight !== lastHeightRef.current) {
        lastHeightRef.current = newHeight;
        detail.style.setProperty("--inbox-composer-height", `${newHeight}px`);
      }
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);

    return () => {
      ro.disconnect();
      detail.style.removeProperty("--inbox-composer-height");
    };
  }, [hideComposer]);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || composerDisabled) return;
    setBody("");
    await onSend(trimmed);
  };

  // Activity meta — relative time of the last message, or "Streaming…" while
  // a turn is in flight. Read from the last message's timestamp; if none is
  // present we fall through to no-meta. Re-computed every render — cheap.
  const lastTimestamp = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const ts = messages[i]?.timestamp;
      if (typeof ts === "number" && ts > 0) return ts;
    }
    return null;
  })();
  const activityLabel = isStreaming
    ? "Streaming…"
    : lastTimestamp != null
      ? `Active ${formatRelative(lastTimestamp)}`
      : null;

  const className = [
    "session-detail",
    surface === "recessed" ? "session-detail--recessed" : "",
    hideComposer ? "session-detail--external-composer" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      {!hideHeader && (title || headerExtras || sessionId) && (
        <div className="session-detail-header">
          <div className="session-detail-header-from">
            {title && <span className="session-detail-header-title">{title}</span>}
            <div className="session-detail-header-meta">
              {subtitle && <span className="session-detail-header-subtitle">{subtitle}</span>}
              {subtitle && activityLabel && (
                <span className="session-detail-header-meta-sep" aria-hidden>
                  ·
                </span>
              )}
              {activityLabel && (
                <span
                  className={`session-detail-header-activity${isStreaming ? " is-streaming" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  {activityLabel}
                </span>
              )}
            </div>
          </div>
          <div className="session-detail-header-extras">
            {sessionId && <ParticipantStrip sessionId={sessionId} trustId={trustId} />}
            {headerExtras}
          </div>
        </div>
      )}

      {preThreadSlot}

      <div
        className="session-detail-thread"
        ref={scrollRef}
        onScroll={handleThreadScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-atomic="false"
        aria-label="Conversation"
      >
        {messages.length === 0 && !threadTrailingSlot ? (
          <div className="session-detail-empty">
            {emptyTitle && <div className="session-detail-empty-title">{emptyTitle}</div>}
            {emptyHint && <div className="session-detail-empty-hint">{emptyHint}</div>}
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageItem
                key={msg.messageId ?? i}
                msg={msg}
                sessionAgentId={agentId}
                sessionTrustId={trustId}
                onFork={onFork}
                onEdit={onEdit}
                onResend={onResend}
              />
            ))}
            {threadTrailingSlot}
          </>
        )}
      </div>

      {unreadWhileDetached > 0 && (
        <button
          type="button"
          className="session-detail-jump"
          onClick={jumpToBottom}
          aria-label={`Jump to bottom — ${unreadWhileDetached} new ${unreadWhileDetached === 1 ? "message" : "messages"}`}
        >
          <span aria-hidden>↓</span> {unreadWhileDetached} new
        </button>
      )}

      {!hideComposer && (
        <div className="inbox-composer-wrap" ref={wrapRef}>
          {errorMessage && (
            <div className="inbox-composer-error" role="alert">
              {errorMessage}
            </div>
          )}
          <div className="composer-wrap">
            <div className="persistent-composer">
              <Composer
                variant="shell"
                value={body}
                onChange={setBody}
                onSend={() => void handleSend()}
                onStop={onStop}
                streaming={isStreaming}
                placeholder={composerPlaceholder}
                composerRef={composerRef}
                disabled={composerDisabled}
                attachmentTypes={attachmentTypes}
                attachedIdeas={attachedIdeas}
                setAttachedIdeas={setAttachedIdeas}
                attachedQuest={attachedQuest}
                setAttachedQuest={setAttachedQuest}
                attachedFiles={attachedFiles}
                setAttachedFiles={setAttachedFiles}
                onAttachClick={onAttachClick}
                onReadFiles={onReadFiles}
                historySource={historySource}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
