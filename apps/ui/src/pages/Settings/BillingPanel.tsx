import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { formatCents } from "@/lib/pricing";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { entityPath } from "@/lib/entityPath";
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

const SPAWN_POLL_INTERVAL_MS = 1500;
const SPAWN_POLL_TIMEOUT_MS = 60_000;

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
  // ?spawn=:slug, the platform's `customer.subscription.created` webhook
  // is concurrently provisioning the personal Company. Poll for the
  // matching entity to appear and redirect into it. The webhook's call
  // to `provision_personal_company` is the source of truth — this
  // panel does not spawn directly (it'd hit the runtime proxy which
  // requires X-Entity, and the user has no entity scoped yet).
  useEffect(() => {
    if (spawnHandled.current) return;
    const slug = searchParams.get("spawn");
    if (!slug) return;
    spawnHandled.current = true;
    setSpawn({ kind: "running" });

    const startedAt = Date.now();
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        await fetchEntities();
        const entities = useDaemonStore.getState().entities;
        const match = entities.find((e) => e.name === slug);
        if (match) {
          setActiveEntity(match.id);
          await fetchAgents().catch(() => {});
          setSearchParams(new URLSearchParams(), { replace: true });
          navigate(entityPath(match, "inbox"));
          return;
        }
      } catch {
        // Transient fetch failures are tolerated — keep polling until
        // the deadline.
      }
      if (Date.now() - startedAt >= SPAWN_POLL_TIMEOUT_MS) {
        if (!cancelled) {
          setSpawn({
            kind: "error",
            message:
              "Payment received and your Company is still provisioning. Refresh in a moment, or email support@aeqi.ai if it doesn't appear.",
          });
          setSearchParams(new URLSearchParams(), { replace: true });
        }
        return;
      }
      timer = window.setTimeout(poll, SPAWN_POLL_INTERVAL_MS);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
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

  const handleSubscribe = useCallback(async (rootSlug: string) => {
    const key = `subscribe:${rootSlug}`;
    setActionPending(key);
    try {
      const { url } = await api.createCheckoutSession({
        display_name: rootSlug,
      });
      window.location.href = url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not start Checkout.");
      setActionPending(null);
    }
  }, []);

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
          <Link to="/launch" className="billing-empty-cta">
            <Button variant="primary">Launch a Company →</Button>
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
