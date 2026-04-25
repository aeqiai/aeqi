import { useEffect, useRef, useState } from "react";
import type { IntegrationCatalogEntry } from "@/api/integrations";
import { integrationsApi } from "@/api/integrations";
import { Button } from "./ui";

interface ConnectIntegrationModalProps {
  open: boolean;
  entry: IntegrationCatalogEntry | null;
  /** Scope to connect under. */
  scope: { scope_kind: string; scope_id: string };
  onClose: () => void;
  /** Fired once the bootstrap completes successfully. */
  onConnected: () => void;
}

type Phase = "idle" | "starting" | "awaiting" | "complete" | "failed";

/**
 * Modal that drives the OAuth bootstrap loop:
 *
 *  1. POST /credentials/bootstrap → receive {handle, authorize_url}
 *  2. Open the authorize URL in a new tab.
 *  3. Poll GET /credentials/bootstrap/{handle} every 1.5s.
 *  4. On `complete`, fire `onConnected()` and close.
 *
 * The new-tab UX (vs full-page redirect) means the dashboard never loses
 * its state — the user comes back to a refreshed integrations list. The
 * loopback callback runs server-side and emits a tiny success page.
 */
export function ConnectIntegrationModal({
  open,
  entry,
  scope,
  onClose,
  onConnected,
}: ConnectIntegrationModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open || !entry) {
      setPhase("idle");
      setAuthorizeUrl(null);
      setError(null);
      handleRef.current = null;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
      return;
    }

    let cancelled = false;
    setPhase("starting");
    setError(null);

    integrationsApi
      .bootstrap({
        provider: entry.provider,
        scope_kind: scope.scope_kind,
        scope_id: scope.scope_id,
      })
      .then((res) => {
        if (cancelled) return;
        handleRef.current = res.handle;
        setAuthorizeUrl(res.authorize_url);
        setPhase("awaiting");
        // Open the consent URL in a new tab. Pop-up blockers may stop
        // this — the manual "Open consent" button is the fallback.
        try {
          window.open(res.authorize_url, "_blank", "noopener,noreferrer");
        } catch {
          // ignore; user can click the manual link
        }
        pollTimer.current = setInterval(async () => {
          if (!handleRef.current) return;
          try {
            const status = await integrationsApi.bootstrapStatus(handleRef.current);
            if (status.status === "complete") {
              if (pollTimer.current) clearInterval(pollTimer.current);
              setPhase("complete");
              onConnected();
            } else if (status.status === "failed" || status.status === "expired") {
              if (pollTimer.current) clearInterval(pollTimer.current);
              setPhase("failed");
              setError(status.error || "OAuth flow did not complete.");
            }
          } catch (e: unknown) {
            // Transient errors are fine — the polling continues. Only
            // surface a hard error once the handle expires (handled above).
            console.warn("bootstrap status poll failed", e);
          }
        }, 1500);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPhase("failed");
        setError(e instanceof Error ? e.message : "Failed to start OAuth flow.");
      });

    return () => {
      cancelled = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [open, entry, scope.scope_kind, scope.scope_id, onConnected]);

  if (!open || !entry) return null;

  return (
    <div
      className="integration-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="integration-modal-card">
        <header className="integration-modal-head">
          <h2 id="connect-modal-title" className="integration-modal-title">
            Connect {entry.label}
          </h2>
          <button
            type="button"
            className="integration-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="integration-modal-body">
          {phase === "starting" && (
            <p className="integration-modal-status">Preparing consent flow…</p>
          )}

          {phase === "awaiting" && (
            <>
              <p className="integration-modal-status">
                A new tab should have opened with {entry.label}'s consent screen. After approving,
                this dialog will pick up the connection automatically.
              </p>
              {authorizeUrl && (
                <p className="integration-modal-fallback">
                  Tab didn't open?{" "}
                  <a href={authorizeUrl} target="_blank" rel="noopener noreferrer">
                    Open consent screen
                  </a>
                  .
                </p>
              )}
              <p className="integration-modal-scope">
                Connecting under scope:{" "}
                <code>
                  {scope.scope_kind}
                  {scope.scope_id ? ` / ${scope.scope_id}` : ""}
                </code>
              </p>
            </>
          )}

          {phase === "complete" && (
            <p className="integration-modal-status integration-modal-status--ok">
              Connected to {entry.label}. You can close this dialog.
            </p>
          )}

          {phase === "failed" && (
            <p className="integration-modal-status integration-modal-status--error">
              {error || "Connection failed."}
            </p>
          )}
        </div>

        <footer className="integration-modal-foot">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {phase === "complete" ? "Done" : "Cancel"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
