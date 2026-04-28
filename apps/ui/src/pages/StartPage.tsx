import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { DEFAULT_TEMPLATE_SLUG, FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate, User } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Button, Spinner } from "@/components/ui";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { PLANS, type BillingInterval, type Feature, type PlanId } from "@/lib/pricing";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";
import "@/styles/start.css";

type SpawnBlueprintResponse = Awaited<ReturnType<typeof api.spawnBlueprint>>;

function entityIdFromSpawn(resp: SpawnBlueprintResponse): string {
  return resp.entity_id || resp.root_agent_id || "";
}

/**
 * `/start` — the single place a Company is created.
 *
 * Loads the chosen Blueprint (`?blueprint=:slug`) or the operator-configured
 * default and renders a focused launch surface: blueprint preview header,
 * monthly/annual interval toggle, and a three-card plan picker (Free /
 * Launch / Scale). The Company name is auto-derived from the Blueprint
 * (server creates an immutable entity id); the user renames in Settings later.
 *
 * Flow:
 * - Free → POST /api/blueprints/spawn and navigate by the returned entity id.
 * - Paid → POST /api/billing/checkout for a Stripe Checkout session and
 *   redirect to the returned URL. On success Stripe sends the user back
 *   to /account/billing?spawn=:slug&plan=:id where the billing track
 *   completes the spawn.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);

  const slug = searchParams.get("blueprint") || "";
  const [template, setTemplate] = useState<CompanyTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<PlanId | "free" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [hasPaidPlan, setHasPaidPlan] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  const isAuthed = authMode === "none" || !!token;

  useEffect(() => {
    document.title = "Start a Company · aeqi";
  }, []);

  // Resolve the Blueprint — either ?blueprint=:slug or the default.
  // Falls back to bundled fixtures so the page still renders for
  // unauthed/offline visitors.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const fetcher = slug ? api.getBlueprint(slug) : api.getDefaultBlueprint();
    fetcher
      .then((resp) => {
        if (cancelled) return;
        const tpl = (resp as { template?: CompanyTemplate })?.template;
        if (tpl) {
          setTemplate(tpl);
        } else {
          const fallback = FALLBACK_TEMPLATES.find(
            (t) => t.slug === (slug || DEFAULT_TEMPLATE_SLUG),
          );
          setTemplate(fallback ?? null);
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        const fallback = FALLBACK_TEMPLATES.find((t) => t.slug === (slug || DEFAULT_TEMPLATE_SLUG));
        if (fallback) {
          setTemplate(fallback);
          setLoadError(e.message || "Could not reach the Blueprint store.");
        } else {
          setLoadError(e.message || "Blueprint not found.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Resolve the user's trial-slot status. Only fires when there's a real
  // account; auth mode "none" treats every spawn as free.
  useEffect(() => {
    if (!token || authMode === "none") {
      setTrialUsed(false);
      setHasPaidPlan(false);
      return;
    }
    let cancelled = false;
    api
      .getMe()
      .then((me) => {
        if (cancelled) return;
        const u = me as Partial<User>;
        setTrialUsed(!!u.free_company_used_at);
        setHasPaidPlan(!!u.subscription_status && u.subscription_status !== "none");
      })
      .catch(() => {
        // Non-fatal — fall through assuming the slot is free; the server
        // enforces the cap on POST regardless.
      });
    return () => {
      cancelled = true;
    };
  }, [token, authMode]);

  // Reset error when blueprint changes.
  useEffect(() => {
    setSubmitError(null);
  }, [template?.slug]);

  const handleLaunch = useCallback(
    async (planId: PlanId | "free", chosenInterval: BillingInterval) => {
      if (!template) return;
      if (!isAuthed) {
        const next = `/start${slug ? `?blueprint=${encodeURIComponent(slug)}` : ""}`;
        navigate(`/signup?next=${encodeURIComponent(next)}`);
        return;
      }
      setSubmitError(null);

      if (planId === "free") {
        if (trialUsed) {
          setSubmitError("Free Company already used. Pick Launch or Scale to spawn another.");
          return;
        }
        setSubmitting("free");
        try {
          const resp = await api.spawnBlueprint({
            blueprint: template.slug,
            name: template.name,
          });
          const entityId = entityIdFromSpawn(resp);
          if (!entityId) throw new Error("Launch returned no entity id.");
          setActiveEntity(entityId);
          await Promise.all([fetchAgents(), fetchEntities()]);
          navigate(`/${encodeURIComponent(entityId)}/sessions`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Could not launch the Company.";
          setSubmitError(msg);
          setSubmitting(null);
        }
        return;
      }

      // Paid: hand off to Stripe Checkout. On success Stripe redirects to
      // /settings/billing?spawn=:slug&plan=:id where the billing route
      // completes the spawn against the now-paid subscription.
      setSubmitting(planId);
      try {
        const { url } = await api.createCheckoutSession({
          plan: planId,
          interval: chosenInterval,
          blueprint: template.slug,
          root_slug: template.slug,
        });
        if (!url) throw new Error("Checkout session returned no URL.");
        window.location.href = url;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Could not start checkout.";
        setSubmitError(msg);
        setSubmitting(null);
      }
    },
    [template, isAuthed, slug, navigate, trialUsed, setActiveEntity, fetchAgents, fetchEntities],
  );

  if (loading && !template) {
    return (
      <div className="start-page">
        <div className="start-loading">
          <Spinner size="sm" /> Loading Blueprint…
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="start-page">
        <div className="start-missing">
          <p className="start-missing-title">Blueprint not found.</p>
          <p className="start-missing-sub">
            {loadError || "We couldn't find that Blueprint."}{" "}
            <Link to="/blueprints">Browse the catalog →</Link>
          </p>
        </div>
      </div>
    );
  }

  const showTrialBanner = isAuthed && trialUsed && !hasPaidPlan;
  const isBusy = submitting !== null;

  return (
    <div className="start-page">
      <div className="start-shell">
        {/* Step 1 — context. Subtle, left-aligned, name + tagline +
            switch link. The blueprint is set; the user is here to pick
            a plan. The big editorial "Launch a Company" headline retired. */}
        <section className="start-step">
          <div className="start-step-num" aria-hidden>
            1
          </div>
          <div className="start-step-body">
            <p className="start-step-label">Blueprint</p>
            <h2 className="start-step-title">{template.name}</h2>
            {template.tagline && <p className="start-step-sub">{template.tagline}</p>}
            <Link
              to={`/blueprints?from=start${slug ? `&current=${encodeURIComponent(slug)}` : ""}`}
              className="start-switch-link"
            >
              Pick a different Blueprint →
            </Link>
            <div className="start-blueprint-preview">
              <BlueprintTreePreview template={template} />
              <BlueprintSeedCounts template={template} />
            </div>
          </div>
        </section>

        {loadError && (
          <div className="start-error" role="alert">
            {loadError} — showing the bundled copy.
          </div>
        )}

        {/* Step 2 — plan. Each plan card carries a different CTA
            treatment so the row reads as an actual choice, not three
            equally-loud black buttons:
              - Free  → ghost (low-commitment trial)
              - Launch → primary (the recommended path; popular plan)
              - Scale → outline (paid but secondary in visual weight)
            Differentiation comes from the Button variant, not bespoke
            colours. */}
        <section className="start-step">
          <div className="start-step-num" aria-hidden>
            2
          </div>
          <div className="start-step-body">
            <div className="start-step-head">
              <div>
                <p className="start-step-label">Plan</p>
                <h2 className="start-step-title">Choose your plan</h2>
              </div>
              <IntervalToggle value={interval} onChange={setInterval} disabled={isBusy} />
            </div>

            {showTrialBanner && (
              <p className="start-trial-banner" role="status">
                You've used your one Free Company. Pick a paid plan below — each Company runs on its
                own subscription.
              </p>
            )}

            {submitError && (
              <div className="start-error" role="alert">
                {submitError}
              </div>
            )}

            <div className="start-plans" aria-label="Pricing plans">
              <FreePlanCard
                trialUsed={trialUsed}
                isAuthed={isAuthed}
                submitting={submitting === "free"}
                disabled={isBusy && submitting !== "free"}
                onLaunch={() => handleLaunch("free", interval)}
              />

              {PLANS.map((plan) => (
                <PaidPlanCard
                  key={plan.id}
                  planId={plan.id}
                  name={plan.name}
                  desc={plan.desc}
                  monthlyPrice={plan.price}
                  annualPrice={plan.annualPrice}
                  popular={plan.popular}
                  features={plan.features}
                  interval={interval}
                  isAuthed={isAuthed}
                  submitting={submitting === plan.id}
                  disabled={isBusy && submitting !== plan.id}
                  onLaunch={() => handleLaunch(plan.id, interval)}
                />
              ))}
            </div>

            <p className="start-plans-foot">
              Each Company runs on its own subscription. Cancel any time from Settings → Billing.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Interval toggle ───────────────────────────────────────────── */

function IntervalToggle({
  value,
  onChange,
  disabled,
}: {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
  disabled?: boolean;
}) {
  return (
    <div className="start-interval-toggle" role="radiogroup" aria-label="Billing interval">
      <button
        type="button"
        role="radio"
        aria-checked={value === "monthly"}
        className={`start-interval-toggle-pill${value === "monthly" ? " is-active" : ""}`}
        onClick={() => onChange("monthly")}
        disabled={disabled}
      >
        Monthly
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "annual"}
        className={`start-interval-toggle-pill${value === "annual" ? " is-active" : ""}`}
        onClick={() => onChange("annual")}
        disabled={disabled}
      >
        Annual <span className="start-interval-save">· save ~15%</span>
      </button>
    </div>
  );
}

/* ── Free plan card ────────────────────────────────────────────── */

function FreePlanCard({
  trialUsed,
  isAuthed,
  submitting,
  disabled,
  onLaunch,
}: {
  trialUsed: boolean;
  isAuthed: boolean;
  submitting: boolean;
  disabled: boolean;
  onLaunch: () => void;
}) {
  const locked = isAuthed && trialUsed;
  const cta = locked
    ? "Free trial used"
    : submitting
      ? "Launching…"
      : isAuthed
        ? "Launch Free →"
        : "Sign up to launch →";

  return (
    <article className="start-plan-card start-plan-free">
      <header className="start-plan-head">
        <p className="start-plan-eyebrow">Free trial · once per account</p>
        <h3 className="start-plan-name">Free</h3>
        <p className="start-plan-price">
          <span className="start-plan-price-amount">$0</span>
        </p>
        <p className="start-plan-desc">
          Your first Company on us. 500k tokens, full features, no credit card.
        </p>
      </header>

      <ul className="start-plan-features">
        <li>1 Company</li>
        <li>500k tokens</li>
        <li>All Blueprints</li>
        <li>Full feature access</li>
      </ul>

      <div className="start-plan-cta">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          loading={submitting}
          disabled={disabled || locked || submitting}
          onClick={onLaunch}
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              {cta}
            </>
          ) : (
            cta
          )}
        </Button>
        {locked && (
          <p className="start-plan-cta-note">Pick a paid plan to launch another Company.</p>
        )}
      </div>
    </article>
  );
}

/* ── Paid plan card ────────────────────────────────────────────── */

function PaidPlanCard({
  planId,
  name,
  desc,
  monthlyPrice,
  annualPrice,
  popular,
  features,
  interval,
  isAuthed,
  submitting,
  disabled,
  onLaunch,
}: {
  planId: PlanId;
  name: string;
  desc: string;
  monthlyPrice: number;
  annualPrice: number;
  popular: boolean;
  features: readonly Feature[];
  interval: BillingInterval;
  isAuthed: boolean;
  submitting: boolean;
  disabled: boolean;
  onLaunch: () => void;
}) {
  const price = interval === "annual" ? annualPrice : monthlyPrice;
  const eyebrow =
    planId === "launch" ? "Per Company · most popular" : "Per Company · for serious operators";
  const cta = submitting
    ? "Redirecting…"
    : isAuthed
      ? "Subscribe & Launch →"
      : "Sign up to subscribe →";

  return (
    <article className={`start-plan-card start-plan-paid${popular ? " start-plan-popular" : ""}`}>
      {popular && <span className="start-plan-badge">Most popular</span>}

      <header className="start-plan-head">
        <p className="start-plan-eyebrow">{eyebrow}</p>
        <h3 className="start-plan-name">{name}</h3>
        <p className="start-plan-price">
          <span className="start-plan-price-amount">${price}</span>
          <span className="start-plan-price-unit">/mo</span>
          {interval === "annual" && (
            <span className="start-plan-price-strike">${monthlyPrice}</span>
          )}
        </p>
        <p className="start-plan-desc">{desc}</p>
      </header>

      <ul className="start-plan-features">
        {features.map((f, i) => (
          <li
            key={i}
            className={`${f.highlight ? "is-highlight" : ""}${f.soon ? " is-soon" : ""}`.trim()}
          >
            <span className="start-plan-feature-dot" aria-hidden="true">
              {f.highlight ? "★" : "•"}
            </span>
            <span>
              {f.text}
              {f.soon && <span className="start-plan-soon"> · soon</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="start-plan-cta">
        <Button
          type="button"
          variant={popular ? "primary" : "secondary"}
          size="lg"
          loading={submitting}
          disabled={disabled || submitting}
          onClick={onLaunch}
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              {cta}
            </>
          ) : (
            cta
          )}
        </Button>
      </div>
    </article>
  );
}
