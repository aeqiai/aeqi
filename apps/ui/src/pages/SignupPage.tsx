import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const GithubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
);

const POINTS = [
  "Agents that write code, review PRs, and ship autonomously",
  "Companies as persistent workspaces with shared memory",
  "Real-time sessions — chat with agents as they work",
  "Knowledge that compounds across every task",
];

export default function SignupPage() {
  const navigate = useNavigate();
  const { loading, error, signup, verifyEmail, resendCode, googleOAuth, githubOAuth, waitlist, fetchAuthMode } = useAuthStore();

  // When waitlist=true, default to waitlist mode. "Have an invite code?" switches to signup.
  const [mode, setMode] = useState<"waitlist" | "signup">("signup");
  const [step, setStep] = useState<"email" | "info" | "password" | "verify">("email");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [waitlistDone, setWaitlistDone] = useState(false);
  const [waitlistMsg, setWaitlistMsg] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [verifyError, setVerifyError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { fetchAuthMode(); }, [fetchAuthMode]);
  useEffect(() => { if (waitlist) setMode("waitlist"); }, [waitlist]);

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
      const resp = await api.joinWaitlist(email);
      setWaitlistDone(true);
      setWaitlistMsg(resp.message || "You're on the list!");
    } catch {
      setWaitlistMsg("Something went wrong. Try again.");
    }
  };

  // ── Signup steps ──
  const handleEmailContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) setStep("info");
  };

  const handleInfoContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (firstName.trim() && lastName.trim() && (!waitlist || inviteCode.trim())) setStep("password");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await signup(email, password, fullName, inviteCode || undefined);
    if (result === "pending") setStep("verify");
    else if (result === "verified") navigate("/", { replace: true });
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
        if (ok) { localStorage.removeItem("aeqi_pending_email"); navigate("/", { replace: true }); }
        else setVerifyError("Invalid or expired code");
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
        if (ok) { localStorage.removeItem("aeqi_pending_email"); navigate("/", { replace: true }); }
        else setVerifyError("Invalid or expired code");
      });
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const ok = await resendCode(email);
    if (ok) setResendCooldown(60);
  };

  const handleGoogle = () => { window.location.href = "/api/auth/google"; };
  const handleGithub = () => { window.location.href = "/api/auth/github"; };

  const switchToSignup = () => { setMode("signup"); setStep("email"); };
  const switchToWaitlist = () => { setMode("waitlist"); setWaitlistDone(false); };

  // ── Render form ──
  const renderForm = () => {
    // ── Waitlist mode ──
    if (mode === "waitlist") {
      if (waitlistDone) {
        return (
          <>
            <h1 className="auth-heading">You're on the list</h1>
            <p className="auth-subheading">{waitlistMsg}</p>
            <p className="auth-subheading auth-subheading-last">We'll reach out when your spot is ready.</p>
            <p className="auth-switch" >
              Have an invite code? <a href="#" onClick={(e) => { e.preventDefault(); switchToSignup(); }}>Sign up</a>
            </p>
          </>
        );
      }
      return (
        <>
          <h1 className="auth-heading">Get early access</h1>
          <p className="auth-subheading">Join the waitlist for autonomous company infrastructure</p>
          <form className="auth-form" onSubmit={handleWaitlistSubmit}>
            <input className="auth-input" type="email" placeholder="Email address" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <button className="auth-btn-primary" type="submit" disabled={!email.trim() || loading}>Join waitlist</button>
          </form>
          <p className="auth-switch" >
            Have an invite code? <a href="#" onClick={(e) => { e.preventDefault(); switchToSignup(); }}>Sign up</a>
          </p>
          <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
        </>
      );
    }

    // ── Signup: email ──
    if (step === "email") {
      return (
        <>
          <h1 className="auth-heading">Create your account</h1>
          <p className="auth-subheading">Start building with autonomous agents</p>
          <form className="auth-form" onSubmit={handleEmailContinue}>
            <input className="auth-input" type="email" placeholder="Email address" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <button className="auth-btn-primary" type="submit" disabled={!email.trim()}>Continue</button>
          </form>
          {(googleOAuth || githubOAuth) && (
            <>
              <div className="auth-divider"><span>or</span></div>
              {googleOAuth && <button className="auth-btn-oauth" onClick={handleGoogle} type="button"><GoogleIcon /> Continue with Google</button>}
              {githubOAuth && <button className="auth-btn-oauth" onClick={handleGithub} type="button" ><GithubIcon /> Continue with GitHub</button>}
            </>
          )}
          {waitlist && (
            <p className="auth-switch" >
              No invite code? <a href="#" onClick={(e) => { e.preventDefault(); switchToWaitlist(); }}>Join the waitlist</a>
            </p>
          )}
          <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
        </>
      );
    }

    // ── Signup: info ──
    if (step === "info") {
      return (
        <>
          <h1 className="auth-heading">Your details</h1>
          <p className="auth-subheading">{email}</p>
          <form className="auth-form" onSubmit={handleInfoContinue}>
            <div className="auth-name-row">
              <input className="auth-input" type="text" placeholder="First name" aria-label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
              <input className="auth-input" type="text" placeholder="Last name" aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            {waitlist && (
              <input className="auth-input auth-input-code" type="text" placeholder="Invite code" aria-label="Invite code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            )}
            <button className="auth-btn-primary" type="submit" disabled={!firstName.trim() || !lastName.trim() || (waitlist && !inviteCode.trim())}>Continue</button>
          </form>
          <p className="auth-switch"><a href="#" onClick={(e) => { e.preventDefault(); setStep("email"); }}>Back</a></p>
        </>
      );
    }

    // ── Signup: password ──
    if (step === "password") {
      return (
        <>
          <h1 className="auth-heading">Set a password</h1>
          <p className="auth-subheading">{email}</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <PasswordInput placeholder="Password (8+ characters)" value={password} onChange={(e) => { setPassword(e.target.value); useAuthStore.setState({ error: null }); }} autoFocus hasError={!!error} errorId="auth-error" />
            {error && <div className="auth-error" role="alert" id="auth-error">{error}</div>}
            <button className="auth-btn-primary" type="submit" disabled={loading || password.length < 8}>{loading ? "Creating account..." : "Create account"}</button>
          </form>
          <p className="auth-switch"><a href="#" onClick={(e) => { e.preventDefault(); setStep("info"); }}>Back</a></p>
        </>
      );
    }

    // ── Signup: verify ──
    if (step === "verify") {
      return (
        <>
          <h1 className="auth-heading">Verify your email</h1>
          <p className="auth-subheading">We sent a 6-digit code to <strong className="auth-email-highlight">{email}</strong></p>
          <div className="verify-code-inputs" onPaste={handlePaste}>
            {code.map((digit, i) => (
              <input key={i} ref={(el) => { inputRefs.current[i] = el; }} className={`verify-code-digit${verifyError ? " has-error" : ""}`} type="text" inputMode="numeric" maxLength={1} value={digit} onChange={(e) => { handleCodeChange(i, e.target.value); if (verifyError) setVerifyError(""); }} onKeyDown={(e) => handleKeyDown(i, e)} autoFocus={i === 0} />
            ))}
          </div>
          {verifyError && <div className="auth-error" role="alert">{verifyError}</div>}
          {verifyLoading && <p className="auth-subheading auth-verifying">Verifying...</p>}
          <p className="auth-switch" >
            Didn't get the code?{" "}
            {resendCooldown > 0 ? <span className="auth-cooldown">Resend in {resendCooldown}s</span> : <a href="#" onClick={(e) => { e.preventDefault(); handleResend(); }}>Resend code</a>}
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
          <div className="auth-logo"><BrandMark size={36} color="rgba(0,0,0,0.5)" /></div>
          {renderForm()}
          <div className="auth-footer">
            <p>
              By continuing, you agree to the{" "}
              <a href="https://aeqi.ai/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
              {" "}and{" "}
              <a href="https://aeqi.ai/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
          </div>
        </div>
      </div>

      <div className="signup-pitch-side">
        <div className="signup-pitch-content">
          <h2 className="signup-pitch-heading">Autonomous infrastructure for the next company</h2>
          <p className="signup-pitch-sub">
            Deploy agents that operate your company — engineering, research,
            design, operations — continuously and in parallel.
          </p>
          <ul className="signup-points">
            {POINTS.map((p) => (
              <li key={p} className="signup-point">{p}</li>
            ))}
          </ul>
          <div className="signup-cta-section">
            <a href="https://booking.aeqi.ai" target="_blank" rel="noopener noreferrer" className="signup-cta-link">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 7h12M5 1v4M11 1v4" /></svg>
              Book a call
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
