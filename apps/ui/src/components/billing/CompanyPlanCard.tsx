import { useState } from "react";
import { Link } from "react-router-dom";
import { BACKEND_PLAN_ID, PLANS, findPlan, type BillingInterval, type PlanId } from "@/lib/pricing";
import { Badge, Button, Card, type BadgeVariant } from "@/components/ui";

export type Company = {
  name: string;
  agent_id: string | null;
  plan: "launch" | "scale" | "free";
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "free";
  next_charge_at: string | null;
};

interface CompanyPlanCardProps {
  company: Company;
  actionPending: string | null;
  onSubscribe: (rootSlug: string, plan: PlanId, interval: BillingInterval) => void;
  onPortal: () => void;
  /** Hide the "Open Company →" link — useful when the card already
   *  lives inside that Company's surface (e.g. agent plan tab). */
  hideOpenLink?: boolean;
}

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
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Per-Company plan card — used both inside the user-level
 * `/settings/billing` rollup (one per Company) and inside the agent's
 * own `/{agentId}/settings/plan` tab (just the one for this Company).
 *
 * The whole upgrade ceremony lives in here: status badges, "Manage in
 * portal" for paid plans, an inline expandable plan picker for Free
 * plans. Keeps both surfaces in lockstep visually + behaviorally.
 */
export function CompanyPlanCard({
  company,
  actionPending,
  onSubscribe,
  onPortal,
  hideOpenLink = false,
}: CompanyPlanCardProps) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const planBadge = PLAN_BADGE[company.plan];
  const statusBadge = STATUS_BADGE[company.status];
  const showStatus =
    company.status !== "active" && company.status !== "free" && company.status !== "trialing";

  return (
    <Card variant="surface" padding="md" className="billing-company" role="listitem">
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
            <Button variant="primary" size="sm" onClick={() => setUpgradeOpen((v) => !v)}>
              {upgradeOpen ? "Cancel" : "Upgrade →"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPortal}
              loading={actionPending === "portal"}
            >
              Manage →
            </Button>
          )}
          {!hideOpenLink && (
            <Link
              to={`/${encodeURIComponent(company.name)}/sessions`}
              className="billing-company-open"
            >
              Open Company →
            </Link>
          )}
        </div>
      </div>

      {upgradeOpen && (
        <UpgradeSelector
          rootSlug={company.name}
          actionPending={actionPending}
          onSubscribe={onSubscribe}
        />
      )}
    </Card>
  );
}

interface UpgradeSelectorProps {
  rootSlug: string;
  actionPending: string | null;
  onSubscribe: (rootSlug: string, plan: PlanId, interval: BillingInterval) => void;
}

export function UpgradeSelector({ rootSlug, actionPending, onSubscribe }: UpgradeSelectorProps) {
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
