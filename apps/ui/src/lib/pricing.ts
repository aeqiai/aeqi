/** Mirrored from aeqi-landing/src/pricing.ts. Single source of truth for pricing.
 *  Update both files when prices change.
 *
 *  Atomic unit: workspace (the user account). One subscription unlocks the
 *  workspace. Companies are created inside the workspace — up to
 *  WORKSPACE_COMPANY_CAP by default (fair-use cap, not a hard enforcement
 *  boundary for agents paying via x402).
 *
 *  One offer, two payment rails.
 *
 *  Card (default): $19 first month → $49 / month after. Stripe runs this as a
 *  single $49 / mo Product with an auto-applied first-month coupon (-$30,
 *  duration: once). Day-0 charge is $19; every subsequent month is $49.
 *
 *  USDC: $19 first month → $45 / month after (the $4 discount is the Stripe
 *  fee passed through). Phase A: SIWE users only — ERC-20 approve + monthly
 *  platform-side cron pull from external EOA. Phase B (after wallet build):
 *  default rail; passkey-Entity USDC pull, paymaster-sponsored gas.
 *
 *  Subscription includes $25 / month of inference credit, pooled across all
 *  Companies in the workspace. Top up anytime via card or USDC. External
 *  callers pay per-call via x402 (cost + 20%).
 *
 *  No tier picker, no trial, no annual. `FOUNDER_FEE` is the effective
 *  first-month price on both rails.
 */

export const FOUNDER_FEE = 19;
/** $49/mo per workspace — unlimited Companies up to WORKSPACE_COMPANY_CAP. */
export const WORKSPACE_MONTHLY = 49;
/** USDC equivalent ($4 discount = Stripe fee passthrough). */
export const COMPANY_MONTHLY_USDC = 45;

/** Default fair-use cap: number of Companies per workspace. */
export const WORKSPACE_COMPANY_CAP = 10;

/** Kept for backward compatibility — equals WORKSPACE_MONTHLY. */
export const COMPANY_MONTHLY = WORKSPACE_MONTHLY;

export const INFERENCE_CREDIT_USD = 25;

export type LaunchPlanId = "starter" | "growth";

export interface LaunchPlan {
  id: LaunchPlanId;
  name: string;
  price: string;
  cadence: string;
  intro: string;
  blurb: string;
  features: string[];
  recommended?: boolean;
}

export const LAUNCH_PLANS: LaunchPlan[] = [
  {
    id: "starter",
    name: "Standard",
    price: "$49",
    cadence: "/mo",
    intro: "Launch month included.",
    blurb: "For a focused organization with one clear operating lane.",
    features: [
      "1 organization",
      "$25/mo inference credit",
      "4 vCPU runtime",
      "Ownership + governance",
    ],
  },
  {
    id: "growth",
    name: "Pro",
    price: "$149",
    cadence: "/mo",
    intro: "$69 first month.",
    blurb: "For heavier execution, more agents, and broader coordination.",
    features: [
      "Everything in Standard",
      "8 vCPU runtime",
      "Higher inference budget",
      "Priority runs",
    ],
    recommended: true,
  },
];

export const DEFAULT_LAUNCH_PLAN: LaunchPlanId = "growth";

export const RESOURCE_PACK = {
  inferenceUsd: `$${INFERENCE_CREDIT_USD}`,
  cpu: "4 vCPU",
  ram: "8 GB",
  storage: "80 GB",
} as const;

export interface Feature {
  text: string;
  highlight?: boolean;
  soon?: boolean;
}

export const FEATURES: Feature[] = [
  { text: `Run up to ${WORKSPACE_COMPANY_CAP} autonomous companies` },
  { text: "Unlimited agents" },
  { text: "Managed hosting + custom domain" },
  { text: "Built-in ownership & governance" },
  {
    text: `${RESOURCE_PACK.inferenceUsd} / month inference credit, pooled across all companies`,
    highlight: true,
  },
  { text: "Top up anytime — card or USDC" },
  {
    text: `${RESOURCE_PACK.cpu} · ${RESOURCE_PACK.ram} RAM · ${RESOURCE_PACK.storage} storage`,
    highlight: true,
  },
  { text: "API + MCP access" },
  { text: "Mobile app", soon: true },
];

/** Single plan identifier used everywhere — DB, Stripe metadata, API. */
export const PLAN_ID = "workspace" as const;
export type PlanId = typeof PLAN_ID;

/** Format integer cents as a localized currency string. */
export function formatCents(cents: number, currency: string = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
