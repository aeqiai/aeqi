/** Mirrored from aeqi-landing/src/pricing.ts. Single source of truth for the public pricing. Update both files when prices change. */

export const FREE = {
  tokens: "500k",
};

export interface Feature {
  text: string;
  highlight?: boolean;
  soon?: boolean;
}

export const PLANS = [
  {
    id: "launch" as const,
    name: "Launch",
    price: 39,
    annualPrice: 33,
    popular: false,
    desc: "Everything to run a company from day one.",
    features: [
      { text: "Unlimited agents" },
      { text: "Managed hosting + custom domain" },
      { text: "Built-in ownership & governance" },
      { text: "On-demand token top-ups" },
      { text: "8M tokens / month", highlight: true },
      { text: "2 vCPU · 4 GB RAM · 40 GB storage", highlight: true },
    ] as Feature[],
  },
  {
    id: "scale" as const,
    name: "Scale",
    price: 119,
    annualPrice: 99,
    popular: true,
    desc: "4× the resources. Premium features.",
    features: [
      { text: "Unlimited agents" },
      { text: "Managed hosting + custom domain" },
      { text: "Built-in ownership & governance" },
      { text: "On-demand token top-ups" },
      { text: "32M tokens / month", highlight: true },
      { text: "8 vCPU · 16 GB RAM · 160 GB storage", highlight: true },
      { text: "Priority support", highlight: true },
      { text: "API + MCP access", highlight: true },
      { text: "Mobile app", highlight: true, soon: true },
    ] as Feature[],
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];
export type BillingInterval = "monthly" | "annual";

/**
 * Maps the public-facing plan IDs (launch / scale) to the backend's internal
 * Stripe-route IDs (starter / growth). The frontend always speaks public IDs;
 * helpers in `lib/api.ts` translate to backend IDs at the request boundary.
 */
export const BACKEND_PLAN_ID: Record<PlanId, string> = {
  launch: "starter",
  scale: "growth",
};

/** Look up a plan by its public ID. TS-strict: returns the precise tuple element. */
export function findPlan(id: PlanId): (typeof PLANS)[number] {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) {
    throw new Error(`Unknown plan id: ${id}`);
  }
  return plan;
}

/** Format integer cents as a localized currency string. */
export function formatCents(cents: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
