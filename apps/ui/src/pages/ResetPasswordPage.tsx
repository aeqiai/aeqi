import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => navigate("/login", { replace: true }), 3000);
      return () => clearTimeout(timer);
    }
  }, [success, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!token) {
      setError("Invalid or missing reset token");
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reset password";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-container">
        <div className="auth-logo"><BrandMark size={36} color="rgba(0,0,0,0.5)" /></div>
        <h1 className="auth-heading">Reset password</h1>
        <p className="auth-subheading">
          {success ? "Password reset! Redirecting to login..." : "Enter your new password"}
        </p>

        {!success && (
          <form className="auth-form" onSubmit={handleSubmit}>
            <PasswordInput
              placeholder="New password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              autoFocus
              hasError={!!error}
              errorId="reset-error"
            />
            <PasswordInput
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
              hasError={!!error}
              errorId="reset-error"
            />
            {error && <div className="auth-error" role="alert" id="reset-error">{error}</div>}
            <button
              className="auth-btn-primary"
              type="submit"
              disabled={loading || !password || !confirmPassword}
            >
              {loading ? "Resetting..." : "Reset password"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          <a href="/login">Back to login</a>
        </p>
      </div>
      <div className="auth-footer">
        <p>
          By continuing, you agree to the{" "}
          <a href="https://aeqi.ai/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
          {" "}and{" "}
          <a href="https://aeqi.ai/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </p>
      </div>
    </main>
  );
}
