import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import BrandMark from "@/components/BrandMark";

const FEATURES = [
  {
    title: "Autonomous agents",
    desc: "Agents that write code, review PRs, research, and design — running 24/7.",
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="6" r="3" /><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" /></svg>,
  },
  {
    title: "Your company is an agent",
    desc: "Launch a company that thinks, delegates, and compounds value on its own.",
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 7h12" /></svg>,
  },
  {
    title: "Real-time collaboration",
    desc: "Chat with your company, assign tasks, and watch agents work in real time.",
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h9l3 3-3 3H2z" /></svg>,
  },
  {
    title: "Built-in knowledge",
    desc: "Agents learn and remember — insights accumulate across every session.",
    icon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 2" /></svg>,
  },
];

export default function WaitlistPage() {
  const { fetchAuthMode } = useAuthStore();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchAuthMode(); }, [fetchAuthMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;
    setLoading(true);
    try {
      const resp = await api.joinWaitlist(email);
      setDone(true);
      setMsg(resp.message || "You're on the list!");
    } catch {
      setMsg("Something went wrong. Try again.");
    }
    setLoading(false);
  };

  return (
    <div className="signup-split">
      {/* Left: form */}
      <div className="signup-form-side">
        <div className="auth-container">
          <div className="auth-logo"><BrandMark size={36} color="rgba(0,0,0,0.5)" /></div>

          {!done ? (
            <>
              <h1 className="auth-heading">Get early access</h1>
              <p className="auth-subheading">Join the waitlist for autonomous company infrastructure</p>
              <form className="auth-form" onSubmit={handleSubmit}>
                <input className="auth-input" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                <button className="auth-btn-primary" type="submit" disabled={!email.trim() || loading}>
                  {loading ? "Joining..." : "Join waitlist"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="auth-heading">You're on the list</h1>
              <p className="auth-subheading">{msg}</p>
              <p className="auth-subheading" style={{ marginBottom: 0 }}>We'll reach out when your spot is ready.</p>
            </>
          )}

          <p className="auth-switch" style={{ marginTop: 20 }}>
            Have an invite code?{" "}
            <Link to="/signup">Sign up</Link>
          </p>
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

      {/* Right: pitch + book a call */}
      <div className="signup-pitch-side">
        <div className="signup-pitch-content">
          <div style={{ marginBottom: 32 }}>
            <BrandMark size={28} color="rgba(0,0,0,0.15)" />
          </div>
          <h2 className="signup-pitch-heading">Launch a company that never sleeps</h2>
          <p className="signup-pitch-sub">
            aeqi gives you autonomous agents that work together — writing code,
            researching markets, designing products, and scaling operations around the clock.
          </p>
          <div className="signup-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="signup-feature">
                <div className="signup-feature-dot">{f.icon}</div>
                <div>
                  <div className="signup-feature-title">{f.title}</div>
                  <div className="signup-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 40, paddingTop: 24, borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "rgba(0,0,0,0.5)", margin: "0 0 12px" }}>
              Want a demo or have questions?
            </p>
            <a
              href="https://booking.aeqi.ai"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 16px", background: "transparent",
                border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8,
                color: "rgba(0,0,0,0.7)", fontFamily: "var(--font-sans)",
                fontSize: 13, fontWeight: 500, textDecoration: "none",
                transition: "all 0.15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 7h12M5 1v4M11 1v4" /></svg>
              Book a call
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
