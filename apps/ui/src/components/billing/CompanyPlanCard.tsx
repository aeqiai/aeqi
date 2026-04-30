import { Link } from "react-router-dom";
import { COMPANY_MONTHLY, FOUNDER_FEE, TRIAL_DAYS } from "@/lib/pricing";
import { Badge, Button, Card, type BadgeVariant } from "@/components/ui";

export type Company = {
  name: string;
  agent_id: string | null;
  plan: "company";
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled";
  next_charge_at: string | null;
};

interface CompanyPlanCardProps {
  company: Company;
  actionPending: string | null;
  onSubscribe: (rootSlug: string) => void;
  onPortal: () => void;
  /** Hide the "Open Company →" link — useful when the card already
   *  lives inside that Company's surface (e.g. agent plan tab). */
  hideOpenLink?: boolean;
}

const STATUS_BADGE: Record<Company["status"], { variant: BadgeVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  trialing: { variant: "info", label: "Founder trial" },
  past_due: { variant: "warning", label: "Past due" },
  canceled: { variant: "error", label: "Canceled" },
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
 * Per-Company plan card — used in `/settings/billing` and the agent's own
 * `/{agentId}/settings/plan` tab. Single offer means a single line: status
 * badge, next-charge date, "Manage in Stripe" button. The only "upgrade"
 * action available is for canceled subscriptions to re-subscribe — which
 * just re-runs the standard checkout.
 */
export function CompanyPlanCard({
  company,
  actionPending,
  onSubscribe,
  onPortal,
  hideOpenLink = false,
}: CompanyPlanCardProps) {
  const statusBadge = STATUS_BADGE[company.status];
  const isCanceled = company.status === "canceled";
  const subscribeKey = `subscribe:${company.name}`;
  const subscribing = actionPending === subscribeKey;

  return (
    <Card variant="surface" padding="md" className="billing-company" role="listitem">
      <div className="billing-company-row">
        <div className="billing-company-meta">
          <h3 className="billing-company-name">{company.name}</h3>
          <div className="billing-company-tags">
            <Badge variant={statusBadge.variant} size="sm" dot>
              {statusBadge.label}
            </Badge>
          </div>
        </div>
        <div className="billing-company-charge">
          <span className="billing-company-charge-label">
            {company.status === "trialing" ? "Trial ends" : "Next charge"}
          </span>
          <span className="billing-company-charge-value">
            {formatNextCharge(company.next_charge_at)}
          </span>
        </div>
        <div className="billing-company-actions">
          {isCanceled ? (
            <Button
              variant="primary"
              size="sm"
              loading={subscribing}
              onClick={() => onSubscribe(company.name)}
            >
              Resubscribe — ${FOUNDER_FEE} →
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

      {company.status === "trialing" && (
        <p className="billing-company-trial-note">
          {TRIAL_DAYS}-day Founder trial — ${COMPANY_MONTHLY}/mo billing starts at trial end.
        </p>
      )}
    </Card>
  );
}
