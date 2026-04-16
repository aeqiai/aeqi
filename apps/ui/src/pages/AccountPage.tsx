import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import RoundAvatar from "@/components/RoundAvatar";
import PageTabs, { useActiveTab } from "@/components/PageTabs";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "api", label: "API" },
  { id: "invites", label: "Invites" },
  { id: "preferences", label: "Preferences" },
];

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible)
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      >
        <path d="M6.5 3.8A6.4 6.4 0 018 3.5c4 0 6.5 4.5 6.5 4.5a10.7 10.7 0 01-1.3 1.7M9.4 9.4A2 2 0 016.6 6.6" />
        <path d="M1.5 8s1.2-2.2 3.2-3.5M1 1l14 14" />
      </svg>
    );
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

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

export default function AccountPage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const authMode = useAuthStore((s) => s.authMode);
  const activeTab = useActiveTab(TABS, "profile");

  const [user, setUser] = useState<Record<string, unknown> | null>(null);

  // Profile state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  // Security state
  const [phishingCode, setPhishingCode] = useState("");
  const [phishingSaving, setPhishingSaving] = useState(false);
  const [phishingFeedback, setPhishingFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // TOTP state
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpFeedback, setTotpFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  // Activity state
  const [activity, setActivity] = useState<
    Array<{ action: string; detail?: string; ip?: string; created_at: string }>
  >([]);

  // Invites state
  const [inviteCodes, setInviteCodes] = useState<Array<{ code: string; used: boolean }>>([]);
  const [copiedCode, setCopiedCode] = useState("");

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        setUser(data);
        const name = (data.name as string) || "";
        const parts = name.split(/\s+/);
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" ") || "");
        if (typeof data.phishing_code === "string") setPhishingCode(data.phishing_code as string);
        if (typeof data.phone === "string") setPhone(data.phone as string);
      })
      .catch(() => {});
    api
      .getInviteCodes()
      .then((data: Record<string, unknown>) => {
        const codes = (data as { codes?: Array<{ code: string; used: boolean }> }).codes;
        if (Array.isArray(codes)) setInviteCodes(codes);
      })
      .catch(() => {});
    api
      .getActivity()
      .then((data: Record<string, unknown>) => {
        const events = (
          data as {
            events?: Array<{ action: string; detail?: string; ip?: string; created_at: string }>;
          }
        ).events;
        if (Array.isArray(events)) setActivity(events);
      })
      .catch(() => {});
  }, []);

  const handleProfileSave = async () => {
    setProfileFeedback(null);
    if (!firstName.trim()) {
      setProfileFeedback({ type: "error", msg: "First name is required." });
      return;
    }
    setProfileSaving(true);
    try {
      await api.updateProfile(firstName.trim(), lastName.trim(), phone.trim());
      setProfileFeedback({ type: "success", msg: "Profile updated." });
      setTimeout(() => setProfileFeedback(null), 3000);
    } catch (e: unknown) {
      setProfileFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to update profile.",
      });
    } finally {
      setProfileSaving(false);
    }
  };

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

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);
    if (newPassword.length < 8) {
      setPasswordFeedback({ type: "error", msg: "Password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: "error", msg: "Passwords don't match." });
      return;
    }
    setPasswordSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordFeedback({ type: "success", msg: "Password updated." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordFeedback(null), 3000);
    } catch (e: unknown) {
      setPasswordFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Password change failed.",
      });
    } finally {
      setPasswordSaving(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(""), 2000);
  };

  const provider = (user?.provider as string) || "local";
  const displayName = `${firstName} ${lastName}`.trim() || "Account";
  const email = (user?.email as string) || "";

  return (
    <>
      <PageTabs tabs={TABS} defaultTab="profile" />
      <div className="account-page">
        {activeTab === "profile" && (
          <>
            <div className="account-profile-header">
              <label className="account-avatar-label" aria-label="Change avatar">
                {user?.avatar_url ? (
                  <img src={user.avatar_url as string} alt="" className="account-avatar-img" />
                ) : (
                  <RoundAvatar name={displayName} size={48} />
                )}
                <div className="account-avatar-badge" aria-hidden="true">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M6 2.5v7M2.5 6h7" />
                  </svg>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="account-hidden-input"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      setProfileFeedback({ type: "error", msg: "Image must be under 2 MB." });
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = async () => {
                      try {
                        await api.updateAvatar(reader.result as string);
                        setUser((prev) =>
                          prev ? { ...prev, avatar_url: reader.result as string } : prev,
                        );
                        setProfileFeedback({ type: "success", msg: "Avatar updated." });
                        setTimeout(() => setProfileFeedback(null), 3000);
                      } catch (err: unknown) {
                        setProfileFeedback({
                          type: "error",
                          msg: err instanceof Error ? err.message : "Upload failed.",
                        });
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <div>
                <div className="account-profile-name">{displayName}</div>
                <div className="account-profile-email">{email}</div>
              </div>
            </div>

            <div className="account-name-grid">
              <div>
                <label className="account-field-label" htmlFor="account-first-name">
                  First name
                </label>
                <input
                  id="account-first-name"
                  className="auth-input"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="account-field-label" htmlFor="account-last-name">
                  Last name
                </label>
                <input
                  id="account-last-name"
                  className="auth-input"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div className="account-field-sm">
              <label className="account-field-label" htmlFor="account-email">
                Email
              </label>
              <input
                id="account-email"
                className="auth-input account-disabled-input"
                type="email"
                value={email}
                disabled
              />
            </div>

            <div className="account-field-md">
              <label className="account-field-label" htmlFor="account-phone">
                Phone
              </label>
              <input
                id="account-phone"
                className="auth-input"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                autoComplete="tel"
              />
              <p className="account-field-desc">
                Optional. Used for SMS verification in the future.
              </p>
            </div>

            {/* KYC */}
            <div className="account-kyc-card">
              <div className="account-kyc-row">
                <div>
                  <label className="account-field-label">Identity verification</label>
                  <p className="account-field-desc">
                    Required for incorporation, equity issuance, and marketplace access.
                  </p>
                </div>
                <span className="account-badge-coming-soon">Coming soon</span>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleProfileSave}
              disabled={profileSaving}
            >
              {profileSaving ? "Saving..." : "Save"}
            </button>
            {profileFeedback && (
              <div
                className={`account-feedback account-feedback-${profileFeedback.type}`}
                role="status"
                aria-live="polite"
              >
                {profileFeedback.msg}
              </div>
            )}

            {authMode !== "none" && (
              <>
                <div className="account-divider" />
                <button
                  type="button"
                  className="btn account-sign-out-btn"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  Sign out
                </button>
              </>
            )}
          </>
        )}

        {activeTab === "security" && (
          <>
            {/* Two-Factor Authentication */}
            <div className="account-field-lg">
              <label className="account-field-label">Two-factor authentication</label>
              {totpEnabled ? (
                <div className="account-totp-status">
                  <div className="account-status-dot" aria-hidden="true" />
                  <span className="account-totp-status-text">Authenticator app enabled</span>
                  <button
                    type="button"
                    className="btn account-totp-disable-btn"
                    onClick={async () => {
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
                    }}
                  >
                    Disable
                  </button>
                </div>
              ) : totpSetup ? (
                <div>
                  <p className="account-field-desc">
                    Scan this QR code with your authenticator app, then enter the 6-digit code to
                    verify.
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
                    <input
                      className="auth-input account-totp-input"
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
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={totpLoading || totpCode.length !== 6}
                      onClick={async () => {
                        setTotpLoading(true);
                        try {
                          const res = await api.verifyTotp(totpCode);
                          setTotpEnabled(true);
                          setTotpBackupCodes(
                            (res as { backup_codes?: string[] }).backup_codes || [],
                          );
                          setTotpSetup(null);
                          setTotpCode("");
                          setTotpFeedback({ type: "success", msg: "Authenticator enabled!" });
                        } catch {
                          setTotpFeedback({ type: "error", msg: "Invalid code. Try again." });
                        } finally {
                          setTotpLoading(false);
                        }
                      }}
                    >
                      {totpLoading ? "..." : "Verify"}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="account-field-desc">
                    Add an authenticator app for stronger login security. When enabled, you'll enter
                    an app code instead of an email code.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      try {
                        const res = await api.setupTotp();
                        const data = res as { secret?: string; uri?: string };
                        if (data.secret && data.uri)
                          setTotpSetup({ secret: data.secret, uri: data.uri });
                      } catch {
                        setTotpFeedback({
                          type: "error",
                          msg: "Failed to start authenticator setup.",
                        });
                      }
                    }}
                  >
                    Set up authenticator
                  </button>
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

            {/* Phishing Code */}
            <div className="account-field-lg">
              <label className="account-field-label" htmlFor="account-phishing-code">
                Email security phrase
              </label>
              <p className="account-field-desc">
                A personal phrase included in every email from AEQI. If the phrase is missing, the
                email isn't from us.
              </p>
              <div className="account-field-row">
                <input
                  id="account-phishing-code"
                  className="auth-input"
                  type="text"
                  value={phishingCode}
                  onChange={(e) => {
                    setPhishingCode(e.target.value);
                    setPhishingFeedback(null);
                  }}
                  placeholder="e.g., blue ocean 42"
                  maxLength={100}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handlePhishingSave}
                  disabled={phishingSaving}
                >
                  {phishingSaving ? "..." : "Save"}
                </button>
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

            {/* Change Password */}
            <div className="account-field-lg">
              <label className="account-field-label">Change password</label>
              <form
                className="account-password-form"
                onSubmit={handlePasswordChange}
                autoComplete="off"
              >
                <div className="auth-password-wrap">
                  <input
                    className="auth-input auth-input-password"
                    type={showCurrentPw ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      setPasswordFeedback(null);
                    }}
                    placeholder="Current password"
                    autoComplete="current-password"
                    aria-label="Current password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    tabIndex={-1}
                    aria-label={showCurrentPw ? "Hide current password" : "Show current password"}
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
                      setPasswordFeedback(null);
                    }}
                    placeholder="New password"
                    autoComplete="new-password"
                    aria-label="New password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowNewPw(!showNewPw)}
                    tabIndex={-1}
                    aria-label={showNewPw ? "Hide new password" : "Show new password"}
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
                      setPasswordFeedback(null);
                    }}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    aria-label="Confirm new password"
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setShowConfirmPw(!showConfirmPw)}
                    tabIndex={-1}
                    aria-label={showConfirmPw ? "Hide confirm password" : "Show confirm password"}
                  >
                    <EyeIcon visible={showConfirmPw} />
                  </button>
                </div>
                {passwordFeedback && (
                  <div
                    className={`account-feedback account-feedback-${passwordFeedback.type}`}
                    role="status"
                    aria-live="polite"
                  >
                    {passwordFeedback.msg}
                  </div>
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

            {/* Connected Accounts */}
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
                  <button
                    type="button"
                    className="btn account-connect-btn"
                    onClick={() => {
                      window.location.href = "/api/auth/google";
                    }}
                  >
                    <GoogleIcon /> Connect Google
                  </button>
                )}
                {provider === "github" ? (
                  <div className="account-connected-item account-connected-active">
                    <GitHubIcon />
                    <span>Connected with GitHub</span>
                    <CheckIcon />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn account-connect-btn"
                    onClick={() => {
                      window.location.href = "/api/auth/github";
                    }}
                  >
                    <GitHubIcon /> Connect GitHub
                  </button>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <div className="account-danger-zone">
              <label className="account-field-label account-danger-label">Danger zone</label>
              <p className="account-field-desc">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>
              <button
                type="button"
                className="btn account-danger-btn"
                onClick={() => {
                  if (
                    window.confirm(
                      "Are you sure? This will permanently delete your account, all agents you own, and all data. This cannot be undone.",
                    )
                  ) {
                    if (window.prompt("Type DELETE to confirm") === "DELETE") {
                      api
                        .deleteAccount()
                        .then(() => {
                          logout();
                          navigate("/login");
                        })
                        .catch(() => {});
                    }
                  }
                }}
              >
                Delete account
              </button>
            </div>

            {/* Activity Log */}
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
                    const isError =
                      event.action.includes("failed") || event.action.includes("error");
                    const timeAgo = (() => {
                      try {
                        const diff = Date.now() - new Date(event.created_at).getTime();
                        if (diff < 60000) return "Just now";
                        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
                        return `${Math.floor(diff / 86400000)}d ago`;
                      } catch {
                        return "";
                      }
                    })();
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
                        <span className="account-activity-time">{timeAgo}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "api" && <ApiKeyTab />}

        {activeTab === "invites" && (
          <>
            <p className="account-field-desc account-invites-desc">
              Share invite codes with friends. Each code is single-use. New users get 3 codes of
              their own.
            </p>
            {inviteCodes.length === 0 ? (
              <div className="account-invites-empty">No invite codes available.</div>
            ) : (
              <div className="account-invites-list">
                {inviteCodes.map((inv) => (
                  <div
                    key={inv.code}
                    className={`account-invite-item ${inv.used ? "account-invite-item--used" : "account-invite-item--available"}`}
                  >
                    <code
                      className={`account-invite-code ${inv.used ? "account-invite-code--used" : "account-invite-code--available"}`}
                    >
                      {inv.code}
                    </code>
                    {inv.used ? (
                      <span className="account-invite-used-label">Used</span>
                    ) : (
                      <button
                        type="button"
                        className="btn account-invite-copy-btn"
                        onClick={() => copyCode(inv.code)}
                      >
                        {copiedCode === inv.code ? "Copied!" : "Copy"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "preferences" && (
          <>
            <p className="account-field-desc account-prefs-desc">
              Transactional emails (login codes, password resets) are always sent.
            </p>
            <label className="account-pref-label">
              <input type="checkbox" defaultChecked className="account-pref-checkbox" />
              Product updates -- new features and releases
            </label>
            <label className="account-pref-label">
              <input type="checkbox" defaultChecked className="account-pref-checkbox" />
              Marketing -- tips, case studies, promotions
            </label>
          </>
        )}
      </div>
    </>
  );
}

// ── API Key Tab (account-level ak_ key) ──────────────

function ApiKeyTab() {
  const { href } = useNav();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("aeqi_api_key_display");
    if (stored) setApiKey(stored);
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const data = await api.generateApiKey();
      if (data.api_key) {
        setApiKey(data.api_key);
        localStorage.setItem("aeqi_api_key_display", data.api_key);
        if (data.api_key.startsWith("ak_")) {
          setFeedback({
            type: "success",
            msg: data.rotated
              ? "API key rotated. Previous key is now invalid."
              : "API key generated.",
          });
        }
      }
    } catch (e: unknown) {
      setFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to generate API key.",
      });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <p className="account-field-desc">
        Your API key (<code>ak_</code>) identifies your account across all agents. Use it alongside
        a secret key (<code>sk_</code>) for MCP and API access.
      </p>
      <p className="account-field-desc">
        Only one account API key is active at a time. Generating a new key rotates the previous one
        immediately, so save the new value now.
      </p>

      {apiKey ? (
        <div className="account-field" style={{ marginTop: "var(--space-4)" }}>
          <label className="account-field-label">API Key</label>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <code className="key-new-value">{apiKey}</code>
            <button type="button" className="key-copy-btn" onClick={copy} title="Copy">
              {copied ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="var(--success, #22c55e)"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="5" y="5" width="9" height="9" rx="1.5" />
                  <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
                </svg>
              )}
            </button>
          </div>
          <p className="account-field-desc" style={{ marginTop: "var(--space-2)" }}>
            Active across all agents for your account until you rotate it.
          </p>
          <div style={{ marginTop: "var(--space-3)" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? "Rotating..." : "Rotate API Key"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: "var(--space-4)" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "Generating..." : "Generate API Key"}
          </button>
        </div>
      )}

      {feedback && (
        <div className={`account-feedback account-feedback-${feedback.type}`} role="status">
          {feedback.msg}
        </div>
      )}

      <div style={{ marginTop: "var(--space-6)" }}>
        <p className="account-field-desc">
          To create secret keys for a specific agent, go to{" "}
          <a href={href("/settings?tab=api-keys")} className="key-link">
            Settings &rarr; API Keys
          </a>
          .
        </p>
      </div>
    </>
  );
}
