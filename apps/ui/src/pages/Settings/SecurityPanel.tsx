import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { Banner, Button, Input, ConfirmDialog, QRCode, StatusRow } from "@/components/ui";
import { GoogleIcon, GitHubIcon } from "@/components/icons/Brand";
import AddPasskeyButton from "@/pages/Settings/AddPasskeyButton";

type Feedback = { type: "success" | "error"; msg: string } | null;

/**
 * Mirrors `validate_security_phrase` in aeqi-platform/src/server.rs. Keep
 * the rules in sync — server is the authority but the client validation
 * gives a fast, in-place error instead of a round-trip.
 */
function validateSecurityPhrase(raw: string, accountEmail: string): string | null {
  const phrase = raw.trim();
  if (phrase.length < 3 || phrase.length > 32) {
    return "Phrase must be 3 to 32 characters.";
  }
  let hasLetter = false;
  for (const ch of phrase) {
    if (/[A-Za-z]/.test(ch)) {
      hasLetter = true;
    } else if (/[0-9 -]/.test(ch)) {
      // allowed
    } else {
      return "Phrase can only contain letters, numbers, spaces, and hyphens.";
    }
  }
  if (!hasLetter) return "Phrase must contain at least one letter.";
  if (accountEmail) {
    const lower = phrase.toLowerCase();
    const email = accountEmail.toLowerCase();
    if (lower === email) return "Don't use your email address as the security phrase.";
    const local = email.split("@")[0];
    if (local && lower === local) return "Don't use your email address as the security phrase.";
  }
  return null;
}

/**
 * Settings → Security tab. TOTP setup, email phishing phrase, password
 * change link, OAuth provider connections, danger zone.
 *
 * Login/IP history and connected devices live under the Devices tab.
 */
export default function SecurityPanel() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const [provider, setProvider] = useState<string>("local");
  const [accountEmail, setAccountEmail] = useState<string>("");

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

  // Disable TOTP modal
  const [disableTotpOpen, setDisableTotpOpen] = useState(false);
  const [disableTotpPw, setDisableTotpPw] = useState("");
  const [disableTotpCode, setDisableTotpCode] = useState("");
  const [disablingTotp, setDisablingTotp] = useState(false);

  // Delete account modal
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then((data) => {
        const u = data as Record<string, unknown>;
        if (typeof u.phishing_code === "string") setPhishingCode(u.phishing_code);
        if (typeof u.provider === "string") setProvider(u.provider);
        if (typeof u.email === "string") setAccountEmail(u.email);
      })
      .catch(() => {});
  }, []);

  const handlePhishingSave = async () => {
    setPhishingFeedback(null);
    const err = validateSecurityPhrase(phishingCode, accountEmail);
    if (err) {
      setPhishingFeedback({ type: "error", msg: err });
      return;
    }
    setPhishingSaving(true);
    try {
      await api.updatePhishingCode(phishingCode.trim());
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
      setTotpFeedback({ type: "success", msg: "Authenticator enabled." });
    } catch {
      setTotpFeedback({ type: "error", msg: "Invalid code. Try again." });
    } finally {
      setTotpLoading(false);
    }
  };

  const disableTotp = () => {
    setDisableTotpPw("");
    setDisableTotpCode("");
    setDisableTotpOpen(true);
  };

  const performDisableTotp = async () => {
    if (!disableTotpPw || !disableTotpCode) return;
    setDisablingTotp(true);
    try {
      await api.disableTotp(disableTotpPw, disableTotpCode);
      setTotpEnabled(false);
      setTotpSetup(null);
      setTotpFeedback({ type: "success", msg: "Authenticator disabled." });
      setDisableTotpOpen(false);
    } catch {
      setTotpFeedback({ type: "error", msg: "Failed to disable authenticator." });
    } finally {
      setDisablingTotp(false);
    }
  };

  const handleDeleteAccount = () => {
    setDeleteConfirm("");
    setDeleteOpen(true);
  };

  const performDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") return;
    setDeletingAccount(true);
    try {
      await api.deleteAccount();
      logout();
      navigate("/login");
    } catch {
      setDeletingAccount(false);
    }
  };

  return (
    <>
      <section className="account-section">
        <h3 className="account-section-title">Authentication</h3>

        <div>
          <label className="account-field-label">Two-factor authentication</label>
          {totpEnabled ? (
            <StatusRow
              dot="active"
              label="Authenticator app enabled"
              action={
                <Button type="button" variant="secondary" size="sm" onClick={disableTotp}>
                  Disable
                </Button>
              }
            />
          ) : totpSetup ? (
            <div>
              <p className="account-field-desc">
                Scan this QR code with your authenticator app, then enter the 6-digit code to
                verify.
              </p>
              <div className="account-qr-container">
                <QRCode value={totpSetup.uri} size={200} />
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
                Backup codes — save these now
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
          {totpFeedback && <Banner kind={totpFeedback.type}>{totpFeedback.msg}</Banner>}
        </div>

        <div className="account-subsection">
          <label className="account-field-label">Password</label>
          <p className="account-field-desc">
            Change your password on a dedicated page. We'll ask for your current one first.
          </p>
          <Link to="/change-password" className="account-action-link">
            Change password →
          </Link>
        </div>

        <div className="account-subsection">
          <label className="account-field-label">Passkeys</label>
          <p className="account-field-desc">
            Add a Touch ID / Face ID / Windows Hello / hardware-key credential as an additional way
            to sign in to this account.
          </p>
          <AddPasskeyButton />
        </div>
      </section>

      <section className="account-section">
        <h3 className="account-section-title">Email security phrase</h3>
        <div className="account-field-lg">
          <p className="account-field-desc">
            Choose a phrase you will recognize in sign-in emails. Do not use your email, password,
            or verification code.
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
              maxLength={32}
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
          {phishingFeedback && <Banner kind={phishingFeedback.type}>{phishingFeedback.msg}</Banner>}
        </div>
      </section>

      <section className="account-section">
        <h3 className="account-section-title">Connected accounts</h3>
        <StatusRow
          icon={<GoogleIcon />}
          label="Google"
          status={provider === "google" ? "Connected" : undefined}
          action={
            provider === "google" ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => {
                  window.location.href = "/api/auth/google";
                }}
              >
                Connect
              </Button>
            )
          }
        />
        <StatusRow
          icon={<GitHubIcon />}
          label="GitHub"
          status={provider === "github" ? "Connected" : undefined}
          action={
            provider === "github" ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => {
                  window.location.href = "/api/auth/github";
                }}
              >
                Connect
              </Button>
            )
          }
        />
      </section>

      <section className="account-section account-section--danger">
        <h3 className="account-section-title">Danger zone</h3>
        <p className="account-field-desc">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <Button variant="danger" type="button" onClick={handleDeleteAccount}>
          Delete account
        </Button>
      </section>

      <ConfirmDialog
        open={disableTotpOpen}
        onClose={() => setDisableTotpOpen(false)}
        onConfirm={performDisableTotp}
        title="Disable authenticator"
        confirmLabel="Disable"
        destructive
        loading={disablingTotp}
        message={
          <div className="account-form-stack">
            <p>
              This removes two-factor login from your account. Re-enabling later requires a fresh
              setup.
            </p>
            <Input
              size="lg"
              type="password"
              placeholder="Current password"
              value={disableTotpPw}
              onChange={(e) => setDisableTotpPw(e.target.value)}
              autoComplete="current-password"
            />
            <Input
              size="lg"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code from your app"
              value={disableTotpCode}
              onChange={(e) => setDisableTotpCode(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={performDeleteAccount}
        title="Delete account"
        confirmLabel="Delete forever"
        destructive
        loading={deletingAccount}
        message={
          <div className="account-form-stack">
            <p>
              This permanently deletes your account, every Company you own, and all data we hold for
              you. There is no undo.
            </p>
            <p>
              Type <strong>DELETE</strong> to confirm.
            </p>
            <Input
              size="lg"
              type="text"
              placeholder="DELETE"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoFocus
            />
          </div>
        }
      />
    </>
  );
}
