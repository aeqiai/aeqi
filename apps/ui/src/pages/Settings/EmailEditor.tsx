import { useState } from "react";
import { apiRequest } from "@/api/client";
import { Button, Input } from "@/components/ui";

interface Props {
  currentEmail: string;
  onChanged: (newEmail: string) => void;
}

/**
 * Two-step email-change ceremony. Stays inline inside ProfilePanel — first
 * click reveals a "new email" input, submit POSTs /me/email/change/begin,
 * the server emails a code, the second step POSTs /me/email/change/finish
 * with that code and we update the parent's email field on success.
 *
 * Synthetic addresses (`wallet+xxx@aeqi.ai`, `passkey+xxx@aeqi.ai`)
 * generated for wallet/passkey-only signups flow through this editor.
 *
 * Uses the canonical `.account-field-row` flex pattern from SecurityPanel
 * for "input + action button" so styling matches the rest of Settings —
 * no inline styles, no per-screen CSS forks.
 */
export default function EmailEditor({ currentEmail, onChanged }: Props) {
  const [step, setStep] = useState<"display" | "input" | "verify">("display");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSynthetic = currentEmail.startsWith("wallet+") || currentEmail.startsWith("passkey+");

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest<{ ok: boolean }>("/me/email/change/begin", {
        method: "POST",
        body: JSON.stringify({
          new_email: newEmail.trim(),
        }),
      });
      setStep("verify");
      setFeedback(`Verification code sent to ${newEmail.trim()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: boolean; email: string }>("/me/email/change/finish", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
        }),
      });
      onChanged(res.email);
      setFeedback("Email updated.");
      setStep("display");
      setNewEmail("");
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  if (step === "display") {
    return (
      <div className="account-field-row">
        <Input id="account-email" size="lg" type="email" value={currentEmail} disabled />
        <Button
          variant="secondary"
          size="lg"
          type="button"
          onClick={() => {
            setStep("input");
            setFeedback(null);
          }}
        >
          {isSynthetic ? "Set real email" : "Change"}
        </Button>
      </div>
    );
  }

  if (step === "input") {
    return (
      <>
        <div className="account-field-row">
          <Input
            size="lg"
            type="email"
            placeholder="new@example.com"
            autoFocus
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={busy}
          />
          <Button
            variant="primary"
            size="lg"
            type="button"
            onClick={begin}
            loading={busy}
            disabled={!newEmail.includes("@")}
          >
            Send code
          </Button>
          <Button variant="secondary" size="lg" type="button" onClick={() => setStep("display")}>
            Cancel
          </Button>
        </div>
        {error && <div className="auth-error">{error}</div>}
      </>
    );
  }

  return (
    <>
      <p className="account-field-desc">{feedback}</p>
      <div className="account-field-row">
        <Input
          size="lg"
          type="text"
          placeholder="6-digit code"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
          maxLength={6}
        />
        <Button
          variant="primary"
          size="lg"
          type="button"
          onClick={finish}
          loading={busy}
          disabled={code.length < 6}
        >
          Verify
        </Button>
        <Button variant="ghost" size="lg" type="button" onClick={() => setStep("display")}>
          Cancel
        </Button>
      </div>
      {error && <div className="auth-error">{error}</div>}
    </>
  );
}
