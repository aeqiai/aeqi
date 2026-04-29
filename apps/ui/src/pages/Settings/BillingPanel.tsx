import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { formatCents, type BillingInterval, type PlanId } from "@/lib/pricing";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Banner, Button, Card, Spinner } from "@/components/ui";
import { CompanyPlanCard, type Company } from "@/components/billing/CompanyPlanCard";
import "@/styles/billing.css";

type Overview = {
  ok: boolean;
  total_monthly_cents: number;
  total_annual_cents: number;
  currency: string;
  payment_method_last4: string | null;
  companies: Company[];
};

type SpawnState = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string };
type SpawnBlueprintResponse = Awaited<ReturnType<typeof api.spawnBlueprint>>;

function entityIdFromSpawn(resp: SpawnBlueprintResponse): string {
  return resp.entity_id ?? "";
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
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      .spawnBlueprint({ blueprint, display_name: slug })
      .then((resp) => {
        const entityId = entityIdFromSpawn(resp);
        if (!entityId) throw new Error("Launch returned no entity id.");
        setActiveEntity(entityId);
        return Promise.all([fetchAgents(), fetchEntities()]).then(() => {
          // Clear params before navigating away so the user's history
          // doesn't carry the success token across page changes.
          setSearchParams(new URLSearchParams(), { replace: true });
          navigate(`/${encodeURIComponent(entityId)}/sessions`);
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
  }, [searchParams, setSearchParams, navigate, fetchAgents, fetchEntities, setActiveEntity]);

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
          display_name: rootSlug,
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
      <div className="billing-error-stack">
        <Banner kind="error">{error}</Banner>
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
      {spawn.kind === "error" && <Banner kind="error">{spawn.message}</Banner>}

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
          {companies.map((company) => (
            <CompanyPlanCard
              key={company.name}
              company={company}
              actionPending={actionPending}
              onSubscribe={handleSubscribe}
              onPortal={handlePortal}
            />
          ))}
        </div>
      )}

      {error && overview && <Banner kind="error">{error}</Banner>}

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
