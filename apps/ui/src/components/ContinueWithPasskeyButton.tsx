import { useState } from "react";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import AuthIconSlot from "@/components/AuthIconSlot";
import { loginOrRegisterWithPasskey } from "@/lib/passkeyAuth";

interface Props {
  onAuthenticated?: () => void;
}

/**
 * One-click "Continue with Passkey" — same shape as the OAuth and Wallet
 * buttons. Click triggers the WebAuthn ceremony (Touch ID / Face ID /
 * security key); on success the JWT goes through handleOAuthCallback so
 * the rest of the app behaves identically to a Google / GitHub login.
 */
export default function ContinueWithPasskeyButton({ onAuthenticated }: Props) {
  const handleOAuthCallback = useAuthStore((s) => s.handleOAuthCallback);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await loginOrRegisterWithPasskey();
      if (!res.ok || !res.token) throw new Error("auth response missing token");
      handleOAuthCallback(res.token);
      onAuthenticated?.();
    } catch (err) {
      const name = (err as { name?: string }).name;
      // User-dismissed prompts shouldn't show as errors.
      if (name === "NotAllowedError" || name === "AbortError") {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="lg" fullWidth type="button" onClick={go} disabled={busy}>
        <AuthIconSlot />
        {busy ? "Verifying…" : "Continue with Passkey"}
      </Button>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
