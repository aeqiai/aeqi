import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";

type Feedback = { type: "success" | "error"; msg: string } | null;
type ActivityRow = { action: string; detail?: string; ip?: string; created_at: string };

const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="var(--success)"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
  </svg>
);
const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);
const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
);

function formatActivityAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "";
  }
}

/**
 * Settings → Security tab. TOTP setup, email phishing phrase, password
 * change link, OAuth provider connections, danger zone, activity log.
 *
 * Each subsection owns its own narrow state — TOTP setup state is
 * unrelated to the activity log fetch, etc. Splitting them further
 * inside this file (one component per subsection) is the next move
 * once any of them grow.
 */
export default function SecurityPanel() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const [provider, setProvider] = useState<string>("local");

  // Phishing phrase
  const [phishingCode, setPhishingCode] = useState("");
  const [phishingSaving, setPhishingSaving] = useState(false);
  const [phishingFeedback, setPhishingFeedback] = useState<Feedback>(null);

  // TOTP
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpFeedback, setTotpFeedback] = useState<Feedback>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  // Activity log
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        const u = data as Record<string, unknown>;
        if (typeof u.phishing_code === "string") setPhishingCode(u.phishing_code);
        if (typeof u.provider === "string") setProvider(u.provider);
      })
      .catch(() => {});
    api
      .getActivity()
      .then((data: Record<string, unknown>) => {
        const events = (data as { events?: ActivityRow[] }).events;
        if (Array.isArray(events)) setActivity(events);
      })
      .catch(() => {});
  }, []);

  const handlePhishingSave = async () => {
    setPhishingFeedback(null);
    if (phishingCode.length < 3 || phishingCode.length > 100) {
      setPhishingFeedback({ type: "error", msg: "Phrase must be 3-100 characters." });
      return;
    }
    setPhishingSaving(true);
    try {
      await api.updatePhishingCode(phishingCode);
      setPhishingFeedback({ type: "success", msg: "Security phrase updated." });
      setTimeout(() => setPhishingFeedback(null), 3000);
    } catch (e: unknown) {
      setPhishingFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to update security phrase.",
      });
    } finally {
      setPhishingSaving(false);
    }
  };

  const startTotpSetup = async () => {
    try {
      const res = await api.setupTotp();
      const data = res as { secret?: string; uri?: string };
      if (data.secret && data.uri) setTotpSetup({ secret: data.secret, uri: data.uri });
    } catch {
      setTotpFeedback({ type: "error", msg: "Failed to start authenticator setup." });
    }
  };

  const verifyTotp = async () => {
    setTotpLoading(true);
    try {
      const res = await api.verifyTotp(totpCode);
      setTotpEnabled(true);
      setTotpBackupCodes((res as { backup_codes?: string[] }).backup_codes || []);
      setTotpSetup(null);
      setTotpCode("");
      setTotpFeedback({ type: "success", msg: "Authenticator enabled!" });
    } catch {
      setTotpFeedback({ type: "error", msg: "Invalid code. Try again." });
    } finally {
      setTotpLoading(false);
    }
  };

  const disableTotp = async () => {
    const pw = window.prompt("Enter your password to disable TOTP");
    const code = window.prompt("Enter your authenticator code");
    if (!pw || !code) return;
    try {
      await api.disableTotp(pw, code);
      setTotpEnabled(false);
      setTotpSetup(null);
      setTotpFeedback({ type: "success", msg: "Authenticator disabled." });
    } catch {
      setTotpFeedback({ type: "error", msg: "Failed to disable authenticator." });
    }
  };

  const handleDeleteAccount = () => {
    if (
      !window.confirm(
        "Are you sure? This will permanently delete your account, all agents you own, and all data. This cannot be undone.",
      )
    )
      return;
    if (window.prompt("Type DELETE to confirm") !== "DELETE") return;
    api
      .deleteAccount()
      .then(() => {
        logout();
        navigate("/login");
      })
      .catch(() => {});
  };

  return (
    <>
      <div className="account-field-lg">
        <label className="account-field-label">Two-factor authentication</label>
        {totpEnabled ? (
          <div className="account-totp-status">
            <div className="account-status-dot" aria-hidden="true" />
            <span className="account-totp-status-text">Authenticator app enabled</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="account-totp-disable-btn"
              onClick={disableTotp}
            >
              Disable
            </Button>
          </div>
        ) : totpSetup ? (
          <div>
            <p className="account-field-desc">
              Scan this QR code with your authenticator app, then enter the 6-digit code to verify.
            </p>
            <div className="account-qr-container">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpSetup.uri)}`}
                alt="QR code for authenticator setup"
                width={200}
                height={200}
              />
            </div>
            <p className="account-manual-entry">
              Manual entry: <code>{totpSetup.secret}</code>
            </p>
            <div className="account-field-row">
              <Input
                size="lg"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value.replace(/\D/g, ""));
                  setTotpFeedback(null);
                }}
                placeholder="6-digit code"
                aria-label="Authenticator code"
                className="account-totp-input"
              />
              <Button
                type="button"
                variant="primary"
                loading={totpLoading}
                disabled={totpLoading || totpCode.length !== 6}
                onClick={verifyTotp}
              >
                Verify
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="account-field-desc">
              Add an authenticator app for stronger login security. When enabled, you'll enter an
              app code instead of an email code.
            </p>
            <Button type="button" variant="primary" onClick={startTotpSetup}>
              Set up authenticator
            </Button>
          </div>
        )}
        {totpBackupCodes.length > 0 && (
          <div className="account-backup-codes">
            <label className="account-field-label account-backup-codes-label">
              Backup codes -- save these now
            </label>
            <p className="account-field-desc">
              Each code can only be used once. Store them somewhere safe.
            </p>
            <div className="account-backup-codes-grid">
              {totpBackupCodes.map((c) => (
                <code key={c} className="account-backup-code">
                  {c}
                </code>
              ))}
            </div>
          </div>
        )}
        {totpFeedback && (
          <div
            className={`account-feedback account-feedback-${totpFeedback.type}`}
            role="status"
            aria-live="polite"
          >
            {totpFeedback.msg}
          </div>
        )}
      </div>

      <div className="account-field-lg">
        <label className="account-field-label" htmlFor="account-phishing-code">
          Email security phrase
        </label>
        <p className="account-field-desc">
          A personal phrase included in every email from AEQI. If the phrase is missing, the email
          isn't from us.
        </p>
        <div className="account-field-row">
          <Input
            id="account-phishing-code"
            size="lg"
            type="text"
            value={phishingCode}
            onChange={(e) => {
              setPhishingCode(e.target.value);
              setPhishingFeedback(null);
            }}
            placeholder="e.g., blue ocean 42"
            maxLength={100}
          />
          <Button
            type="button"
            variant="primary"
            onClick={handlePhishingSave}
            loading={phishingSaving}
            disabled={phishingSaving}
          >
            Save
          </Button>
        </div>
        {phishingFeedback && (
          <div
            className={`account-feedback account-feedback-${phishingFeedback.type}`}
            role="status"
            aria-live="polite"
          >
            {phishingFeedback.msg}
          </div>
        )}
      </div>

      <div className="account-field-lg">
        <label className="account-field-label">Password</label>
        <p className="account-field-desc">
          Change your password on a dedicated page. We'll ask for your current one first.
        </p>
        <Link to="/change-password" className="account-action-link">
          Change password →
        </Link>
      </div>

      <div className="account-field-lg">
        <label className="account-field-label">Connected accounts</label>
        <div className="account-connected-list">
          {provider === "google" ? (
            <div className="account-connected-item account-connected-active">
              <GoogleIcon />
              <span>Connected with Google</span>
              <CheckIcon />
            </div>
          ) : (
            <Button
              variant="secondary"
              className="account-connect-btn"
              onClick={() => {
                window.location.href = "/api/auth/google";
              }}
            >
              <GoogleIcon /> Connect Google
            </Button>
          )}
          {provider === "github" ? (
            <div className="account-connected-item account-connected-active">
              <GitHubIcon />
              <span>Connected with GitHub</span>
              <CheckIcon />
            </div>
          ) : (
            <Button
              variant="secondary"
              className="account-connect-btn"
              onClick={() => {
                window.location.href = "/api/auth/github";
              }}
            >
              <GitHubIcon /> Connect GitHub
            </Button>
          )}
        </div>
      </div>

      <div className="account-danger-zone">
        <label className="account-field-label account-danger-label">Danger zone</label>
        <p className="account-field-desc">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <Button variant="danger" className="account-danger-btn" onClick={handleDeleteAccount}>
          Delete account
        </Button>
      </div>

      <div className="account-activity-section">
        <label className="account-field-label">Activity log</label>
        <p className="account-field-desc account-activity-desc">
          Recent security events on your account.
        </p>
        {activity.length === 0 ? (
          <div className="account-activity-empty">No activity recorded yet.</div>
        ) : (
          <div className="account-activity-list">
            {activity.slice(0, 20).map((event, i) => {
              const isError = event.action.includes("failed") || event.action.includes("error");
              return (
                <div key={i} className="account-activity-item">
                  <div
                    className={`account-activity-dot ${isError ? "account-activity-dot--error" : "account-activity-dot--success"}`}
                    aria-hidden="true"
                  />
                  <div className="account-activity-body">
                    <span className="account-activity-action">
                      {event.action.replace(/_/g, " ")}
                    </span>
                    {event.detail && (
                      <span className="account-activity-detail">{event.detail}</span>
                    )}
                  </div>
                  {event.ip && <span className="account-activity-meta">{event.ip}</span>}
                  <span className="account-activity-time">
                    {formatActivityAgo(event.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
