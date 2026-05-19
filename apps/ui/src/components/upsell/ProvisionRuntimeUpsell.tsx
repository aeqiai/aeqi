/**
 * ProvisionRuntimeUpsell — the gate users hit when they open a runtime-
 * gated surface (Agents / Quests / Ideas / Events / Inbox / Sessions) on
 * a free TRUST.
 *
 * Architecture:
 *   - Free TRUSTs have an on-chain `trust_address` and an empty
 *     placement (`placement_type='launch'`, `tier='free'`). The 6
 *     ownership/governance tabs (Overview / Roles / Assets / Equity /
 *     Quorum / Incorporation) work without a runtime — they read the
 *     chain directly.
 *   - The 6 execution tabs need an `aeqi-host-<entity>.service` to be
 *     running. This component is the upsell shown in their place until
 *     the user provisions one.
 *   - Wire: `POST /api/runtime/provision { trust_id, plan }` returns a
 *     Stripe checkout URL; the `customer.subscription.created` webhook
 *     calls `upgrade_signup_trust_to_runtime` to spin the service.
 *
 * Anti-scope: no treasury-USDC payment path (that's ja-001.4b),
 * no plan downgrade, no module auto-provision.
 */
import { useState } from "react";

import { api } from "@/lib/api";
import { goExternal } from "@/lib/navigation";
import { LAUNCH_PLANS, type LaunchPlanId } from "@/lib/pricing";
import { Banner, Button, Card } from "@/components/ui";
// `.plan-card` and friends are declared in blueprint-launch-picker.css.
// That stylesheet is normally loaded by the launch/setup pages; we
// import it here so the upsell can reuse the canonical card visuals
// instead of duplicating them.
import "@/styles/blueprint-launch-picker.css";
import "@/styles/runtime-upsell.css";

/**
 * The runtime-gated surface this upsell stands in for. Drives only the
 * headline copy ("Provision a runtime to unlock <Surface>.") — the rest
 * of the panel is surface-agnostic.
 */
export type UpsellSurface = "agents" | "quests" | "ideas" | "events" | "inbox" | "sessions";

const SURFACE_LABELS: Record<UpsellSurface, string> = {
  agents: "Agents",
  quests: "Quests",
  ideas: "Ideas",
  events: "Events",
  inbox: "Inbox",
  sessions: "Sessions",
};

export interface ProvisionRuntimeUpsellProps {
  surface: UpsellSurface;
  /** Platform-side entity uuid (matches `Trust.id`). */
  trustId: string;
}

/** Map our canonical `LaunchPlanId` onto the platform's wire labels. */
function planWireLabel(id: LaunchPlanId): "standard" | "pro" {
  return id === "growth" ? "pro" : "standard";
}

export function ProvisionRuntimeUpsell({ surface, trustId }: ProvisionRuntimeUpsellProps) {
  // Default to Pro — recommended in the canonical pricing module and
  // mirrors the launch flow's default. The picker lets the user flip.
  const [plan, setPlan] = useState<LaunchPlanId>("growth");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProvision = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { url } = await api.provisionRuntime({
        trust_id: trustId,
        plan: planWireLabel(plan),
      });
      // Same-tab navigation to Stripe Checkout — matches the launch /
      // resubscribe flows (see BillingPanel.handleSubscribe). The user
      // bounces back via `success_url` after payment.
      goExternal(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setSubmitting(false);
    }
  };

  const surfaceLabel = SURFACE_LABELS[surface];

  return (
    <div className="runtime-upsell">
      <Card variant="default" padding="lg" className="runtime-upsell-card">
        <header className="runtime-upsell-header">
          <p className="runtime-upsell-eyebrow">Runtime required</p>
          <h2 className="runtime-upsell-title">Provision a runtime to unlock {surfaceLabel}.</h2>
          <p className="runtime-upsell-lede">
            Your TRUST is on-chain. A runtime adds agents that act on its behalf.
          </p>
        </header>

        <div className="runtime-upsell-plans" role="radiogroup" aria-label="Runtime plan">
          {LAUNCH_PLANS.map((item) => {
            const selected = item.id === plan;
            return (
              <Card
                key={item.id}
                variant="default"
                padding="none"
                interactive
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => setPlan(item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPlan(item.id);
                  }
                }}
                className={`plan-card ${selected ? "plan-card--selected" : ""} ${
                  item.recommended ? "plan-card--popular" : ""
                }`}
              >
                {item.recommended && <span className="plan-card-badge">Recommended</span>}
                <div className="plan-card-top">
                  <div className="plan-card-name">{item.name}</div>
                  <span className="plan-card-check" aria-hidden="true">
                    {selected ? "✓" : ""}
                  </span>
                </div>
                <div className="plan-card-price">
                  <span className="plan-card-price-amount">
                    {item.id === "growth" ? item.dueToday : item.price}
                  </span>
                  <span className="plan-card-price-cadence">
                    {item.id === "growth"
                      ? `first month · then ${item.price}${item.cadence}`
                      : item.cadence}
                  </span>
                </div>
                <p className="runtime-upsell-plan-intro">{item.intro}</p>
                <ul className="runtime-upsell-plan-bullets">
                  {item.features.map((feature) => (
                    <li key={feature} className="runtime-upsell-plan-bullet">
                      {feature}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        {error && <Banner kind="error">{error}</Banner>}

        <div className="runtime-upsell-cta">
          <Button
            variant="primary"
            size="lg"
            onClick={() => void handleProvision()}
            loading={submitting}
            loadingLabel="Starting checkout"
          >
            Provision runtime
          </Button>
          <p className="runtime-upsell-cta-note">
            Spins your runtime automatically after checkout. You can change capacity later.
          </p>
        </div>
      </Card>
    </div>
  );
}

ProvisionRuntimeUpsell.displayName = "ProvisionRuntimeUpsell";

export default ProvisionRuntimeUpsell;
