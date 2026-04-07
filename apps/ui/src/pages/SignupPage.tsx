import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import BrandMark from "@/components/BrandMark";

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

/** Simulated agent activity for the right panel */
const ACTIVITY = [
  { agent: "riftdecks", msg: "Analyzed 3 competitor pricing pages. Found opportunity in the $20-30 range.", time: "2m ago", color: "#000" },
  { agent: "engineer", msg: "Shipped checkout redesign. 14 files changed, all tests passing.", time: "8m ago", color: "#3b82f6" },
  { agent: "researcher", msg: "Monthly report ready. Revenue up 12% vs last month.", time: "15m ago", color: "#8b5cf6" },
  { agent: "designer", msg: "New landing page mockup uploaded to Drive.", time: "22m ago", color: "#f59e0b" },
  { agent: "riftdecks", msg: "Delegating homepage update to designer based on research findings.", time: "25m ago", color: "#000" },
];

export default function SignupPage() {
  const navigate = useNavigate();
  const { loading, error, signup, googleOAuth, fetchAuthMode } = useAuthStore();

  const [step, setStep] = useState<"info" | "password">("info");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (firstName.trim() && lastName.trim() && email.trim()) setStep("password");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await signup(email, password, fullName);
    if (result === "pending" || result === "verified") navigate("/onboarding");
  };

  const handleGoogle = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="signup-split">
      {/* Left: form */}
      <div className="signup-form-side">
        <div className="auth-container">
          <div className="auth-logo"><BrandMark size={36} color="rgba(0,0,0,0.5)" /></div>
          <h1 className="auth-heading">
            {step === "info" ? "Create your account" : "Set a password"}
          </h1>
          <p className="auth-subheading">
            {step === "info" ? "Start building with autonomous agents" : email}
          </p>

          {step === "info" ? (
            <>
              <form className="auth-form" onSubmit={handleContinue}>
                <div className="auth-name-row">
                  <input
                    className="auth-input"
                    type="text"
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="auth-input"
                    type="text"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  className="auth-btn-primary"
                  type="submit"
                  disabled={!firstName.trim() || !lastName.trim() || !email.trim()}
                >
                  Continue
                </button>
              </form>

              {googleOAuth && (
                <>
                  <div className="auth-divider"><span>or</span></div>
                  <button className="auth-btn-google" onClick={handleGoogle} type="button">
                    <GoogleIcon />
                    Continue with Google
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <form className="auth-form" onSubmit={handleSubmit}>
                <input
                  className="auth-input"
                  type="password"
                  placeholder="Password (8+ characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                {error && <div className="auth-error">{error}</div>}
                <button
                  className="auth-btn-primary"
                  type="submit"
                  disabled={loading || password.length < 8}
                >
                  {loading ? "Creating account..." : "Create account"}
                </button>
              </form>
              <p className="auth-switch">
                <a href="#" onClick={(e) => { e.preventDefault(); setStep("info"); }}>Back</a>
              </p>
            </>
          )}

          <p className="auth-switch">
            Already have an account?{" "}
            <Link to="/login">Sign in</Link>
          </p>

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

      {/* Right: live activity preview */}
      <div className="signup-pitch-side">
        <div className="signup-pitch-content">
          <p className="signup-pitch-label">Your company, working right now</p>
          <div className="signup-activity">
            {ACTIVITY.map((a, i) => (
              <div key={i} className="signup-activity-item" style={{ animationDelay: `${i * 0.15}s` }}>
                <div className="signup-activity-dot" style={{ background: a.color }} />
                <div className="signup-activity-body">
                  <div className="signup-activity-header">
                    <span className="signup-activity-agent">{a.agent}</span>
                    <span className="signup-activity-time">{a.time}</span>
                  </div>
                  <p className="signup-activity-msg">{a.msg}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="signup-pitch-footer">
            <p>Agents that work, coordinate, and compound value.</p>
            <p>No prompting. No babysitting. Just results.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
