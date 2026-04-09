import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import RoundAvatar from "@/components/RoundAvatar";
import PageTabs, { useActiveTab } from "@/components/PageTabs";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "invites", label: "Invites" },
  { id: "preferences", label: "Preferences" },
];

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M6.5 3.8A6.4 6.4 0 018 3.5c4 0 6.5 4.5 6.5 4.5a10.7 10.7 0 01-1.3 1.7M9.4 9.4A2 2 0 016.6 6.6" /><path d="M1.5 8s1.2-2.2 3.2-3.5M1 1l14 14" /></svg>;
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></svg>;
}

const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round"><polyline points="3.5 8.5 6.5 11.5 12.5 5.5" /></svg>;
const GoogleIcon = () => <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>;
const GitHubIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" /></svg>;

export default function SettingsPage() {
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
  const [profileFeedback, setProfileFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Security state
  const [phishingCode, setPhishingCode] = useState("");
  const [phishingSaving, setPhishingSaving] = useState(false);
  const [phishingFeedback, setPhishingFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  // TOTP state
  const [totpSetup, setTotpSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpFeedback, setTotpFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);

  // Activity state
  const [activity, setActivity] = useState<Array<{ action: string; detail?: string; ip?: string; created_at: string }>>([]);

  // Invites state
  const [inviteCodes, setInviteCodes] = useState<Array<{ code: string; used: boolean }>>([]);
  const [copiedCode, setCopiedCode] = useState("");

  useEffect(() => {
    api.getMe().then((data) => {
      setUser(data);
      const name = (data.name as string) || "";
      const parts = name.split(/\s+/);
      setFirstName(parts[0] || "");
      setLastName(parts.slice(1).join(" ") || "");
      if (typeof data.phishing_code === "string") setPhishingCode(data.phishing_code as string);
      if (typeof data.phone === "string") setPhone(data.phone as string);
    }).catch(() => {});
    api.getInviteCodes().then((data: Record<string, unknown>) => {
      const codes = (data as { codes?: Array<{ code: string; used: boolean }> }).codes;
      if (Array.isArray(codes)) setInviteCodes(codes);
    }).catch(() => {});
    api.getActivity().then((data: Record<string, unknown>) => {
      const events = (data as { events?: Array<{ action: string; detail?: string; ip?: string; created_at: string }> }).events;
      if (Array.isArray(events)) setActivity(events);
    }).catch(() => {});
  }, []);

  const handleProfileSave = async () => {
    setProfileFeedback(null);
    if (!firstName.trim()) { setProfileFeedback({ type: "error", msg: "First name is required" }); return; }
    setProfileSaving(true);
    try {
      await api.updateProfile(firstName.trim(), lastName.trim(), phone.trim());
      setProfileFeedback({ type: "success", msg: "Profile updated" });
      setTimeout(() => setProfileFeedback(null), 3000);
    } catch (e: unknown) {
      setProfileFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to update" });
    } finally { setProfileSaving(false); }
  };

  const handlePhishingSave = async () => {
    setPhishingFeedback(null);
    if (phishingCode.length < 3 || phishingCode.length > 100) { setPhishingFeedback({ type: "error", msg: "Must be 3-100 characters" }); return; }
    setPhishingSaving(true);
    try {
      await api.updatePhishingCode(phishingCode);
      setPhishingFeedback({ type: "success", msg: "Security phrase updated" });
      setTimeout(() => setPhishingFeedback(null), 3000);
    } catch (e: unknown) {
      setPhishingFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to update" });
    } finally { setPhishingSaving(false); }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);
    if (newPassword.length < 8) { setPasswordFeedback({ type: "error", msg: "Min 8 characters" }); return; }
    if (newPassword !== confirmPassword) { setPasswordFeedback({ type: "error", msg: "Passwords don't match" }); return; }
    setPasswordSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordFeedback({ type: "success", msg: "Password updated" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setTimeout(() => setPasswordFeedback(null), 3000);
    } catch (e: unknown) {
      setPasswordFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed" });
    } finally { setPasswordSaving(false); }
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
      <div className="settings-page">

        {activeTab === "profile" && (
          <>
            <div className="settings-profile-header">
              <label className="settings-avatar-label">
                {user?.avatar_url ? (
                  <img src={user.avatar_url as string} alt="" className="settings-avatar-img" />
                ) : (
                  <RoundAvatar name={displayName} size={48} />
                )}
                <div className="settings-avatar-badge">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
                </div>
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) { setProfileFeedback({ type: "error", msg: "Image must be under 2MB" }); return; }
                  const reader = new FileReader();
                  reader.onload = async () => {
                    try {
                      await api.updateAvatar(reader.result as string);
                      setUser((prev) => prev ? { ...prev, avatar_url: reader.result as string } : prev);
                      setProfileFeedback({ type: "success", msg: "Avatar updated" });
                      setTimeout(() => setProfileFeedback(null), 3000);
                    } catch (err: unknown) {
                      setProfileFeedback({ type: "error", msg: err instanceof Error ? err.message : "Upload failed" });
                    }
                  };
                  reader.readAsDataURL(file);
                }} />
              </label>
              <div>
                <div className="settings-profile-name">{displayName}</div>
                <div className="settings-profile-email">{email}</div>
              </div>
            </div>

            <div className="settings-name-grid">
              <div>
                <label className="settings-field-label">First name</label>
                <input className="auth-input" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" autoComplete="given-name" />
              </div>
              <div>
                <label className="settings-field-label">Last name</label>
                <input className="auth-input" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" autoComplete="family-name" />
              </div>
            </div>

            <div className="settings-field-sm">
              <label className="settings-field-label">Email</label>
              <input className="auth-input settings-disabled-input" type="email" value={email} disabled />
            </div>

            <div className="settings-field-md">
              <label className="settings-field-label">Phone</label>
              <input className="auth-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" autoComplete="tel" />
              <p className="settings-field-desc">Optional. For SMS verification in the future.</p>
            </div>

            {/* KYC */}
            <div className="settings-kyc-card">
              <div className="settings-kyc-row">
                <div>
                  <label className="settings-field-label" style={{ marginBottom: 2 }}>Identity verification</label>
                  <p className="settings-field-desc" style={{ margin: 0 }}>Required for incorporation, equity issuance, and marketplace access.</p>
                </div>
                <span className="settings-badge-coming-soon">Coming soon</span>
              </div>
            </div>

            <button className="btn btn-primary" onClick={handleProfileSave} disabled={profileSaving}>
              {profileSaving ? "Saving..." : "Save"}
            </button>
            {profileFeedback && <div className={`settings-feedback settings-feedback-${profileFeedback.type}`}>{profileFeedback.msg}</div>}

            {authMode !== "none" && (
              <>
                <div className="settings-divider" />
                <button className="btn settings-sign-out-btn" onClick={() => { logout(); navigate("/login"); }}>Sign out</button>
              </>
            )}
          </>
        )}

        {activeTab === "security" && (
          <>
            {/* Two-Factor Authentication */}
            <div className="settings-field-lg">
              <label className="settings-field-label">Two-factor authentication</label>
              {totpEnabled ? (
                <div className="settings-totp-status">
                  <div className="settings-status-dot" />
                  <span className="settings-totp-status-text">Authenticator app enabled</span>
                  <button className="btn settings-totp-disable-btn" onClick={async () => {
                    const pw = window.prompt("Enter your password to disable TOTP");
                    const code = window.prompt("Enter your authenticator code");
                    if (!pw || !code) return;
                    try {
                      await api.disableTotp(pw, code);
                      setTotpEnabled(false);
                      setTotpSetup(null);
                      setTotpFeedback({ type: "success", msg: "Authenticator disabled" });
                    } catch { setTotpFeedback({ type: "error", msg: "Failed to disable" }); }
                  }}>Disable</button>
                </div>
              ) : totpSetup ? (
                <div>
                  <p className="settings-field-desc">Scan this QR code with your authenticator app, then enter the 6-digit code to verify.</p>
                  <div className="settings-qr-container">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpSetup.uri)}`} alt="TOTP QR" width={200} height={200} />
                  </div>
                  <p className="settings-manual-entry">Manual entry: <code>{totpSetup.secret}</code></p>
                  <div className="settings-field-row">
                    <input className="auth-input settings-totp-input" type="text" inputMode="numeric" maxLength={6} value={totpCode} onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "")); setTotpFeedback(null); }} placeholder="6-digit code" />
                    <button className="btn btn-primary" disabled={totpLoading || totpCode.length !== 6} onClick={async () => {
                      setTotpLoading(true);
                      try {
                        const res = await api.verifyTotp(totpCode);
                        setTotpEnabled(true);
                        setTotpBackupCodes((res as { backup_codes?: string[] }).backup_codes || []);
                        setTotpSetup(null);
                        setTotpCode("");
                        setTotpFeedback({ type: "success", msg: "Authenticator enabled!" });
                      } catch { setTotpFeedback({ type: "error", msg: "Invalid code" }); }
                      finally { setTotpLoading(false); }
                    }}>{totpLoading ? "..." : "Verify"}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="settings-field-desc">Add an authenticator app (Google Authenticator, 1Password, Authy) for stronger security. When enabled, login requires an app code instead of email code.</p>
                  <button className="btn btn-primary" onClick={async () => {
                    try {
                      const res = await api.setupTotp();
                      const data = res as { secret?: string; uri?: string };
                      if (data.secret && data.uri) setTotpSetup({ secret: data.secret, uri: data.uri });
                    } catch { setTotpFeedback({ type: "error", msg: "Failed to setup" }); }
                  }}>Set up authenticator</button>
                </div>
              )}
              {totpBackupCodes.length > 0 && (
                <div style={{ marginTop: 12, padding: 12, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 8 }}>
                  <label className="settings-field-label" style={{ color: "rgb(161,98,7)" }}>Backup codes — save these now</label>
                  <p className="settings-field-desc">Each code can only be used once. Store them somewhere safe.</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8 }}>
                    {totpBackupCodes.map((c) => <code key={c} style={{ fontSize: 13, padding: "4px 8px", background: "var(--bg-elevated)", borderRadius: 4, fontFamily: "var(--font-mono)" }}>{c}</code>)}
                  </div>
                </div>
              )}
              {totpFeedback && <div className={`settings-feedback settings-feedback-${totpFeedback.type}`}>{totpFeedback.msg}</div>}
            </div>

            {/* Phishing Code */}
            <div style={{ marginBottom: 24 }}>
              <label className="settings-field-label">Email security phrase</label>
              <p className="settings-field-desc">A personal phrase in every email from AEQI. No phrase = not from us.</p>
              <div className="settings-field-row">
                <input className="auth-input" type="text" value={phishingCode} onChange={(e) => { setPhishingCode(e.target.value); setPhishingFeedback(null); }} placeholder="e.g., blue ocean 42" maxLength={100} />
                <button className="btn btn-primary" onClick={handlePhishingSave} disabled={phishingSaving}>{phishingSaving ? "..." : "Save"}</button>
              </div>
              {phishingFeedback && <div className={`settings-feedback settings-feedback-${phishingFeedback.type}`}>{phishingFeedback.msg}</div>}
            </div>

            {/* Change Password */}
            <div style={{ marginBottom: 24 }}>
              <label className="settings-field-label">Change password</label>
              <form className="settings-password-form" onSubmit={handlePasswordChange} autoComplete="off">
                <div className="auth-password-wrap">
                  <input className="auth-input auth-input-password" type={showCurrentPw ? "text" : "password"} value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setPasswordFeedback(null); }} placeholder="Current password" autoComplete="current-password" />
                  <button type="button" className="auth-password-toggle" onClick={() => setShowCurrentPw(!showCurrentPw)} tabIndex={-1}><EyeIcon visible={showCurrentPw} /></button>
                </div>
                <div className="auth-password-wrap">
                  <input className="auth-input auth-input-password" type={showNewPw ? "text" : "password"} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPasswordFeedback(null); }} placeholder="New password" autoComplete="new-password" />
                  <button type="button" className="auth-password-toggle" onClick={() => setShowNewPw(!showNewPw)} tabIndex={-1}><EyeIcon visible={showNewPw} /></button>
                </div>
                <div className="auth-password-wrap">
                  <input className="auth-input auth-input-password" type={showConfirmPw ? "text" : "password"} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setPasswordFeedback(null); }} placeholder="Confirm new password" autoComplete="new-password" />
                  <button type="button" className="auth-password-toggle" onClick={() => setShowConfirmPw(!showConfirmPw)} tabIndex={-1}><EyeIcon visible={showConfirmPw} /></button>
                </div>
                {passwordFeedback && <div className={`settings-feedback settings-feedback-${passwordFeedback.type}`}>{passwordFeedback.msg}</div>}
                <button className="btn btn-primary" type="submit" disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}>
                  {passwordSaving ? "Updating..." : "Update password"}
                </button>
              </form>
            </div>

            {/* Connected Accounts */}
            <div>
              <label className="settings-field-label">Connected accounts</label>
              <div className="settings-connected-list">
                {provider === "google" ? (
                  <div className="settings-connected-item settings-connected-active"><GoogleIcon /><span>Connected with Google</span><CheckIcon /></div>
                ) : (
                  <button className="btn settings-connect-btn" onClick={() => { window.location.href = "/api/auth/google"; }}><GoogleIcon /> Connect Google</button>
                )}
                {provider === "github" ? (
                  <div className="settings-connected-item settings-connected-active"><GitHubIcon /><span>Connected with GitHub</span><CheckIcon /></div>
                ) : (
                  <button className="btn settings-connect-btn" onClick={() => { window.location.href = "/api/auth/github"; }}><GitHubIcon /> Connect GitHub</button>
                )}
              </div>
            </div>

            {/* Danger Zone */}
            <div style={{ marginTop: 40, padding: 16, border: "1px solid rgba(220,38,38,0.2)", borderRadius: 8, background: "rgba(220,38,38,0.03)" }}>
              <label className="settings-field-label" style={{ color: "rgb(220,38,38)" }}>Danger zone</label>
              <p className="settings-field-desc">Permanently delete your account and all associated data. This cannot be undone.</p>
              <button
                className="btn"
                style={{ color: "rgb(220,38,38)", borderColor: "rgba(220,38,38,0.3)", marginTop: 8, fontSize: 13 }}
                onClick={() => {
                  if (window.confirm("Are you sure? This will permanently delete your account, all companies you own, and all data. This cannot be undone.")) {
                    if (window.prompt("Type DELETE to confirm") === "DELETE") {
                      api.deleteAccount().then(() => { logout(); navigate("/login"); }).catch(() => {});
                    }
                  }
                }}
              >
                Delete account
              </button>
            </div>

            {/* Activity Log */}
            <div style={{ marginTop: 40 }}>
              <label className="settings-field-label">Activity log</label>
              <p className="settings-field-desc" style={{ marginBottom: 10 }}>Recent security events on your account.</p>
              {activity.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "16px 0" }}>No activity recorded yet.</div>
              ) : (
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                  {activity.slice(0, 20).map((event, i) => {
                    const isError = event.action.includes("failed") || event.action.includes("error");
                    const timeAgo = (() => {
                      try {
                        const diff = Date.now() - new Date(event.created_at).getTime();
                        if (diff < 60000) return "Just now";
                        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
                        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
                        return `${Math.floor(diff / 86400000)}d ago`;
                      } catch { return ""; }
                    })();
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: i < activity.length - 1 ? "1px solid var(--border)" : "none", fontSize: 12 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: isError ? "#ef4444" : "#22c55e", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{event.action.replace(/_/g, " ")}</span>
                          {event.detail && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{event.detail}</span>}
                        </div>
                        {event.ip && <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>{event.ip}</span>}
                        <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0, minWidth: 50, textAlign: "right" }}>{timeAgo}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "invites" && (
          <>
            <p className="settings-field-desc" style={{ marginBottom: 16 }}>Share invite codes with friends. Each code is single-use. New users get 3 codes of their own.</p>
            {inviteCodes.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "20px 0" }}>No invite codes available.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {inviteCodes.map((inv) => (
                  <div key={inv.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: inv.used ? "var(--bg-base)" : "var(--bg-elevated)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <code style={{ flex: 1, fontSize: 14, fontWeight: 600, color: inv.used ? "var(--text-muted)" : "var(--text-primary)", textDecoration: inv.used ? "line-through" : "none", fontFamily: "var(--font-mono)" }}>{inv.code}</code>
                    {inv.used ? (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Used</span>
                    ) : (
                      <button
                        className="btn"
                        onClick={() => copyCode(inv.code)}
                        style={{ fontSize: 12, padding: "3px 10px" }}
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
            <p className="settings-field-desc" style={{ marginBottom: 16 }}>Transactional emails (login codes, password resets) are always sent.</p>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-primary)", cursor: "pointer", padding: "8px 0" }}>
              <input type="checkbox" defaultChecked style={{ accentColor: "var(--text-primary)", width: 16, height: 16 }} />
              Product updates — new features and releases
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-primary)", cursor: "pointer", padding: "8px 0" }}>
              <input type="checkbox" defaultChecked style={{ accentColor: "var(--text-primary)", width: 16, height: 16 }} />
              Marketing — tips, case studies, promotions
            </label>
          </>
        )}
      </div>
    </>
  );
}
