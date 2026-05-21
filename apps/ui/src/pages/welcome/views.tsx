import type React from "react";
import { useState } from "react";
import { Button, ProgressList, type ProgressStep } from "@/components/ui";
import type { AccountSessionResponse, Door, SpawnStep } from "./types";

// Smaller status / outcome views grouped together. Each is a thin
// presentation slice of the WelcomePage state machine.

export function SpawningView({ steps, picked }: { steps: SpawnStep[]; picked: Door | null }) {
  const pickedLabel =
    picked === "wallet" ? "your wallet" : picked === "passkey" ? "your passkey" : "your email";
  const progressSteps: ProgressStep[] = steps.map((step) => ({
    key: step.key,
    label: step.label,
    status: step.status,
  }));
  return (
    <>
      <h1 className="auth-heading">Setting up your account.</h1>
      <p className="auth-subheading">Authenticated with {pickedLabel}. Preparing your wallet.</p>
      <ProgressList steps={progressSteps} />
    </>
  );
}

export function WelcomeView({
  outcome: _outcome,
  onContinue,
}: {
  outcome: AccountSessionResponse;
  onContinue: () => void;
}) {
  return (
    <>
      <h1 className="auth-heading">Your account is ready.</h1>
      <p className="auth-subheading">Launch a TRUST from a blueprint or join one.</p>
      <div className="auth-form">
        <Button variant="primary" size="lg" fullWidth type="button" onClick={onContinue}>
          Enter AEQI →
        </Button>
      </div>
    </>
  );
}

export function ErrorView({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <>
      <h1 className="auth-heading">That didn't work.</h1>
      <p className="auth-subheading">{message}</p>
      <Button variant="primary" size="lg" fullWidth type="button" onClick={onBack}>
        Try again
      </Button>
    </>
  );
}

/**
 * Closed-beta gate fallback. When email-start returns 403 because the
 * caller didn't carry a valid invite_code, the user lands here. POSTs
 * to /api/auth/waitlist; the backend dedupes by email, sends a
 * confirmation email with a click-to-confirm link.
 */
export function WaitlistView({
  email,
  onSubmit,
  onBack,
}: {
  email: string;
  onSubmit: (email: string) => Promise<void>;
  onBack: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(email.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className="auth-heading">aeqi is in closed beta.</h1>
      <p className="auth-subheading">
        We'll add <strong>{email}</strong> to the waitlist and email you when it's your turn.
      </p>
      <form className="auth-form waitlist-form" onSubmit={handleSubmit} autoComplete="off">
        {/* Honeypot — hidden from humans, bots fill it. */}
        <input
          type="text"
          name="_hp"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
          aria-hidden="true"
        />
        {error && <p className="auth-error">{error}</p>}
        <Button
          className="waitlist-primary"
          variant="primary"
          size="lg"
          type="submit"
          fullWidth
          disabled={submitting}
        >
          {submitting ? "Adding…" : "Add me to the waitlist"}
        </Button>
        <button className="waitlist-secondary-action" type="button" onClick={onBack}>
          Use a different method
        </button>
      </form>
    </>
  );
}

export function WaitlistSentView({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <>
      <h1 className="auth-heading">You're on the list.</h1>
      <p className="auth-subheading">
        Check <strong>{email}</strong> for a confirmation link. We'll email you when an invite opens
        up.
      </p>
      <Button variant="secondary" size="lg" fullWidth type="button" onClick={onBack}>
        Done
      </Button>
    </>
  );
}
