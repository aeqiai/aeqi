import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthMobileNav from "@/components/AuthMobileNav";
import Wordmark from "@/components/Wordmark";
import { Button, Input } from "@/components/ui";
import { api } from "@/lib/api";

/**
 * Self-host secret-mode login. The operator pasted their `auth_secret` from
 * `aeqi setup` (printed at first run, also in `~/.aeqi/aeqi.toml` under
 * `[web].auth_secret`). One input → POST /api/auth/login → JWT → into the app.
 */
export default function SecretLogin() {
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const resp = await api.login(secret.trim());
      if (!resp.ok || !resp.token) {
        setErrorMsg("Invalid secret. Check `~/.aeqi/aeqi.toml` for `auth_secret`.");
        setSubmitting(false);
        return;
      }
      localStorage.setItem("aeqi_token", resp.token);
      localStorage.setItem("aeqi_app_mode", "runtime");
      localStorage.setItem("aeqi_auth_mode", "secret");
      navigate("/", { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Login failed.");
      setSubmitting(false);
    }
  }

  return (
    <main className="signup-split">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <AuthMobileNav ariaLabel="Authentication navigation" />
      <div className="signup-form-side" id="main-content">
        <div className="auth-container" role="region" aria-live="polite">
          <div className="auth-logo">
            <Wordmark size={36} />
          </div>
          <h1 className="auth-title">Welcome back.</h1>
          <p className="auth-subtitle">Self-hosted aeqi. Paste your dashboard secret to sign in.</p>
          <form onSubmit={handleSubmit} style={{ marginTop: "var(--space-6)" }}>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="dashboard secret"
              autoFocus
              autoComplete="current-password"
              disabled={submitting}
              aria-label="dashboard secret"
            />
            {errorMsg && (
              <p
                style={{
                  marginTop: "var(--space-3)",
                  color: "var(--color-error)",
                  fontSize: "var(--font-size-sm)",
                }}
              >
                {errorMsg}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={!secret.trim() || submitting}
              style={{ marginTop: "var(--space-4)", width: "100%" }}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p
            style={{
              marginTop: "var(--space-6)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-xs)",
            }}
          >
            Find your secret with: <code>grep auth_secret ~/.aeqi/aeqi.toml</code>
          </p>
        </div>
      </div>
      <div className="signup-pitch-side" aria-hidden />
    </main>
  );
}
