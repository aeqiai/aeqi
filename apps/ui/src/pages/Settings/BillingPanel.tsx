import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import {
  BACKEND_PLAN_ID,
  PLANS,
  findPlan,
  formatCents,
  type BillingInterval,
  type PlanId,
} from "@/lib/pricing";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Badge, Button, Card, Spinner, type BadgeVariant } from "@/components/ui";
import "@/styles/billing.css";

type Company = {
  name: string;
  agent_id: string | null;
  plan: "launch" | "scale" | "free";
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "free";
  next_charge_at: string | null;
};

type Overview = {
  ok: boolean;
  total_monthly_cents: number;
  total_annual_cents: number;
  currency: string;
  payment_method_last4: string | null;
  companies: Company[];
};

type SpawnState = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string };

const PLAN_BADGE: Record<Company["plan"], { variant: BadgeVariant; label: string }> = {
  free: { variant: "neutral", label: "Free" },
  launch: { variant: "info", label: "Launch" },
  scale: { variant: "success", label: "Scale" },
};

const STATUS_BADGE: Record<Company["status"], { variant: BadgeVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  trialing: { variant: "info", label: "Trialing" },
  past_due: { variant: "warning", label: "Past due" },
  canceled: { variant: "error", label: "Canceled" },
  free: { variant: "neutral", label: "Free" },
};

function formatNextCharge(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * `/settings/billing` — user-level rollup of every Company subscription
 * the user owns, plus per-Company actions (upgrade Free, manage paid via
 * Stripe customer portal). Also handles the post-Checkout spawn-completion
 * flow when Stripe redirects back here with `?spawn=&plan=&blueprint=`.
 */
export default function BillingPanel() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openUpgradeFor, setOpenUpgradeFor] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [spawn, setSpawn] = useState<SpawnState>({ kind: "idle" });

  const spawnHandled = useRef(false);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getBillingOverview()
      .then((data) => setOverview(data))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load billing overview."),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Stripe Checkout success handler: when the URL carries
  // ?spawn=:slug&plan=:id&blueprint=:bp, finish the spawn here (Stripe
  // can only redirect to one URL, and the per-Company billing surface
  // is the natural landing). Fires once per mount, then strips the
  // params so a refresh doesn't re-trigger.
  useEffect(() => {
    if (spawnHandled.current) return;
    const slug = searchParams.get("spawn");
    const planParam = searchParams.get("plan");
    const blueprint = searchParams.get("blueprint");
    if (!slug || !planParam || !blueprint) return;
    spawnHandled.current = true;
    setSpawn({ kind: "running" });
    api
      .launchStart({ template: blueprint, name: slug })
      .then((resp) => {
        const root = (resp as { root?: string })?.root || slug;
        setActiveRoot(root);
        return fetchAgents().then(() => {
          // Clear params before navigating away so the user's history
          // doesn't carry the success token across page changes.
          setSearchParams(new URLSearchParams(), { replace: true });
          navigate(`/${encodeURIComponent(root)}/sessions`);
        });
      })
      .catch(() => {
        setSpawn({
          kind: "error",
          message: "Payment received but Company couldn't spawn. Email support@aeqi.ai for help.",
        });
        // Strip params so a refresh doesn't try to spawn again.
        setSearchParams(new URLSearchParams(), { replace: true });
      });
  }, [searchParams, setSearchParams, navigate, fetchAgents, setActiveRoot]);

  const totalLabel = useMemo(() => {
    if (!overview) return "";
    return formatCents(overview.total_monthly_cents, overview.currency);
  }, [overview]);

  const handlePortal = useCallback(async () => {
    setActionPending("portal");
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not open the Stripe portal.");
      setActionPending(null);
    }
  }, []);

  const handleSubscribe = useCallback(
    async (rootSlug: string, plan: PlanId, interval: BillingInterval) => {
      const key = `subscribe:${rootSlug}:${plan}`;
      setActionPending(key);
      try {
        const { url } = await api.createCheckoutSession({
          plan,
          interval,
          root_slug: rootSlug,
        });
        window.location.href = url;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not start Checkout.");
        setActionPending(null);
      }
    },
    [],
  );

  if (spawn.kind === "running") {
    return (
      <div className="billing-spawn">
        <Spinner size="sm" />
        <span>Provisioning your Company…</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="billing-loading">
        <Spinner size="sm" />
        <span>Loading billing…</span>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="billing-error" role="alert">
        <p>{error}</p>
        <Button variant="primary" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  if (!overview) return null;

  const last4 = overview.payment_method_last4;
  const companies = overview.companies;

  return (
    <div className="billing-panel">
      {spawn.kind === "error" && (
        <div className="account-feedback account-feedback-error" role="alert">
          {spawn.message}
        </div>
      )}

      <Card padding="lg" className="billing-summary">
        <div className="billing-summary-main">
          <p className="billing-eyebrow">Total spend</p>
          <div className="billing-total">
            <span className="billing-total-amount">{totalLabel}</span>
            <span className="billing-total-suffix">/month</span>
          </div>
          <p className="billing-summary-sub">
            across {companies.length} {companies.length === 1 ? "Company" : "Companies"}
          </p>
        </div>
        <div className="billing-summary-aside">
          {last4 ? (
            <>
              <span className="billing-pm-label">Card</span>
              <span className="billing-pm-value">·· {last4}</span>
            </>
          ) : (
            <span className="billing-pm-empty">No payment method on file</span>
          )}
          <button
            type="button"
            className="billing-link"
            onClick={handlePortal}
            disabled={actionPending === "portal"}
          >
            {last4 ? "Update payment method →" : "Add payment method →"}
          </button>
        </div>
      </Card>

      {companies.length === 0 ? (
        <div className="billing-empty">
          <h3 className="billing-empty-title">No Companies yet</h3>
          <p className="billing-empty-sub">Launch your first Company to get started.</p>
          <Link to="/start" className="billing-empty-cta">
            <Button variant="primary">Start a Company →</Button>
          </Link>
        </div>
      ) : (
        <div className="billing-companies" role="list">
          {companies.map((company) => {
            const planBadge = PLAN_BADGE[company.plan];
            const statusBadge = STATUS_BADGE[company.status];
            const showStatus =
              company.status !== "active" &&
              company.status !== "free" &&
              company.status !== "trialing";
            const upgradeOpen = openUpgradeFor === company.name;
            return (
              <Card
                key={company.name}
                variant="surface"
                padding="md"
                className="billing-company"
                role="listitem"
              >
                <div className="billing-company-row">
                  <div className="billing-company-meta">
                    <h3 className="billing-company-name">{company.name}</h3>
                    <div className="billing-company-tags">
                      <Badge variant={planBadge.variant} size="sm">
                        {planBadge.label}
                      </Badge>
                      {showStatus && (
                        <Badge variant={statusBadge.variant} size="sm" dot>
                          {statusBadge.label}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="billing-company-charge">
                    <span className="billing-company-charge-label">Next charge</span>
                    <span className="billing-company-charge-value">
                      {formatNextCharge(company.next_charge_at)}
                    </span>
                  </div>
                  <div className="billing-company-actions">
                    {company.plan === "free" ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setOpenUpgradeFor(upgradeOpen ? null : company.name)}
                      >
                        {upgradeOpen ? "Cancel" : "Upgrade →"}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handlePortal}
                        loading={actionPending === "portal"}
                      >
                        Manage →
                      </Button>
                    )}
                    <Link
                      to={`/${encodeURIComponent(company.name)}/sessions`}
                      className="billing-company-open"
                    >
                      Open Company →
                    </Link>
                  </div>
                </div>

                {upgradeOpen && (
                  <UpgradeSelector
                    rootSlug={company.name}
                    actionPending={actionPending}
                    onSubscribe={handleSubscribe}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {error && overview && (
        <div className="account-feedback account-feedback-error" role="alert">
          {error}
        </div>
      )}

      <div className="billing-footer">
        <p className="billing-footer-line">
          Manage payment methods, invoices, and tax info in your Stripe customer portal.{" "}
          <button
            type="button"
            className="billing-link"
            onClick={handlePortal}
            disabled={actionPending === "portal"}
          >
            Open Stripe portal →
          </button>
        </p>
        <p className="billing-footer-fineprint">
          Per-Company billing. Each Company runs on its own subscription.
        </p>
      </div>
    </div>
  );
}

interface UpgradeSelectorProps {
  rootSlug: string;
  actionPending: string | null;
  onSubscribe: (rootSlug: string, plan: PlanId, interval: BillingInterval) => void;
}

function UpgradeSelector({ rootSlug, actionPending, onSubscribe }: UpgradeSelectorProps) {
  const [selected, setSelected] = useState<PlanId>("launch");
  const [interval, setInterval] = useState<BillingInterval>("monthly");

  const plan = findPlan(selected);
  const monthly = interval === "annual" ? plan.annualPrice : plan.price;
  const subscribeKey = `subscribe:${rootSlug}:${selected}`;
  const submitting = actionPending === subscribeKey;

  return (
    <div className="billing-upgrade">
      <div className="billing-upgrade-plans" role="radiogroup" aria-label="Choose a plan">
        {PLANS.map((p) => {
          const isActive = selected === p.id;
          const price = interval === "annual" ? p.annualPrice : p.price;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              className={`billing-upgrade-plan${isActive ? " is-active" : ""}`}
              onClick={() => setSelected(p.id)}
            >
              <div className="billing-upgrade-plan-name">{p.name}</div>
              <div className="billing-upgrade-plan-price">
                <span>${price}</span>
                <span className="billing-upgrade-plan-suffix">/mo</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="billing-upgrade-controls">
        <label className="billing-upgrade-toggle">
          <input
            type="checkbox"
            checked={interval === "annual"}
            onChange={(e) => setInterval(e.target.checked ? "annual" : "monthly")}
          />
          <span>Annual billing (save with annual)</span>
        </label>
        <Button
          variant="primary"
          size="sm"
          loading={submitting}
          disabled={submitting}
          onClick={() => onSubscribe(rootSlug, selected, interval)}
        >
          Subscribe — ${monthly}/mo →
        </Button>
      </div>
      <p className="billing-upgrade-hint">
        You'll be sent to Stripe to confirm the {BACKEND_PLAN_ID[selected]} subscription for{" "}
        <code>{rootSlug}</code>.
      </p>
    </div>
  );
}
