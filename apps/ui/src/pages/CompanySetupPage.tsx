import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Blueprint, RoleOverrideOccupant } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { Button, Input, Spinner } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  BlueprintRolePicker,
  buildRoleOverridesPayload,
} from "@/components/blueprints/BlueprintRolePicker";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { COMPANY_MONTHLY, FEATURES, FOUNDER_FEE, TRIAL_DAYS } from "@/lib/pricing";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

/**
 * `/start/:slug` — the company setup surface. Sits between picking a
 * Blueprint and the actual spawn so the operator confirms three things
 * in one flow:
 *
 *   1. Name — what the company is called (defaults to root.name)
 *   2. Team — role overrides via BlueprintRolePicker
 *   3. Confirm — single CTA that bounces to Stripe checkout
 *
 * Pricing is a single offer: $19 today (Founder fee), $49/mo from day 15
 * (Company subscription). Stripe handles this as one subscription with a
 * one-time line item plus a 14-day trial on the recurring price. No free
 * tier, no annual, no tier picker — see lib/pricing.ts.
 */
export default function CompanySetupPage() {
  const navigate = useNavigate();
  const { slug = "" } = useParams<{ slug: string }>();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [overrides, setOverrides] = useState<Record<string, RoleOverrideOccupant>>({});

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    document.title = blueprint?.name ? `Set up ${blueprint.name} · aeqi` : "Set up · aeqi";
  }, [blueprint?.name]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getBlueprint(slug)
      .then((resp) => {
        if (cancelled) return;
        if (resp.blueprint) {
          setBlueprint(resp.blueprint);
          setName(resp.blueprint.root?.name ?? resp.blueprint.name);
        } else {
          setLoadError("Blueprint not found.");
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message || "Could not reach the blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const launch = useCallback(async () => {
    if (!blueprint) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setLaunchError("Give your company a name.");
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    try {
      const rolePayload = buildRoleOverridesPayload(blueprint, overrides);
      const { url } = await api.createCheckoutSession({
        blueprint: blueprint.slug,
        display_name: trimmed,
        ...(rolePayload.length > 0 ? { role_overrides: rolePayload } : {}),
      });
      if (!url) {
        setLaunchError("Checkout failed — couldn't reach Stripe.");
        setLaunching(false);
        return;
      }
      window.location.href = url;
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Launch failed.");
      setLaunching(false);
    }
  }, [blueprint, name, overrides]);

  if (loading && !blueprint) {
    return (
      <div className="company-setup">
        <div className="bp-status">
          <Spinner size="sm" /> Loading Blueprint…
        </div>
      </div>
    );
  }

  if (!blueprint) {
    return (
      <div className="company-setup">
        <EmptyState
          title="Blueprint not found."
          description={loadError || "We couldn't find a Blueprint with that slug."}
          action={
            <Button variant="secondary" onClick={() => navigate("/economy/blueprints")}>
              Back to the catalog
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="company-setup">
      <header className="company-setup-head">
        <p className="company-setup-eyebrow">Set up · {blueprint.name}</p>
        <h1 className="company-setup-title">Launch your company.</h1>
        <p className="company-setup-sub">
          {blueprint.tagline || "Confirm a name, your team, and start."}
        </p>
      </header>

      {/* ── 1. Name ────────────────────────────────────── */}
      <section className="company-setup-section" aria-labelledby="setup-name-heading">
        <header className="company-setup-section-head">
          <h2 id="setup-name-heading" className="company-setup-section-title">
            <span className="company-setup-section-step">1</span>
            Name your company
          </h2>
          <p className="company-setup-section-sub">
            What it's called everywhere in aeqi. You can rename later.
          </p>
        </header>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Atlas Studio"
          autoFocus
        />
      </section>

      {/* ── 2. Team ────────────────────────────────────── */}
      <section className="company-setup-section" aria-labelledby="setup-team-heading">
        <header className="company-setup-section-head">
          <h2 id="setup-team-heading" className="company-setup-section-title">
            <span className="company-setup-section-step">2</span>
            Set up your team
          </h2>
          <p className="company-setup-section-sub">
            Each role ships with a default agent. Swap any for yourself, or leave vacant to hire
            later.
          </p>
        </header>
        <BlueprintTreePreview template={blueprint} />
        <div className="company-setup-counts">
          <BlueprintSeedCounts template={blueprint} />
        </div>
        <BlueprintRolePicker
          template={blueprint}
          userId={userId}
          overrides={overrides}
          onChange={setOverrides}
        />
      </section>

      {/* ── 3. Pricing summary ─────────────────────────── */}
      <section className="company-setup-section" aria-labelledby="setup-pricing-heading">
        <header className="company-setup-section-head">
          <h2 id="setup-pricing-heading" className="company-setup-section-title">
            <span className="company-setup-section-step">3</span>
            What you get
          </h2>
          <p className="company-setup-section-sub">
            ${FOUNDER_FEE} today, then ${COMPANY_MONTHLY} / month after {TRIAL_DAYS} days. Cancel
            anytime — your card won't be charged again.
          </p>
        </header>

        <ul className="plan-summary-features" role="list">
          {FEATURES.map((f) => (
            <li key={f.text} className={f.highlight ? "is-highlight" : undefined}>
              {f.text}
              {f.soon && <span className="plan-summary-soon"> · soon</span>}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Launch ─────────────────────────────────────── */}
      {launchError && (
        <div className="bp-error" role="alert">
          {launchError}
        </div>
      )}
      <div className="company-setup-foot">
        <Button
          variant="secondary"
          onClick={() => navigate(`/economy/blueprints/${encodeURIComponent(blueprint.slug)}`)}
          disabled={launching}
        >
          ← Back to Blueprint
        </Button>
        <Button variant="primary" onClick={launch} loading={launching} disabled={!name.trim()}>
          Continue to checkout — ${FOUNDER_FEE} today →
        </Button>
      </div>
    </div>
  );
}
