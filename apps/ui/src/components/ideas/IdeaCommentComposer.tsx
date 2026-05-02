/**
 * IdeaCommentComposer — textarea + submit for adding a comment to an idea.
 *
 * Calls messageTo({ target: { kind: "idea", id }, body }).
 * On unknown_command (backend not yet wired), renders disabled with
 * "Coming soon" tooltip so the shell ships ahead of the IPC.
 *
 * Optimistic update: caller supplies onOptimistic / onConfirm / onError
 * so IdeaConversationPanel can splice the temp row and swap it on resolution.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Spinner, Tooltip } from "@/components/ui";
import { messageTo, type CommentRow } from "@/api/sessions";
import { useAuthStore } from "@/store/auth";

interface IdeaCommentComposerProps {
  ideaId: string;
  /**
   * Called synchronously before the IPC call so the parent can append an
   * optimistic row immediately. Returns the temp_id to track it.
   */
  onOptimistic: (row: CommentRow) => void;
  /** Called when the IPC succeeds. Parent swaps the temp row for the real one. */
  onConfirm: (tempId: string, confirmed: CommentRow) => void;
  /** Called when the IPC fails. Parent removes the temp row + surfaces error. */
  onError: (tempId: string, message: string) => void;
}

// Feature-gating: we try messageTo on first submit and, if it returns
// unknown_command, flip the composer to "Coming soon" mode. This state is
// module-level so it survives re-mounts without a redundant probe call.
let knownUnavailable = false;

export default function IdeaCommentComposer({
  ideaId,
  onOptimistic,
  onConfirm,
  onError,
}: IdeaCommentComposerProps) {
  const user = useAuthStore((s) => s.user);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [comingSoon, setComingSoon] = useState(knownUnavailable);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea as the user types.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const submit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || submitting || comingSoon) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const authorName = user?.name ?? user?.email ?? "You";
    const optimisticRow: CommentRow = {
      id: tempId,
      kind: "comment",
      timestamp: now,
      author: authorName,
      author_kind: "user",
      body: trimmed,
      pending: true,
      temp_id: tempId,
    };

    setBody("");
    setSubmitting(true);
    onOptimistic(optimisticRow);

    const result = await messageTo({ target: { kind: "idea", id: ideaId }, body: trimmed });

    if (result.ok) {
      const confirmedRow: CommentRow = { ...optimisticRow, pending: false };
      onConfirm(tempId, confirmedRow);
    } else {
      if (result.error.kind === "unknown_command") {
        knownUnavailable = true;
        setComingSoon(true);
      }
      onError(tempId, result.error.message);
      // Restore the draft so the user doesn't lose what they typed.
      setBody(trimmed);
    }

    setSubmitting(false);
  }, [body, submitting, comingSoon, ideaId, user, onOptimistic, onConfirm, onError]);

  if (comingSoon) {
    return (
      <Tooltip content="Comment posting will be available soon.">
        <div className="idea-convo-composer idea-convo-composer--disabled" aria-disabled="true">
          <textarea
            className="idea-convo-composer-textarea"
            placeholder="Coming soon…"
            disabled
            rows={2}
          />
          <Button variant="primary" size="sm" disabled>
            Comment
          </Button>
        </div>
      </Tooltip>
    );
  }

  const canSubmit = body.trim().length > 0 && !submitting;

  return (
    <div className="idea-convo-composer">
      <textarea
        ref={textareaRef}
        className="idea-convo-composer-textarea"
        placeholder="Add a comment… (⌘↵ to send)"
        value={body}
        rows={2}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="idea-convo-composer-foot">
        <span className="idea-convo-composer-hint">⌘↵ to send</span>
        <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>
          {submitting ? <Spinner size="sm" /> : null}
          Comment
        </Button>
      </div>
    </div>
  );
}
