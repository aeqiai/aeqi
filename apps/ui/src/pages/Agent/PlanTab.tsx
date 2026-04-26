import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Button, Spinner } from "@/components/ui";
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

/** Walk parent_id chain back to the root (parent_id == null). */
function findRoot(agents: Agent[], id: string): Agent | null {
  let current = agents.find((a) => a.id === id || a.name === id) || null;
  const seen = new Set<string>();
  while (current && current.parent_id) {
    if (seen.has(current.id)) return null; // defend against cycles
    seen.add(current.id);
    const next = agents.find((a) => a.id === current!.parent_id) || null;
    if (!next) return current;
    current = next;
  }
  return current;
}

/**
 * `/{agentId}/settings/plan` — per-Company plan surface inside the
 * agent's own settings shell. Shows the same plan info whether the
 * user is viewing the root or any sub-agent (plan is per-Company,
 * shared across the tree).
 *
 * Reuses the same `CompanyPlanCard` the user-level `/settings/billing`
 * uses, so upgrade ceremony + manage-in-portal stays in lockstep
 * across both surfaces.
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

  // Find the Company record matching this agent's root. Backend keys
  // off the placement slug (root_name) — the agent_id is the UUID
  // assigned by the runtime once the sandbox boots, so it may not
  // match yet. Match on either to be resilient.
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
        const msg = e instanceof Error ? e.message : "Could not start checkout.";
        setError(msg);
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
      const msg = e instanceof Error ? e.message : "Could not open Stripe portal.";
      setError(msg);
      setActionPending(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="billing-panel">
        <div className="billing-loading">
          <Spinner size="sm" /> Loading plan…
        </div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="billing-panel">
        <div className="account-feedback account-feedback-error" role="alert">
          {error}
        </div>
      </div>
    );
  }

  if (!root) {
    return (
      <div className="billing-panel">
        <p className="billing-empty-sub">Couldn't resolve this Company's root agent.</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="billing-panel">
        <header className="billing-header">
          <p className="billing-eyebrow">Plan</p>
          <h2 className="billing-headline">{root.name}</h2>
          <p className="billing-empty-sub">
            No subscription on file for this Company yet. The first plan stamps when you launch.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="billing-panel">
      <header className="billing-header">
        <p className="billing-eyebrow">Plan</p>
        <h2 className="billing-headline">
          {company.name} <span className="billing-headline-suffix">— per-Company subscription</span>
        </h2>
        <p className="billing-empty-sub">
          The plan applies to the whole Company — every agent in this tree shares it. Manage payment
          methods + invoices in the{" "}
          <Link to="/settings/billing" className="billing-link">
            user-level billing tab
          </Link>
          .
        </p>
      </header>

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
