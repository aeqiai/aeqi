import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
);

export default function SettingsPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [health, setHealth] = useState<any>(null);

  // User data
  const [user, setUser] = useState<Record<string, unknown> | null>(null);

  // Phishing code
  const [phishingCode, setPhishingCode] = useState("");
  const [phishingSaving, setPhishingSaving] = useState(false);
  const [phishingSuccess, setPhishingSuccess] = useState(false);
  const [phishingError, setPhishingError] = useState("");

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => {});
    api.getMe().then((data) => {
      setUser(data);
      if (typeof data.phishing_code === "string") {
        setPhishingCode(data.phishing_code as string);
      }
    }).catch(() => {});
  }, []);

  const handlePhishingSave = async () => {
    setPhishingError("");
    setPhishingSuccess(false);
    if (phishingCode.length < 3 || phishingCode.length > 100) {
      setPhishingError("Phrase must be between 3 and 100 characters");
      return;
    }
    setPhishingSaving(true);
    try {
      await api.updatePhishingCode(phishingCode);
      setPhishingSuccess(true);
      setTimeout(() => setPhishingSuccess(false), 3000);
    } catch (e: unknown) {
      setPhishingError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setPhishingSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (e: unknown) {
      setPasswordError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSignOut = () => {
    logout();
    navigate("/login");
  };

  const provider = (user?.provider as string) || "local";

  return (
    <>
      <Header title="Settings" />

      <div className="settings-grid">
        {/* Daemon Connection */}
        <div className="settings-section">
          <h3 className="settings-section-title">Daemon Connection</h3>
          <div className="detail-field">
            <div className="detail-field-label">Status</div>
            <div className="detail-field-value">
              {health?.ok ? (
                <span style={{ color: "var(--success)" }}>Connected</span>
              ) : (
                <span style={{ color: "var(--error)" }}>Disconnected</span>
              )}
            </div>
          </div>
          <div className="detail-field">
            <div className="detail-field-label">API URL</div>
            <div className="detail-field-value">
              <code>{import.meta.env.VITE_API_URL || "/api (proxied)"}</code>
            </div>
          </div>
        </div>

        {/* Security Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">Security</h3>

          {/* Phishing Code */}
          <div className="settings-field">
            <label className="settings-field-label">Email Security Phrase</label>
            <p className="settings-field-desc">
              Set a personal phrase that appears in every email from AEQI. If an email doesn't include your phrase, it's not from us.
            </p>
            <div className="settings-field-row">
              <input
                className="auth-input"
                type="text"
                value={phishingCode}
                onChange={(e) => {
                  setPhishingCode(e.target.value);
                  setPhishingError("");
                  setPhishingSuccess(false);
                }}
                placeholder="Enter your security phrase"
                maxLength={100}
              />
              <button
                className="btn btn-primary"
                onClick={handlePhishingSave}
                disabled={phishingSaving}
              >
                {phishingSaving ? "Saving..." : "Save"}
              </button>
            </div>
            {phishingError && (
              <div className="settings-feedback settings-feedback-error">{phishingError}</div>
            )}
            {phishingSuccess && (
              <div className="settings-feedback settings-feedback-success">Security phrase updated</div>
            )}
          </div>

          {/* Divider */}
          <div className="settings-divider" />

          {/* Change Password */}
          <div className="settings-field">
            <label className="settings-field-label">Change Password</label>
            <form className="settings-password-form" onSubmit={handlePasswordChange}>
              <div className="auth-password-wrap">
                <input
                  className="auth-input auth-input-password"
                  type={showCurrentPw ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setPasswordError("");
                  }}
                  placeholder="Current password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                  tabIndex={-1}
                  aria-label={showCurrentPw ? "Hide password" : "Show password"}
                >
                  <EyeIcon visible={showCurrentPw} />
                </button>
              </div>
              <div className="auth-password-wrap">
                <input
                  className="auth-input auth-input-password"
                  type={showNewPw ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPasswordError("");
                  }}
                  placeholder="New password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowNewPw(!showNewPw)}
                  tabIndex={-1}
                  aria-label={showNewPw ? "Hide password" : "Show password"}
                >
                  <EyeIcon visible={showNewPw} />
                </button>
              </div>
              <div className="auth-password-wrap">
                <input
                  className="auth-input auth-input-password"
                  type={showConfirmPw ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPasswordError("");
                  }}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowConfirmPw(!showConfirmPw)}
                  tabIndex={-1}
                  aria-label={showConfirmPw ? "Hide password" : "Show password"}
                >
                  <EyeIcon visible={showConfirmPw} />
                </button>
              </div>
              {passwordError && (
                <div className="settings-feedback settings-feedback-error">{passwordError}</div>
              )}
              {passwordSuccess && (
                <div className="settings-feedback settings-feedback-success">Password updated successfully</div>
              )}
              <button
                className="btn btn-primary"
                type="submit"
                disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
              >
                {passwordSaving ? "Updating..." : "Update password"}
              </button>
            </form>
          </div>

          {/* Divider */}
          <div className="settings-divider" />

          {/* Connected Accounts */}
          <div className="settings-field">
            <label className="settings-field-label">Connected Accounts</label>
            <div className="settings-connected-list">
              {provider === "google" ? (
                <div className="settings-connected-item settings-connected-active">
                  <GoogleIcon />
                  <span>Connected with Google</span>
                  <CheckIcon />
                </div>
              ) : (
                <button
                  className="btn settings-connect-btn"
                  onClick={() => { window.location.href = "/api/auth/google"; }}
                >
                  <GoogleIcon />
                  Connect Google
                </button>
              )}
              {provider === "github" ? (
                <div className="settings-connected-item settings-connected-active">
                  <GitHubIcon />
                  <span>Connected with GitHub</span>
                  <CheckIcon />
                </div>
              ) : (
                <button
                  className="btn settings-connect-btn"
                  onClick={() => { window.location.href = "/api/auth/github"; }}
                >
                  <GitHubIcon />
                  Connect GitHub
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <div className="settings-section">
          <h3 className="settings-section-title">Session</h3>
          <button className="btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}

/* Inline EyeIcon that accepts visible prop */
function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 3.8A6.4 6.4 0 018 3.5c4 0 6.5 4.5 6.5 4.5a10.7 10.7 0 01-1.3 1.7M9.4 9.4A2 2 0 016.6 6.6" />
        <path d="M1.5 8s1.2-2.2 3.2-3.5M1 1l14 14" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}
