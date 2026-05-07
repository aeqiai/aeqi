import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui";
import Composer from "@/components/composer/Composer";
import { probeDismissEndpoint } from "@/store/inbox";

export interface InboxComposerProps {
  sessionId: string;
  onSend: (sessionId: string, body: string) => Promise<{ ok: boolean; error?: string }>;
  onDismiss: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

// Archive icon — box with tray + horizontal bar inside
function ArchiveIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1" y="2" width="11" height="2.5" rx="0.5" />
      <path d="M2 4.5v5.5a1 1 0 001 1h7a1 1 0 001-1V4.5" />
      <path d="M4.5 7.5h4" />
    </svg>
  );
}

/**
 * InboxComposer — thin wrapper around the canonical `<Composer>` primitive
 * that provides the inbox-specific Archive button, dismiss-endpoint probe,
 * and per-session state reset. Adopts canonical Enter-to-send (the prior
 * surface used ⌘↵; chat-shape is the canonical contract per
 * `architecture_session_primitive.md`).
 */
export default function InboxComposer({
  sessionId,
  onSend,
  onDismiss,
  composerRef,
}: InboxComposerProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = probing, true = available, false = not yet deployed
  const [dismissAvailable, setDismissAvailable] = useState<boolean | null>(null);

  // Probe dismiss endpoint availability once, not per-session
  const probeRef = useRef(false);
  useEffect(() => {
    if (probeRef.current) return;
    probeRef.current = true;
    void probeDismissEndpoint().then(setDismissAvailable);
  }, []);

  // Reset state when the selected session changes
  useEffect(() => {
    setBody("");
    setError(null);
    setSending(false);
    setDismissing(false);
  }, [sessionId]);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    const result = await onSend(sessionId, trimmed);
    setSending(false);
    if (result.ok) {
      setBody("");
    } else {
      setError(result.error ?? "Failed to send.");
    }
  };

  const dismiss = async () => {
    if (dismissing || dismissAvailable === false) return;
    setDismissing(true);
    setError(null);
    const result = await onDismiss(sessionId);
    setDismissing(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to archive.");
    }
  };

  const archiveButton = (
    <Tooltip content={dismissAvailable === false ? "Coming soon" : "Archive"}>
      <button
        type="button"
        className="sidebar-row-action-btn inbox-archive-btn"
        onClick={() => void dismiss()}
        disabled={dismissing || dismissAvailable === false || dismissAvailable === null}
        aria-label={dismissAvailable === false ? "Archive (coming soon)" : "Archive"}
      >
        <ArchiveIcon />
      </button>
    </Tooltip>
  );

  return (
    <div className="inbox-composer-wrap">
      {error && (
        <div className="inbox-composer-error" role="alert">
          {error}
        </div>
      )}
      <Composer
        variant="card"
        value={body}
        onChange={setBody}
        onSend={() => void send()}
        placeholder="Reply…"
        composerRef={composerRef}
        disabled={sending}
        extraActions={archiveButton}
      />
    </div>
  );
}
