import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Landmark, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Wordmark from "@/components/Wordmark";
import { Banner, Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { goExternal } from "@/lib/navigation";
import { LAUNCH_PLANS, type LaunchPlanId } from "@/lib/pricing";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import "@/styles/onboarding.css";

type PathId = "free" | "paid";

const STEPS = [{ label: "Name" }, { label: "Trust" }, { label: "Operations" }] as const;

const PATHS: Array<{ id: PathId; label: string; detail: string }> = [
  {
    id: "free",
    label: "Keep it free",
    detail: "Personal TRUST only. Add operations later when you are ready.",
  },
  {
    id: "paid",
    label: "Add operations",
    detail: "Provision agents, quests, events, and memory for this TRUST.",
  },
];

function splitName(value: string): { first: string; last: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function displayFirstName(first: string, fallback: string): string {
  return first.trim() || splitName(fallback).first || "My";
}

function planWireLabel(id: LaunchPlanId): "standard" | "pro" {
  return id === "growth" ? "pro" : "standard";
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);

  const userDefault = useMemo(() => user?.name?.trim() || user?.email?.split("@")[0] || "", [user]);
  const initialName = useMemo(() => splitName(userDefault), [userDefault]);
  const [step, setStep] = useState(0);
  const [first, setFirst] = useState(initialName.first);
  const [last, setLast] = useState(initialName.last);
  const [trustName, setTrustName] = useState("");
  const [path, setPath] = useState<PathId>("free");
  const [plan, setPlan] = useState<LaunchPlanId>("growth");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingTrust = entities[0] ?? null;

  useEffect(() => {
    document.title = "aeqi";
    void fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    if (!first && initialName.first) setFirst(initialName.first);
    if (!last && initialName.last) setLast(initialName.last);
  }, [first, initialName.first, initialName.last, last]);

  useEffect(() => {
    if (trustName) return;
    if (existingTrust?.name) {
      setTrustName(existingTrust.name);
      return;
    }
    setTrustName(`${displayFirstName(first, userDefault)}'s Personal Trust`);
  }, [existingTrust?.name, first, trustName, userDefault]);

  const selectedPlan = LAUNCH_PLANS.find((item) => item.id === plan) ?? LAUNCH_PLANS[0];
  const fullName = [first.trim(), last.trim()].filter(Boolean).join(" ");
  const canContinueName = first.trim().length > 1 && last.trim().length > 1;
  const canContinueTrust = trustName.trim().length > 1;
  const canSubmit = canContinueName && canContinueTrust;
  const stepValid = step === 0 ? canContinueName : step === 1 ? canContinueTrust : canSubmit;

  const nextStep = () => {
    if (!stepValid) return;
    setError(null);
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const previousStep = () => {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  };

  const finish = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.updateProfile(first.trim(), last.trim(), "").catch(() => undefined);

      let trustId = existingTrust?.id ?? "";
      if (trustId) {
        await api.updateEntity(trustId, {
          name: trustName.trim(),
          tagline: "Personal TRUST",
        });
      } else {
        const created = await api.createPersonalTrust({
          name: trustName.trim(),
          owner_name: fullName,
          goal: "personal",
          tagline: "Personal TRUST",
        });
        trustId = created.trust?.id || created.id;
      }
      if (!trustId) throw new Error("The trust was created without an id.");

      setActiveEntity(trustId);
      await Promise.all([fetchEntities(), fetchMe()]);

      if (path === "paid") {
        const { url } = await api.provisionRuntime({
          trust_id: trustId,
          plan: planWireLabel(plan),
        });
        goExternal(url);
        return;
      }

      const refreshed = useDaemonStore.getState().entities.find((entity) => entity.id === trustId);
      if (refreshed?.trust_address) {
        navigate(`/trust/${encodeURIComponent(refreshed.trust_address)}`, { replace: true });
      } else {
        navigate("/trust", { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create your personal trust.");
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < STEPS.length - 1) {
      nextStep();
      return;
    }
    void finish();
  };

  return (
    <main className="signup-split onboarding-split">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="signup-pitch-side onboarding-pitch-side" aria-hidden="true">
        <div className="signup-pitch-scrim onboarding-pitch-scrim" />
        <div className="signup-pitch-content onboarding-pitch-content">
          <p className="signup-pitch-eyebrow">PERSONAL TRUST</p>
          <h2 className="signup-pitch-heading">
            <span>Your name.</span>
            <span>Your TRUST.</span>
            <span>Your choice.</span>
          </h2>
          <p className="signup-lead">
            Start free. Add operations only when you want agents to work.
          </p>
        </div>
      </aside>

      <div className="signup-form-side onboarding-form-side" id="main-content">
        <section className="auth-container onboarding-card" aria-labelledby="onboarding-title">
          <div className="auth-logo onboarding-logo">
            <Wordmark size={36} />
          </div>

          <div className="onboarding-step-row" aria-label="Onboarding progress">
            {STEPS.map((item, index) => (
              <span
                key={item.label}
                className={`onboarding-step-pill ${
                  index === step ? "is-current" : index < step ? "is-complete" : ""
                }`}
              >
                <span className="onboarding-step-mark" aria-hidden="true">
                  {index < step ? <Check size={12} strokeWidth={2.1} /> : index + 1}
                </span>
                <span>{item.label}</span>
              </span>
            ))}
          </div>

          {error && (
            <div className="onboarding-error">
              <Banner kind="error">{error}</Banner>
            </div>
          )}

          <form className="onboarding-wizard" onSubmit={handleSubmit}>
            {step === 0 && (
              <section className="onboarding-step-panel" aria-labelledby="onboarding-title">
                <div className="onboarding-step-icon" aria-hidden="true">
                  <UserRound size={18} strokeWidth={1.8} />
                </div>
                <h1 id="onboarding-title" className="auth-heading">
                  What should we call you?
                </h1>
                <p className="auth-subheading">
                  This is the person attached to your free personal TRUST.
                </p>
                <div className="onboarding-name-grid">
                  <Input
                    label="First name"
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                    placeholder="Ada"
                    autoComplete="given-name"
                    size="lg"
                    autoFocus
                    required
                  />
                  <Input
                    label="Last name"
                    value={last}
                    onChange={(e) => setLast(e.target.value)}
                    placeholder="Lovelace"
                    autoComplete="family-name"
                    size="lg"
                    required
                  />
                </div>
              </section>
            )}

            {step === 1 && (
              <section className="onboarding-step-panel" aria-labelledby="onboarding-title">
                <div className="onboarding-step-icon" aria-hidden="true">
                  <Landmark size={18} strokeWidth={1.8} />
                </div>
                <h1 id="onboarding-title" className="auth-heading">
                  Name your personal TRUST.
                </h1>
                <p className="auth-subheading">
                  This free TRUST can hold assets, join other TRUSTs, and launch operating TRUSTs.
                </p>
                <Input
                  label="Personal TRUST name"
                  value={trustName}
                  onChange={(e) => setTrustName(e.target.value)}
                  placeholder={`${displayFirstName(first, userDefault)}'s Personal Trust`}
                  size="lg"
                  autoFocus
                  required
                />
                <div className="onboarding-trust-preview" aria-live="polite">
                  <p className="onboarding-preview-kicker">Preview</p>
                  <p className="onboarding-preview-title">{trustName || "Personal Trust"}</p>
                  <p className="onboarding-preview-copy">{fullName || "Your name"} · Free</p>
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="onboarding-step-panel" aria-labelledby="onboarding-title">
                <div className="onboarding-step-icon" aria-hidden="true">
                  <Landmark size={18} strokeWidth={1.8} />
                </div>
                <h1 id="onboarding-title" className="auth-heading">
                  Add operations now?
                </h1>
                <p className="auth-subheading">
                  Your personal TRUST is free either way. Operations add a runtime for agents.
                </p>
                <div className="onboarding-paths">
                  {PATHS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`onboarding-path ${path === item.id ? "is-selected" : ""}`}
                      onClick={() => setPath(item.id)}
                      aria-pressed={path === item.id}
                    >
                      <span className="onboarding-path-title">{item.label}</span>
                      <span className="onboarding-path-detail">{item.detail}</span>
                    </button>
                  ))}
                </div>
                {path === "paid" && (
                  <div className="onboarding-plans" role="radiogroup" aria-label="Runtime plan">
                    {LAUNCH_PLANS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`onboarding-plan ${plan === item.id ? "is-selected" : ""}`}
                        onClick={() => setPlan(item.id)}
                        role="radio"
                        aria-checked={plan === item.id}
                      >
                        <span className="onboarding-plan-name">{item.name}</span>
                        <span className="onboarding-plan-price">
                          {item.id === "growth" ? item.dueToday : item.price}
                        </span>
                        <span className="onboarding-plan-copy">{item.intro}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            <footer className="onboarding-actions">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                disabled={step === 0 || submitting}
                onClick={previousStep}
                leadingIcon={<ArrowLeft size={15} strokeWidth={1.8} />}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={!stepValid}
                loading={submitting}
                loadingLabel="Creating"
                trailingIcon={<ArrowRight size={15} strokeWidth={1.8} />}
              >
                {step < STEPS.length - 1
                  ? "Continue"
                  : path === "paid"
                    ? `Create and pay ${selectedPlan.dueToday}`
                    : "Create free TRUST"}
              </Button>
            </footer>
          </form>
        </section>
      </div>
    </main>
  );
}
