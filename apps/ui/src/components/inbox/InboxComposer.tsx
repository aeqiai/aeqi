import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui";
import Composer from "@/components/composer/Composer";
import { probeDismissEndpoint } from "@/store/inbox";

export interface InboxComposerProps {
  sessionId: string;
  /** Display name of the agent on the other side of the thread; drives the
   * `Message <name>…` placeholder so the inbox reads identical to the agent
   * session surface. Falls back to "agent" when absent. */
  agentName?: string;
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
  agentName,
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

  // Attachment state — kept local so the visual chrome (chips above the
  // input) renders identically to the agent surface. The reply flow
  // currently sends body-text only; attach chips are surfaced for parity
  // and will wire into the answer payload once the inbox-answer IPC
  // grows attachment slots.
  const [attachedIdeas, setAttachedIdeas] = useState<string[]>([]);
  const [attachedQuest, setAttachedQuest] = useState<{ id: string; name: string } | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<
    { name: string; content: string; size: number }[]
  >([]);

  const readFiles = useCallback((fl: FileList | File[]) => {
    Array.from(fl).forEach((file) => {
      if (file.size > 512_000) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setAttachedFiles((prev) => {
          if (prev.some((f) => f.name === file.name)) return prev;
          return [...prev, { name: file.name, content, size: file.size }];
        });
      };
      reader.readAsText(file);
    });
  }, []);

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
    setAttachedIdeas([]);
    setAttachedQuest(null);
    setAttachedFiles([]);
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
      setAttachedIdeas([]);
      setAttachedQuest(null);
      setAttachedFiles([]);
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
        placeholder={`Message ${agentName || "agent"}…`}
        composerRef={composerRef}
        disabled={sending}
        attachmentTypes={["idea", "quest", "file"]}
        attachedIdeas={attachedIdeas}
        setAttachedIdeas={setAttachedIdeas}
        attachedQuest={attachedQuest}
        setAttachedQuest={setAttachedQuest}
        attachedFiles={attachedFiles}
        setAttachedFiles={setAttachedFiles}
        // Picker mounts on the drilled-agent surface (AgentSessionView)
        // and listens for `aeqi:open-attach-picker`. Inbox dispatches the
        // same event so the visual affordance stays identical; the inbox
        // surface itself doesn't host a picker today, so the click is a
        // no-op here. Wired this way so a future inbox-side picker can
        // attach without changing the composer config.
        onAttachClick={(kind) => {
          window.dispatchEvent(new CustomEvent("aeqi:open-attach-picker", { detail: { kind } }));
        }}
        onReadFiles={readFiles}
        extraActions={archiveButton}
      />
    </div>
  );
}
