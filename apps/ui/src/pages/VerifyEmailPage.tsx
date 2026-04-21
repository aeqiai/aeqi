import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import Wordmark from "@/components/Wordmark";
import { Spinner } from "@/components/ui";

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const { pendingEmail, loading, error, verifyEmail, resendCode, isAuthenticated } = useAuthStore();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const email = pendingEmail || localStorage.getItem("aeqi_pending_email") || "";

  useEffect(() => {
    if (pendingEmail) localStorage.setItem("aeqi_pending_email", pendingEmail);
  }, [pendingEmail]);

  useEffect(() => {
    document.title = "verify email · æqi";
  }, []);

  useEffect(() => {
    if (isAuthenticated()) {
      localStorage.removeItem("aeqi_pending_email");
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!email) navigate("/signup", { replace: true });
  }, [email, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered.
    const full = next.join("");
    if (full.length === 6) {
      verifyEmail(email, full).then((ok) => {
        if (ok) {
          localStorage.removeItem("aeqi_pending_email");
          navigate("/", { replace: true });
        }
      });
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      const digits = text.split("");
      setCode(digits);
      inputRefs.current[5]?.focus();
      verifyEmail(email, text).then((ok) => {
        if (ok) {
          localStorage.removeItem("aeqi_pending_email");
          navigate("/", { replace: true });
        }
      });
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const ok = await resendCode(email);
    if (ok) setResendCooldown(60);
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <Wordmark size={48} />
        </div>
        <h1 className="auth-heading">Check your email</h1>
        <p className="auth-subheading">
          We sent a 6-digit code to{" "}
          <strong style={{ color: "var(--text-primary)" }}>{email}</strong>
        </p>

        <div className="verify-code-inputs" onPaste={handlePaste}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              className="verify-code-digit"
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              autoFocus={i === 0}
            />
          ))}
        </div>

        {error && <div className="auth-error">{error}</div>}
        {loading && (
          <p className="auth-subheading auth-verifying">
            <Spinner size="sm" />
            Verifying…
          </p>
        )}

        <p className="auth-switch" style={{ marginTop: 32 }}>
          Didn't get the code?{" "}
          {resendCooldown > 0 ? (
            <span style={{ color: "var(--text-muted)" }}>Resend in {resendCooldown}s</span>
          ) : (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleResend();
              }}
            >
              Resend code
            </a>
          )}
        </p>
      </div>
      <div className="auth-footer">
        <p>The code expires in 10 minutes.</p>
      </div>
    </div>
  );
}
