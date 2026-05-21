import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, CircleDot, Landmark, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Wordmark from "@/components/Wordmark";
import { api } from "@/lib/api";
import { goExternal } from "@/lib/navigation";
import { LAUNCH_PLANS, type LaunchPlanId } from "@/lib/pricing";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Banner, Button, Input } from "@/components/ui";
import "@/styles/onboarding.css";

type GoalId = "participate" | "create" | "join";
type PathId = "free" | "paid";

const GOALS: Array<{ id: GoalId; label: string; detail: string }> = [
  {
    id: "participate",
    label: "Participate in the economy",
    detail: "Hold assets, receive roles, and act through your own trust.",
  },
  {
    id: "create",
    label: "Create my own trust",
    detail: "Start with a personal trust, then launch operating trusts from it.",
  },
  {
    id: "join",
    label: "Join a trust",
    detail: "Use your personal trust as the identity you bring into other trusts.",
  },
];

const PATHS: Array<{ id: PathId; label: string; detail: string }> = [
  {
    id: "free",
    label: "Free personal trust",
    detail: "No agents or operations yet. You can hold assets, join trusts, and upgrade later.",
  },
  {
    id: "paid",
    label: "Add operations",
    detail: "Provision a runtime so agents can execute quests, events, and memory for this trust.",
  },
];

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || "My";
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
  const [personName, setPersonName] = useState(userDefault);
  const [trustName, setTrustName] = useState("");
  const [goal, setGoal] = useState<GoalId>("participate");
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
    if (!personName && userDefault) setPersonName(userDefault);
  }, [personName, userDefault]);

  useEffect(() => {
    if (trustName || (!personName && !userDefault)) return;
    if (existingTrust?.name) {
      setTrustName(existingTrust.name);
      return;
    }
    const base = firstName(personName || userDefault);
    setTrustName(`${base}'s Personal Trust`);
  }, [existingTrust?.name, personName, trustName, userDefault]);

  const selectedGoal = GOALS.find((item) => item.id === goal) ?? GOALS[0];
  const selectedPlan = LAUNCH_PLANS.find((item) => item.id === plan) ?? LAUNCH_PLANS[0];
  const canSubmit = personName.trim().length > 1 && trustName.trim().length > 1;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const parts = personName.trim().split(/\s+/);
      await api.updateProfile(parts[0] ?? "", parts.slice(1).join(" "), "").catch(() => undefined);

      let trustId = existingTrust?.id ?? "";
      if (trustId) {
        await api.updateEntity(trustId, {
          name: trustName.trim(),
          tagline: selectedGoal.label,
        });
      } else {
        const created = await api.createPersonalTrust({
          name: trustName.trim(),
          owner_name: personName.trim(),
          goal,
          tagline: selectedGoal.label,
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

  return (
    <main className="onboarding-page">
      <section className="onboarding-shell" aria-labelledby="onboarding-title">
        <header className="onboarding-head">
          <Wordmark size={34} />
          <div className="onboarding-head-copy">
            <h1 id="onboarding-title">Create your personal trust.</h1>
            <p>One free trust for your identity, assets, roles, and future operating trusts.</p>
          </div>
        </header>

        {error && <Banner kind="error">{error}</Banner>}

        <form className="onboarding-form" onSubmit={handleSubmit}>
          <section className="onboarding-panel" aria-label="Identity">
            <div className="onboarding-panel-head">
              <UserRound size={17} strokeWidth={1.7} aria-hidden="true" />
              <h2>Identity</h2>
            </div>
            <div className="onboarding-fields">
              <Input
                label="Your name"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                size="lg"
                required
              />
              <Input
                label="Personal trust name"
                value={trustName}
                onChange={(e) => setTrustName(e.target.value)}
                placeholder="Ada's Personal Trust"
                size="lg"
                required
              />
            </div>
          </section>

          <section className="onboarding-panel" aria-label="Goal">
            <div className="onboarding-panel-head">
              <CircleDot size={17} strokeWidth={1.7} aria-hidden="true" />
              <h2>Goal</h2>
            </div>
            <div className="onboarding-choice-grid">
              {GOALS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`onboarding-choice ${goal === item.id ? "is-selected" : ""}`}
                  onClick={() => setGoal(item.id)}
                  aria-pressed={goal === item.id}
                >
                  <span className="onboarding-choice-title">{item.label}</span>
                  <span className="onboarding-choice-detail">{item.detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="onboarding-panel" aria-label="Operations">
            <div className="onboarding-panel-head">
              <Landmark size={17} strokeWidth={1.7} aria-hidden="true" />
              <h2>Operations</h2>
            </div>
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

          <footer className="onboarding-submit">
            <div>
              <p className="onboarding-submit-title">
                {path === "paid" ? `Due today: ${selectedPlan.dueToday}` : "Due today: $0"}
              </p>
              <p className="onboarding-submit-copy">
                {path === "paid"
                  ? "Your free personal trust is created before checkout."
                  : "Runtime operations can be added later."}
              </p>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={!canSubmit}
              loading={submitting}
              loadingLabel="Creating"
              trailingIcon={<ArrowRight size={15} strokeWidth={1.8} />}
            >
              {path === "paid" ? "Create and add operations" : "Create free trust"}
            </Button>
          </footer>
        </form>
      </section>

      <aside className="onboarding-summary" aria-label="Personal trust summary">
        <div className="onboarding-summary-card">
          <span className="onboarding-summary-icon" aria-hidden="true">
            <Building2 size={24} strokeWidth={1.5} />
          </span>
          <p className="onboarding-summary-kicker">Personal trust</p>
          <h2>{trustName || "Personal Trust"}</h2>
          <p>{selectedGoal.detail}</p>
          <dl>
            <div>
              <dt>Identity</dt>
              <dd>{personName || "Person"}</dd>
            </div>
            <div>
              <dt>Trust</dt>
              <dd>Free</dd>
            </div>
            <div>
              <dt>Operations</dt>
              <dd>{path === "paid" ? selectedPlan.name : "Optional"}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </main>
  );
}
