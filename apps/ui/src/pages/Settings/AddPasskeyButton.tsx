import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { apiRequest } from "@/api/client";
import { Button } from "@/components/ui";

interface BeginResponse {
  ok: boolean;
  session_id: string;
  publicKey: PublicKeyCredentialCreationOptionsJSON;
}

/**
 * Settings → Security button that adds a passkey to the *current* account
 * (vs the public /signup ceremony which creates a new account). Hits the
 * authenticated /api/me/passkeys/add/{begin,finish} pair.
 */
export default function AddPasskeyButton() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const begin = await apiRequest<BeginResponse>("/me/passkeys/add/begin", {
        method: "POST",
        body: "{}",
      });
      const credential = await startRegistration({ optionsJSON: begin.publicKey });
      await apiRequest<{ ok: boolean }>("/me/passkeys/add/finish", {
        method: "POST",
        body: JSON.stringify({
          session_id: begin.session_id,
          credential,
        }),
      });
      setFeedback("Passkey added.");
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "NotAllowedError" || name === "AbortError") {
        // User dismissed the prompt — silent.
      } else {
        setError(e instanceof Error ? e.message : "Failed to add passkey");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="secondary" size="md" type="button" onClick={add} loading={busy}>
        Add a passkey
      </Button>
      {feedback && <p className="account-field-desc">{feedback}</p>}
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
