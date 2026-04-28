import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui";

const BASE_URL = "/api";

async function authedJson<T>(path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem("aeqi_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg = (typeof data?.error === "string" ? data.error : null) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

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
      const begin = await authedJson<BeginResponse>("/me/passkeys/add/begin");
      const credential = await startRegistration({ optionsJSON: begin.publicKey });
      await authedJson<{ ok: boolean }>("/me/passkeys/add/finish", {
        session_id: begin.session_id,
        credential,
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
