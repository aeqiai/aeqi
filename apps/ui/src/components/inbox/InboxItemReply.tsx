import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spinner } from "@/components/ui";
import { useInboxStore } from "@/store/inbox";

interface InboxItemReplyProps {
  sessionId: string;
  agentId: string | null;
  /** Called after a successful submit so the parent can collapse. */
  onSubmitted: () => void;
  /** Called on Esc from anywhere inside the panel. */
  onCancel: () => void;
}

/**
 * Inline-reply panel revealed beneath an expanded inbox row.
 *
 * Lives in its own component so its form state, autofocus, and keyboard
 * shortcuts don't bloat the row. Cmd/Ctrl+Enter submits; Esc cancels;
 * plain Enter inserts a newline (markdown-friendly answers).
 *
 * Submission is optimistic — the row is dismissed immediately; a server
 * error reverts via the store's `restoreItem` and surfaces a row-level
 * error.
 */
export default function InboxItemReply({
  sessionId,
  agentId,
  onSubmitted,
  onCancel,
}: InboxItemReplyProps) {
  const navigate = useNavigate();
  const answerItem = useInboxStore((s) => s.answerItem);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Autofocus on mount so the user can start typing immediately
    // after the accordion expands.
    textareaRef.current?.focus();
  }, []);

  const submit = async () => {
    if (submitting) return;
    const body = text.trim();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    const res = await answerItem(sessionId, body);
    if (res.ok) {
      onSubmitted();
      return;
    }
    setSubmitting(false);
    setError(res.error || "answer failed");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const openSession = () => {
    if (!agentId) return;
    navigate(`/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`);
  };

  return (
    <div className="inbox-row-reply" role="region" aria-label="Reply">
      <textarea
        ref={textareaRef}
        className="inbox-row-reply-textarea"
        placeholder="Reply…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={submitting}
        aria-label="Your reply"
      />
      {error && (
        <p className="inbox-row-reply-error" role="alert">
          {error}
        </p>
      )}
      <div className="inbox-row-reply-actions">
        <button
          type="button"
          className="inbox-row-reply-link"
          onClick={openSession}
          disabled={!agentId}
        >
          open full session →
        </button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void submit()}
          disabled={!text.trim() || submitting}
        >
          {submitting ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Spinner size="sm" />
              Sending
            </span>
          ) : (
            <span>Send ↵</span>
          )}
        </Button>
      </div>
    </div>
  );
}
