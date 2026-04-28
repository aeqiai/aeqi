import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { getRedirectAfterAuth } from "@/lib/redirectAfterAuth";
import Wordmark from "@/components/Wordmark";
import PasswordInput from "@/components/PasswordInput";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import ContinueWithPasskeyButton from "@/components/ContinueWithPasskeyButton";
import { GoogleIcon, GitHubIcon } from "@/components/icons/Brand";
import { Button, Input, Spinner } from "@/components/ui";

const TEMPLATE_LABELS: Record<string, string> = {
  software: "Software Agent",
  research: "Research Agent",
  content: "Content Agent",
  services: "Services Agent",
};

export default function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const template = params.get("template");
  const templateLabel = template ? TEMPLATE_LABELS[template] : null;
  const {
    loading,
    error,
    signup,
    verifyEmail,
    resendCode,
    googleOAuth,
    githubOAuth,
    waitlist,
    fetchAuthMode,
  } = useAuthStore();

  // When waitlist=true, default to waitlist mode. "Have an invite code?" switches to signup.
  const [mode, setMode] = useState<"waitlist" | "signup">("signup");
  const [step, setStep] = useState<"email" | "info" | "verify">("email");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistMsg, setWaitlistMsg] = useState("");
  const [hp, setHp] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [verifyError, setVerifyError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);
  useEffect(() => {
    if (waitlist) setMode("waitlist");
  }, [waitlist]);

  useEffect(() => {
    document.title =
      mode === "waitlist"
        ? "Waitlist · aeqi"
        : step === "verify"
          ? "Verify email · aeqi"
          : "Sign up · aeqi";
  }, [mode, step]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  // ── Waitlist submit ──
  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      const resp = await api.joinWaitlist(email, hp);
      setWaitlistDone(true);
      setWaitlistMsg(resp.message || "You're on the list!");
    } catch {
      setWaitlistMsg("Something went wrong. Try again.");
    }
  };

  // ── Signup steps ──
  const handleCredentialsContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() && password.length >= 8) setStep("info");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || (waitlist && !inviteCode.trim())) return;
    const result = await signup(
      email,
      password,
      fullName,
      inviteCode || undefined,
      template || undefined,
    );
    if (result === "pending") setStep("verify");
    else if (result === "verified")
      navigate(getRedirectAfterAuth(params, "/start"), { replace: true });
  };

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
          navigate(getRedirectAfterAuth(params, "/start"), { replace: true });
        } else setVerifyError("Invalid or expired code");
      });
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) inputRefs.current[index - 1]?.focus();
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
          navigate(getRedirectAfterAuth(params, "/start"), { replace: true });
        } else setVerifyError("Invalid or expired code");
      });
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const ok = await resendCode(email);
    if (ok) setResendCooldown(60);
  };

  const handleGoogle = () => {
    window.location.href = "/api/auth/google";
  };
  const handleGithub = () => {
    window.location.href = "/api/auth/github";
  };

  const switchToSignup = () => {
    setMode("signup");
    setStep("email");
  };
  const switchToWaitlist = () => {
    setMode("waitlist");
    setWaitlistDone(false);
  };

  // ── Render form ──
  const renderForm = () => {
    // ── Waitlist mode ──
    if (mode === "waitlist") {
      if (waitlistDone) {
        return (
          <>
            <h1 className="auth-heading">You're on the list</h1>
            <p className="auth-subheading">{waitlistMsg}</p>
            <p className="auth-subheading auth-subheading-last">
              We'll reach out when your spot is ready.
            </p>
            <p className="auth-switch">
              Have an invite code?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  switchToSignup();
                }}
              >
                Sign up
              </a>
            </p>
          </>
        );
      }
      return (
        <>
          <h1 className="auth-heading">Get early access</h1>
          <p className="auth-subheading">Unlock the agent economy.</p>
          <form className="auth-form" onSubmit={handleWaitlistSubmit}>
            <Input
              size="lg"
              type="email"
              placeholder="Email address"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0,0,0,0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            />
            <Button
              variant="primary"
              size="lg"
              type="submit"
              fullWidth
              disabled={!email.trim() || loading}
            >
              Join waitlist
            </Button>
          </form>
          <p className="waitlist-hint">Early supporters get 10% off their first month.</p>
          <p className="auth-switch">
            Have an invite code?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                switchToSignup();
              }}
            >
              Sign up
            </a>
          </p>
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </>
      );
    }

    // ── Signup: email + password (step 1) ──
    if (step === "email") {
      return (
        <>
          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-subheading">
            {templateLabel ? (
              <>
                Launch a <strong>{templateLabel}</strong> powered by AI agents
              </>
            ) : (
              "Start a company in minutes."
            )}
          </p>
          <form className="auth-form" onSubmit={handleCredentialsContinue} autoComplete="on">
            <Input
              size="lg"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="Email address"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <PasswordInput
              placeholder="Password (8+ characters)"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                useAuthStore.setState({ error: null });
              }}
            />
            <Button
              variant="primary"
              size="lg"
              type="submit"
              fullWidth
              disabled={!email.trim() || password.length < 8}
            >
              Continue
            </Button>
          </form>
          {(googleOAuth || githubOAuth) && (
            <>
              <div className="auth-oauth-recess">
                <p className="auth-oauth-recess-label">Or</p>
                <div className="auth-oauth-group">
                  {(googleOAuth || githubOAuth) && (
                    <div className="auth-oauth-row">
                      {googleOAuth && (
                        <Button
                          variant="secondary"
                          size="lg"
                          fullWidth
                          onClick={handleGoogle}
                          type="button"
                        >
                          <GoogleIcon /> Google
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
                          <GitHubIcon /> GitHub
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="auth-oauth-row">
                    <ConnectWalletButton
                      onAuthenticated={() =>
                        navigate(getRedirectAfterAuth(params, "/start"), { replace: true })
                      }
                    />
                    <ContinueWithPasskeyButton
                      onAuthenticated={() =>
                        navigate(getRedirectAfterAuth(params, "/start"), { replace: true })
                      }
                    />
                  </div>
                </div>
              </div>
            </>
          )}
          {waitlist && (
            <p className="auth-switch">
              No invite code?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  switchToWaitlist();
                }}
              >
                Join the waitlist
              </a>
            </p>
          )}
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </>
      );
    }

    // ── Signup: name + invite code (step 2, submits) ──
    if (step === "info") {
      return (
        <>
          <h1 className="auth-heading">Your details</h1>
          <p className="auth-subheading">{email}</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-name-row">
              <Input
                size="lg"
                type="text"
                placeholder="First name"
                aria-label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
              />
              <Input
                size="lg"
                type="text"
                placeholder="Last name"
                aria-label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            {waitlist && (
              <Input
                size="lg"
                type="text"
                placeholder="Invite code"
                aria-label="Invite code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            )}
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
              disabled={
                loading || !firstName.trim() || !lastName.trim() || (waitlist && !inviteCode.trim())
              }
            >
              Create account
            </Button>
          </form>
          <p className="auth-switch">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setStep("email");
              }}
            >
              Back
            </a>
          </p>
        </>
      );
    }

    // ── Signup: verify ──
    if (step === "verify") {
      return (
        <>
          <h1 className="auth-heading">Verify your email</h1>
          <p className="auth-subheading">
            We sent a 6-digit code to <strong className="auth-email-highlight">{email}</strong>
          </p>
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
          {verifyLoading && (
            <p className="auth-subheading auth-verifying">
              <Spinner size="sm" />
              Verifying…
            </p>
          )}
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
      );
    }

    return null;
  };

  return (
    <main className="signup-split">
      <div className="signup-form-side">
        <div className="auth-container" role="region" aria-live="polite">
          <div className="auth-logo">
            <Wordmark size={36} />
          </div>
          {renderForm()}
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
        </div>
      </div>

      <div className="signup-pitch-side">
        <div className="signup-pitch-content">
          <h2 className="signup-pitch-heading">Start something that can work without you.</h2>
          <p className="signup-lead">
            Build companies where humans set direction. Agents turn context into execution.
          </p>
          <p className="signup-trust">Open source · Self-hostable · Free to start</p>
        </div>
      </div>
    </main>
  );
}
