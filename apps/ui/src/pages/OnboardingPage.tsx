import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const AGENT_TEMPLATES = [
  { name: "Engineer", desc: "Writes code, reviews PRs, fixes bugs", template: "agents/engineer" },
  { name: "Researcher", desc: "Gathers context, compares options, synthesizes findings", template: "agents/researcher" },
  { name: "Designer", desc: "UI/UX, dashboards, landing pages, visual polish", template: "agents/designer" },
  { name: "Reviewer", desc: "Catches regressions, verifies quality, blocks bad merges", template: "agents/reviewer" },
];

const TOTAL_STEPS = 4;

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { pendingEmail, verifyEmail, resendCode, fetchMe } = useAuthStore();
  const [step, setStep] = useState(1);
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Verification code state
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const email = pendingEmail || localStorage.getItem("aeqi_pending_email") || "";

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleCreateCompany = async () => {
    if (!companyName.trim() || loading) return;
    setLoading(true);
    setError("");
    try {
      await api.createCompany({ name: companyName.trim(), tagline: tagline.trim() || undefined });
      setStep(2);
    } catch (e: any) {
      setError(e?.message || "Failed to create company");
    }
    setLoading(false);
  };

  const handleHireAgent = async () => {
    if (loading) return;
    setLoading(true);
    if (selectedAgent) {
      try {
        await api.spawnAgent({ template: selectedAgent, project: companyName.trim() });
      } catch { /* non-critical */ }
    }
    await fetchMe();
    // If there's a pending email, go to verify step. Otherwise skip to done.
    setStep(email ? 3 : 4);
    setLoading(false);
  };

  // Verification handlers
  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();

    const full = next.join("");
    if (full.length === 6) {
      setLoading(true);
      setError("");
      verifyEmail(email, full).then((ok) => {
        setLoading(false);
        if (ok) {
          localStorage.removeItem("aeqi_pending_email");
          setStep(4);
        } else {
          setError("Invalid or expired code");
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
      setLoading(true);
      setError("");
      verifyEmail(email, text).then((ok) => {
        setLoading(false);
        if (ok) {
          localStorage.removeItem("aeqi_pending_email");
          setStep(4);
        } else {
          setError("Invalid or expired code");
        }
      });
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const ok = await resendCode(email);
    if (ok) setResendCooldown(60);
  };

  const handleFinish = () => {
    navigate("/", { replace: true });
  };

  return (
    <div className="auth-page">
      <div className="auth-container" style={{ maxWidth: 420 }}>
        {/* Progress dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 40 }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <div
              key={s}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: s <= step ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.1)",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>

        {/* Step 1: Create company */}
        {step === 1 && (
          <>
            <h1 className="auth-heading">Create your company</h1>
            <p className="auth-subheading">A company is a workspace where your agents operate.</p>
            <div className="auth-form">
              <input
                className="auth-input"
                type="text"
                placeholder="Company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && companyName.trim()) handleCreateCompany(); }}
                autoFocus
              />
              <input
                className="auth-input"
                type="text"
                placeholder="Tagline (optional)"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && companyName.trim()) handleCreateCompany(); }}
              />
              {error && <div className="auth-error">{error}</div>}
              <button
                className="auth-btn-primary"
                onClick={handleCreateCompany}
                disabled={!companyName.trim() || loading}
              >
                {loading ? "Creating..." : "Continue"}
              </button>
            </div>
          </>
        )}

        {/* Step 2: Hire agent */}
        {step === 2 && (
          <>
            <h1 className="auth-heading">Hire your first agent</h1>
            <p className="auth-subheading">Pick a role to get started. You can add more later.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
              {AGENT_TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setSelectedAgent(selectedAgent === t.template ? null : t.template)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: "14px 16px",
                    background: selectedAgent === t.template ? "rgba(0,0,0,0.04)" : "transparent",
                    border: `1px solid ${selectedAgent === t.template ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.08)"}`,
                    borderRadius: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 500, color: "rgba(0,0,0,0.85)" }}>{t.name}</span>
                  <span style={{ fontSize: 12, color: "rgba(0,0,0,0.4)" }}>{t.desc}</span>
                </button>
              ))}
            </div>
            <button
              className="auth-btn-primary"
              onClick={handleHireAgent}
              disabled={loading}
            >
              {loading ? "Setting up..." : selectedAgent ? "Hire & continue" : "Skip for now"}
            </button>
          </>
        )}

        {/* Step 3: Verify email */}
        {step === 3 && (
          <>
            <h1 className="auth-heading">Verify your email</h1>
            <p className="auth-subheading">
              Enter the 6-digit code sent to <strong style={{ color: "rgba(0,0,0,0.7)" }}>{email}</strong>
            </p>
            <div className="verify-code-inputs" onPaste={handlePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  className="verify-code-digit"
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            {error && <div className="auth-error">{error}</div>}
            {loading && <p className="auth-subheading">Verifying...</p>}
            <p className="auth-switch" style={{ marginTop: 24 }}>
              Didn't get the code?{" "}
              {resendCooldown > 0 ? (
                <span style={{ color: "rgba(0,0,0,0.3)" }}>Resend in {resendCooldown}s</span>
              ) : (
                <a href="#" onClick={(e) => { e.preventDefault(); handleResend(); }}>Resend code</a>
              )}
            </p>
          </>
        )}

        {/* Step 4: Done */}
        {step === 4 && (
          <>
            <svg width="64" height="64" viewBox="0 0 64 64" style={{ margin: "0 auto 24px", display: "block" }}>
              <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="2" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(34,197,94,0.8)" strokeWidth="2.5"
                strokeDasharray="176" strokeDashoffset="176" strokeLinecap="round"
                style={{ animation: "draw-circle 0.6s ease-out 0.2s forwards" }} />
              <path d="M22 33l6 6 14-14" fill="none" stroke="rgba(34,197,94,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="40" strokeDashoffset="40"
                style={{ animation: "draw-check 0.4s ease-out 0.7s forwards" }} />
            </svg>
            <h1 className="auth-heading">{companyName || "Your company"} is live</h1>
            <div style={{ display: "flex", justifyContent: "center", gap: 32, margin: "20px 0 28px" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: "rgba(0,0,0,0.85)" }}>{selectedAgent ? "1" : "0"}</div>
                <div style={{ fontSize: 11, color: "rgba(0,0,0,0.3)", marginTop: 2 }}>agents</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: "rgba(0,0,0,0.85)" }}>0</div>
                <div style={{ fontSize: 11, color: "rgba(0,0,0,0.3)", marginTop: 2 }}>quests</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: "rgba(0,0,0,0.85)" }}>ready</div>
                <div style={{ fontSize: 11, color: "rgba(0,0,0,0.3)", marginTop: 2 }}>status</div>
              </div>
            </div>
            <button className="auth-btn-primary" onClick={handleFinish}>
              Get started
            </button>
          </>
        )}
      </div>
    </div>
  );
}
