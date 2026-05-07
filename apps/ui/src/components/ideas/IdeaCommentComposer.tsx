/**
 * IdeaCommentComposer — thin wrapper around the canonical `<Composer>`
 * primitive that adapts an idea-comment optimistic-update flow.
 *
 * Calls messageTo({ target: { kind: "idea", id }, body }).
 * On unknown_command (backend not yet wired), renders disabled with
 * "Coming soon" tooltip so the shell ships ahead of the IPC.
 *
 * Optimistic update: caller supplies onOptimistic / onConfirm / onError
 * so IdeaConversationPanel can splice the temp row and swap it on resolution.
 *
 * Adopts canonical Enter-to-send (the prior surface used ⌘↵; chat-shape
 * is the canonical contract per `architecture_session_primitive.md`).
 */

import { useCallback, useState } from "react";
import { Tooltip } from "@/components/ui";
import Composer from "@/components/composer/Composer";
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
        <div aria-disabled="true">
          <Composer
            variant="card"
            value=""
            onChange={() => {}}
            onSend={() => {}}
            placeholder="Coming soon…"
            disabled
            sendLabel="Comment"
          />
        </div>
      </Tooltip>
    );
  }

  return (
    <Composer
      variant="card"
      value={body}
      onChange={setBody}
      onSend={() => void submit()}
      placeholder="Add a comment…"
      disabled={submitting}
      sendLabel="Comment"
    />
  );
}
