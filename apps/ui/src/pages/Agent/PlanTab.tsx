import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { CompanyPlanCard, type Company } from "@/components/billing/CompanyPlanCard";
import type { Agent } from "@/lib/types";
import type { BillingInterval, PlanId } from "@/lib/pricing";
import "@/styles/billing.css";

interface PlanTabProps {
  /** The agent the user is viewing — sub-agents resolve to their root
   *  for plan lookup. Plan is per-Company (the root), so this tab shows
   *  the same data regardless of which agent in the tree is open. */
  agentId: string;
}

type Overview = {
  ok: boolean;
  total_monthly_cents: number;
  total_annual_cents: number;
  currency: string;
  payment_method_last4: string | null;
  companies: Company[];
};

const PLAN_LABEL: Record<Company["plan"], string> = {
  free: "Free",
  launch: "Launch",
  scale: "Scale",
};
const PLAN_BADGE_VARIANT: Record<Company["plan"], "neutral" | "info" | "success"> = {
  free: "neutral",
  launch: "info",
  scale: "success",
};

/** Resolve the entity-owning root agent for a given agent id or name. */
function findRoot(agents: Agent[], id: string): Agent | null {
  const start = agents.find((a) => a.id === id || a.name === id) || null;
  if (!start) return null;
  const eid = start.entity_id;
  if (!eid) return start;
  // The "root agent" of an entity is the placeholder row the daemon store
  // synthesizes for the company; its id matches the entity's reported
  // agent_id (often equal to the entity_id today). We just return the
  // first agent in this entity that has no further entity-level
  // information — for billing the entity pointer is enough.
  return agents.find((a) => a.id === eid) || start;
}

/**
 * `/{agentId}/plan` (and `/{agentId}/settings/plan`) — per-Company plan
 * surface inside the agent shell. Shows the same plan info whether the
 * user is viewing the root or any sub-agent (plan is per-Company,
 * shared across the tree).
 *
 * Layout mirrors `/settings/billing` so the visual rhythm + upgrade
 * ceremony stays in lockstep across both surfaces. The hero summary
 * Card uses the same `.billing-summary` shape as the user-level
 * rollup; the action card is the shared `CompanyPlanCard`.
 */
export default function PlanTab({ agentId }: PlanTabProps) {
  const agents = useDaemonStore((s) => s.agents);
  const root = useMemo(() => findRoot(agents, agentId), [agents, agentId]);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBillingOverview()
      .then((data) => {
        if (cancelled) return;
        setOverview(data as Overview);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not load billing data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const company = useMemo<Company | null>(() => {
    if (!overview || !root) return null;
    return overview.companies.find((c) => c.agent_id === root.id || c.name === root.name) ?? null;
  }, [overview, root]);

  const handleSubscribe = useCallback(
    async (rootSlug: string, plan: PlanId, interval: BillingInterval) => {
      setActionPending(`subscribe:${rootSlug}:${plan}`);
      try {
        const { url } = await api.createCheckoutSession({
          plan,
          interval,
          root_slug: rootSlug,
        });
        if (!url) throw new Error("Checkout returned no URL.");
        window.location.href = url;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start checkout.");
        setActionPending(null);
      }
    },
    [],
  );

  const handlePortal = useCallback(async () => {
    setActionPending("portal");
    try {
      const { url } = await api.openBillingPortal();
      if (!url) throw new Error("Portal returned no URL.");
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open Stripe portal.");
      setActionPending(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="billing-panel billing-panel-padded">
        <div className="billing-loading">
          <Spinner size="sm" /> Loading plan…
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="billing-panel billing-panel-padded">
        <Card padding="lg" className="billing-summary">
          <div className="billing-summary-main">
            <p className="billing-eyebrow">Plan</p>
            <p className="billing-summary-sub">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!root) {
    return (
      <div className="billing-panel billing-panel-padded">
        <Card padding="lg" className="billing-summary">
          <div className="billing-summary-main">
            <p className="billing-eyebrow">Plan</p>
            <p className="billing-summary-sub">Couldn't resolve this Company's root agent.</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="billing-panel billing-panel-padded">
        <Card padding="lg" className="billing-summary">
          <div className="billing-summary-main">
            <p className="billing-eyebrow">Plan</p>
            <h2 className="billing-summary-name">{root.name}</h2>
            <p className="billing-summary-sub">
              No subscription on file for this Company yet — the first plan stamps when it launches.
            </p>
          </div>
          <div className="billing-summary-aside">
            <Link to="/settings/billing" className="billing-link">
              View user-level billing →
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="billing-panel billing-panel-padded">
      <Card padding="lg" className="billing-summary">
        <div className="billing-summary-main">
          <p className="billing-eyebrow">Plan</p>
          <div className="billing-summary-name-row">
            <h2 className="billing-summary-name">{company.name}</h2>
            <Badge variant={PLAN_BADGE_VARIANT[company.plan]} size="md">
              {PLAN_LABEL[company.plan]}
            </Badge>
          </div>
          <p className="billing-summary-sub">
            Per-Company subscription. Every agent in this tree shares this plan. See all your
            Companies + payment methods in the{" "}
            <Link to="/settings/billing" className="billing-link">
              user-level billing tab
            </Link>
            .
          </p>
        </div>
      </Card>

      <div className="billing-companies" role="list">
        <CompanyPlanCard
          company={company}
          actionPending={actionPending}
          onSubscribe={handleSubscribe}
          onPortal={handlePortal}
          hideOpenLink
        />
      </div>

      {error && (
        <div className="account-feedback account-feedback-error" role="alert">
          {error}
        </div>
      )}

      <div className="billing-footer">
        <p className="billing-footer-line">
          Need to change billing email, download invoices, or update tax info?{" "}
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
          Plan changes take effect at the next renewal. Cancellations are processed in Stripe.
          {company.plan === "free" && " Free Companies don't bill — no payment method needed."}
        </p>
      </div>

      {company.plan === "free" && (
        <div className="billing-footer billing-footer-secondary">
          <Button variant="ghost" size="sm" onClick={() => (window.location.href = "/start")}>
            ← Spawn another Company
          </Button>
        </div>
      )}
    </div>
  );
}
