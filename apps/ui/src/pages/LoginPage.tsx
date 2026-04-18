import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import Wordmark from "@/components/Wordmark";
import PasswordInput from "@/components/PasswordInput";
import { Button, Input } from "@/components/ui";

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
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

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    authMode,
    googleOAuth,
    githubOAuth,
    loading,
    error,
    fetchAuthMode,
    login,
    loginWithEmail,
    verifyEmail,
    resendCode,
    verify2fa,
    verifyTotp,
    resend2fa,
    pending2faEmail,
    isAuthenticated,
  } = useAuthStore();

  const [step, setStep] = useState<"credentials" | "verify" | "2fa" | "totp" | "forgot">(
    "credentials",
  );
  const [secret, setSecret] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [twoFaCode, setTwoFaCode] = useState(["", "", "", "", "", ""]);
  const [verifyError, setVerifyError] = useState("");
  const [twoFaError, setTwoFaError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [twoFaResendCooldown, setTwoFaResendCooldown] = useState(0);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const twoFaRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  useEffect(() => {
    if (isAuthenticated()) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (twoFaResendCooldown <= 0) return;
    const timer = setTimeout(() => setTwoFaResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [twoFaResendCooldown]);

  const clearError = () => useAuthStore.setState({ error: null });

  const handleSecretSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(secret);
    if (ok) navigate("/");
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await loginWithEmail(email, password);
    if (result === "unverified") {
      setStep("verify");
      return;
    }
    if (result === "2fa") {
      setStep("2fa");
      setTwoFaCode(["", "", "", "", "", ""]);
      setTwoFaError("");
      return;
    }
    if (result === "totp") {
      setStep("totp");
      setTwoFaCode(["", "", "", "", "", ""]);
      setTwoFaError("");
      return;
    }
    if (result === "ok") {
      navigate("/");
    }
  };

  // Email verification code handlers
  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();

    const full = next.join("");
    if (full.length === 6) {
      setVerifyLoading(true);
      setVerifyError("");
      verifyEmail(email, full).then((ok) => {
        setVerifyLoading(false);
        if (ok) {
          localStorage.removeItem("aeqi_pending_email");
          navigate("/", { replace: true });
        } else {
          setVerifyError("Invalid or expired code");
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
      setCode(text.split(""));
      inputRefs.current[5]?.focus();
      setVerifyLoading(true);
      setVerifyError("");
      verifyEmail(email, text).then((ok) => {
        setVerifyLoading(false);
        if (ok) {
          localStorage.removeItem("aeqi_pending_email");
          navigate("/", { replace: true });
        } else {
          setVerifyError("Invalid or expired code");
        }
      });
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const ok = await resendCode(email);
    if (ok) setResendCooldown(60);
  };

  // 2FA code handlers
  const handle2faCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...twoFaCode];
    next[index] = value.slice(-1);
    setTwoFaCode(next);
    if (value && index < 5) twoFaRefs.current[index + 1]?.focus();

    const full = next.join("");
    if (full.length === 6) {
      setTwoFaLoading(true);
      setTwoFaError("");
      verify2fa(email, full).then((ok) => {
        setTwoFaLoading(false);
        if (ok) {
          navigate("/", { replace: true });
        } else {
          setTwoFaError("Invalid or expired code");
        }
      });
    }
  };

  const handle2faKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !twoFaCode[index] && index > 0) {
      twoFaRefs.current[index - 1]?.focus();
    }
  };

  const handle2faPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setTwoFaCode(text.split(""));
      twoFaRefs.current[5]?.focus();
      setTwoFaLoading(true);
      setTwoFaError("");
      verify2fa(email, text).then((ok) => {
        setTwoFaLoading(false);
        if (ok) {
          navigate("/", { replace: true });
        } else {
          setTwoFaError("Invalid or expired code");
        }
      });
    }
  };

  const handle2faResend = async () => {
    if (twoFaResendCooldown > 0) return;
    const ok = await resend2fa(email);
    if (ok) setTwoFaResendCooldown(60);
  };

  // TOTP (authenticator app) code handlers
  const handleTotpCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...twoFaCode];
    next[index] = value.slice(-1);
    setTwoFaCode(next);
    if (value && index < 5) twoFaRefs.current[index + 1]?.focus();

    const full = next.join("");
    if (full.length === 6) {
      setTwoFaLoading(true);
      setTwoFaError("");
      verifyTotp(email, full).then((ok) => {
        setTwoFaLoading(false);
        if (ok) {
          navigate("/", { replace: true });
        } else {
          setTwoFaError("Invalid or expired code");
        }
      });
    }
  };

  // Forgot password handler
  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError("");
    try {
      await api.forgotPassword(forgotEmail);
      setForgotSent(true);
    } catch {
      // Always show success to avoid email enumeration
      setForgotSent(true);
    } finally {
      setForgotLoading(false);
    }
  };

  const handleGoogle = () => {
    window.location.href = "/api/auth/google";
  };
  const handleGithub = () => {
    window.location.href = "/api/auth/github";
  };

  // Secret mode
  if (authMode === "secret") {
    return (
      <main className="auth-page">
        <div className="auth-container">
          <div className="auth-logo">
            <Wordmark size={36} color="rgba(0,0,0,0.5)" />
          </div>
          <h1 className="auth-heading">Welcome back</h1>
          <p className="auth-subheading">Enter your access key to continue</p>
          <form className="auth-form" onSubmit={handleSecretSubmit}>
            <PasswordInput
              placeholder="Access key"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                clearError();
              }}
              autoFocus
              hasError={!!error}
              errorId="auth-error"
            />
            {error && (
              <div className="auth-error" role="alert" id="auth-error">
                {error}
              </div>
            )}
            <Button
              variant="primary"
              size="lg"
              type="submit"
              fullWidth
              loading={loading}
              disabled={loading}
            >
              {loading ? "Connecting..." : "Continue"}
            </Button>
          </form>
        </div>
        <div className="auth-footer">
          <p>
            By continuing, you agree to the{" "}
            <a href="https://aeqi.ai/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="https://aeqi.ai/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </main>
    );
  }

  // Accounts mode
  return (
    <main className="auth-page">
      <div className="auth-container" role="region" aria-live="polite">
        <div className="auth-logo">
          <Wordmark size={36} color="rgba(0,0,0,0.5)" />
        </div>
        <h1 className="auth-heading">
          {step === "credentials"
            ? "Welcome back"
            : step === "verify"
              ? "Verify your email"
              : step === "2fa"
                ? "Verification code"
                : step === "totp"
                  ? "Authenticator code"
                  : "Reset password"}
        </h1>
        <p className="auth-subheading">
          {step === "credentials" ? (
            "Sign in to your workspace"
          ) : step === "verify" ? (
            <>
              Code sent to <strong className="auth-email-highlight">{email}</strong>
            </>
          ) : step === "2fa" ? (
            <>
              We sent a code to{" "}
              <strong className="auth-email-highlight">{pending2faEmail || email}</strong>
            </>
          ) : step === "totp" ? (
            "Enter the 6-digit code from your authenticator app"
          ) : (
            "Enter your email to receive a reset link"
          )}
        </p>

        {step === "credentials" && (
          <>
            <form className="auth-form" onSubmit={handleCredentialsSubmit} autoComplete="on">
              <Input
                size="lg"
                type="email"
                name="email"
                placeholder="Email address"
                aria-label="Email address"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError();
                }}
                autoFocus
              />
              <PasswordInput
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError();
                }}
                hasError={!!error}
                errorId="auth-error"
              />
              {error && (
                <div className="auth-error" role="alert" id="auth-error">
                  {error}
                </div>
              )}
              <Button
                variant="primary"
                size="lg"
                type="submit"
                fullWidth
                loading={loading}
                disabled={loading || !email.trim() || !password}
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
            <p className="auth-switch">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setForgotEmail(email);
                  setForgotSent(false);
                  setForgotError("");
                  setStep("forgot");
                }}
              >
                Forgot password?
              </a>
            </p>

            {(googleOAuth || githubOAuth) && (
              <>
                <div className="auth-divider">
                  <span>or</span>
                </div>
                <div className="auth-oauth-group">
                  {googleOAuth && (
                    <Button
                      variant="secondary"
                      size="lg"
                      fullWidth
                      onClick={handleGoogle}
                      type="button"
                    >
                      <GoogleIcon /> Continue with Google
                    </Button>
                  )}
                  {githubOAuth && (
                    <Button
                      variant="secondary"
                      size="lg"
                      fullWidth
                      onClick={handleGithub}
                      type="button"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                      </svg>
                      Continue with GitHub
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {step === "verify" && (
          <>
            <div className="verify-code-inputs" onPaste={handlePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  className={`verify-code-digit${verifyError ? " has-error" : ""}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => {
                    handleCodeChange(i, e.target.value);
                    if (verifyError) setVerifyError("");
                  }}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            {verifyError && (
              <div className="auth-error" role="alert">
                {verifyError}
              </div>
            )}
            {verifyLoading && <p className="auth-subheading auth-verifying">Verifying...</p>}
            <p className="auth-switch">
              Didn't get the code?{" "}
              {resendCooldown > 0 ? (
                <span className="auth-cooldown">Resend in {resendCooldown}s</span>
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
          </>
        )}

        {step === "2fa" && (
          <>
            <div className="verify-code-inputs" onPaste={handle2faPaste}>
              {twoFaCode.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    twoFaRefs.current[i] = el;
                  }}
                  className={`verify-code-digit${twoFaError ? " has-error" : ""}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => {
                    handle2faCodeChange(i, e.target.value);
                    if (twoFaError) setTwoFaError("");
                  }}
                  onKeyDown={(e) => handle2faKeyDown(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            {twoFaError && (
              <div className="auth-error" role="alert">
                {twoFaError}
              </div>
            )}
            {twoFaLoading && <p className="auth-subheading auth-verifying">Verifying...</p>}
            <p className="auth-switch">
              Didn't get the code?{" "}
              {twoFaResendCooldown > 0 ? (
                <span className="auth-cooldown">Resend in {twoFaResendCooldown}s</span>
              ) : (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handle2faResend();
                  }}
                >
                  Resend code
                </a>
              )}
            </p>
            <p className="auth-switch">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setStep("credentials");
                  setTwoFaCode(["", "", "", "", "", ""]);
                  setTwoFaError("");
                }}
              >
                Back to login
              </a>
            </p>
          </>
        )}

        {step === "totp" && (
          <>
            <div
              className="verify-code-inputs"
              onPaste={(e) => {
                e.preventDefault();
                const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                if (pasted.length === 6) {
                  const digits = pasted.split("");
                  setTwoFaCode(digits);
                  setTwoFaLoading(true);
                  setTwoFaError("");
                  verifyTotp(email, pasted).then((ok) => {
                    setTwoFaLoading(false);
                    if (ok) {
                      navigate("/", { replace: true });
                    } else {
                      setTwoFaError("Invalid code");
                    }
                  });
                }
              }}
            >
              {twoFaCode.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    twoFaRefs.current[i] = el;
                  }}
                  className={`verify-code-digit${twoFaError ? " has-error" : ""}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleTotpCodeChange(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !twoFaCode[i] && i > 0)
                      twoFaRefs.current[i - 1]?.focus();
                  }}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            {twoFaError && (
              <div className="auth-error" role="alert">
                {twoFaError}
              </div>
            )}
            {twoFaLoading && (
              <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
                Verifying...
              </p>
            )}
            <p className="auth-switch" style={{ marginTop: 16 }}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setStep("credentials");
                  setTwoFaCode(["", "", "", "", "", ""]);
                  setTwoFaError("");
                }}
              >
                Back to login
              </a>
            </p>
          </>
        )}

        {step === "forgot" && (
          <>
            {!forgotSent ? (
              <form className="auth-form" onSubmit={handleForgotSubmit}>
                <Input
                  size="lg"
                  type="email"
                  placeholder="Email address"
                  aria-label="Email address"
                  value={forgotEmail}
                  onChange={(e) => {
                    setForgotEmail(e.target.value);
                    setForgotError("");
                  }}
                  autoFocus
                />
                {forgotError && (
                  <div className="auth-error" role="alert">
                    {forgotError}
                  </div>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  type="submit"
                  fullWidth
                  loading={forgotLoading}
                  disabled={forgotLoading || !forgotEmail.trim()}
                >
                  {forgotLoading ? "Sending..." : "Send reset link"}
                </Button>
              </form>
            ) : (
              <div className="auth-form">
                <p className="auth-subheading auth-subheading-last">
                  If an account exists with that email, we've sent a reset link.
                </p>
              </div>
            )}
            <p className="auth-switch">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setStep("credentials");
                  setForgotSent(false);
                  setForgotError("");
                }}
              >
                Back to login
              </a>
            </p>
          </>
        )}

        {step !== "verify" && step !== "2fa" && step !== "forgot" && (
          <p className="auth-switch">
            Don't have an account? <Link to="/signup">Sign up</Link>
          </p>
        )}
      </div>
      <div className="auth-footer">
        <p>
          By continuing, you agree to the{" "}
          <a href="https://aeqi.ai/terms" target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="https://aeqi.ai/privacy" target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}
