import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import Wordmark from "@/components/Wordmark";
import PasswordInput from "@/components/PasswordInput";
import { Button } from "@/components/ui";

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    document.title = "change password · æqi";
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => navigate("/settings/security", { replace: true }), 2000);
    return () => clearTimeout(timer);
  }, [success, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Password change failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Wordmark size={36} />
        </div>
        <h1 className="auth-heading">Change password</h1>
        <p className="auth-subheading">
          {success
            ? "Password updated. Returning to your account…"
            : "Confirm your current password, then choose a new one."}
        </p>

        {!success && (
          <form className="auth-form" onSubmit={handleSubmit}>
            <PasswordInput
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setError("");
              }}
              autoComplete="current-password"
              autoFocus
              hasError={!!error}
              errorId="change-password-error"
            />
            <PasswordInput
              placeholder="New password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError("");
              }}
              autoComplete="new-password"
              hasError={!!error}
              errorId="change-password-error"
            />
            <PasswordInput
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError("");
              }}
              autoComplete="new-password"
              hasError={!!error}
              errorId="change-password-error"
            />
            {error && (
              <div className="auth-error" role="alert" id="change-password-error">
                {error}
              </div>
            )}
            <Button
              variant="primary"
              size="lg"
              type="submit"
              fullWidth
              loading={loading}
              disabled={loading || !currentPassword || !newPassword || !confirmPassword}
            >
              Update password
            </Button>
          </form>
        )}

        <p className="auth-switch">
          <Link to="/settings/security">Back to security settings</Link>
        </p>
      </div>
      <div className="auth-footer">
        <p>Forgot your current password? Sign out and use the reset link instead.</p>
      </div>
    </main>
  );
}
