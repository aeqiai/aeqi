import { Link } from "react-router-dom";
import {
  launchPlanBillingLine,
  launchPlanById,
  launchPlanDisplayName,
  normalizeLaunchPlanId,
  type LaunchPlanId,
} from "@/lib/pricing";
import { formatMediumDate } from "@/lib/i18n";
import { Badge, Button, Card, type BadgeVariant } from "@/components/ui";

export type Company = {
  name: string;
  agent_id: string | null;
  plan: LaunchPlanId | string | null;
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled";
  next_charge_at: string | null;
};

interface CompanyPlanCardProps {
  company: Company;
  actionPending: string | null;
  onSubscribe: (rootSlug: string, plan: LaunchPlanId) => void;
  onPortal: () => void;
  /** Hide the "Open Company →" link — useful when the card already
   *  lives inside that Company's surface (e.g. agent plan tab). */
  hideOpenLink?: boolean;
  /** Human-readable company name to display instead of company.name.
   *  The billing API returns trust_id as company.name — callers that
   *  have resolved the display name should pass it here. */
  displayName?: string;
}

const STATUS_BADGE: Record<Company["status"], { variant: BadgeVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  trialing: { variant: "info", label: "Intro period" },
  past_due: { variant: "warning", label: "Past due" },
  canceled: { variant: "error", label: "Canceled" },
};

function formatNextCharge(iso: string | null): string {
  return formatMediumDate(iso);
}

/**
 * Per-Company plan card — used in `/settings/billing` and the agent's own
 * `/{agentId}/settings/plan` tab. Billing is per organization; the backend
 * sends the plan metadata stamped by checkout, and legacy single-plan records
 * normalize to Standard.
 */
export function CompanyPlanCard({
  company,
  actionPending,
  onSubscribe,
  onPortal,
  hideOpenLink = false,
  displayName,
}: CompanyPlanCardProps) {
  const statusBadge = STATUS_BADGE[company.status];
  const isCanceled = company.status === "canceled";
  const label = displayName || company.name;
  const subscribeKey = `subscribe:${company.name}`;
  const subscribing = actionPending === subscribeKey;
  const plan = launchPlanById(company.plan);
  const planId = normalizeLaunchPlanId(company.plan);
  const planName = launchPlanDisplayName(company.plan);

  return (
    <Card variant="surface" padding="md" className="billing-company" role="listitem">
      <div className="billing-company-row">
        <div className="billing-company-meta">
          <h3 className="billing-company-name">{label}</h3>
          <div className="billing-company-tags">
            <Badge variant={statusBadge.variant} size="sm" dot>
              {statusBadge.label}
            </Badge>
            <Badge
              variant={plan.id === "growth" && planName !== "Sandbox" ? "accent" : "neutral"}
              size="sm"
            >
              {planName}
            </Badge>
          </div>
        </div>
        <div className="billing-company-charge">
          <span className="billing-company-charge-label">
            {company.status === "trialing" ? "Intro ends" : "Next charge"}
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
              onClick={() => onSubscribe(company.name, planId)}
            >
              Resubscribe — {plan.dueToday} →
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
        <p className="billing-company-trial-note">{launchPlanBillingLine(company.plan)}</p>
      )}
    </Card>
  );
}
