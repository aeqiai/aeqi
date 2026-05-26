/** Mirrored from aeqi-landing/src/pricing.ts. Update both files when prices change.
 *
 *  Launch pricing has two card plans:
 *  - Standard: $49/mo.
 *  - Pro: $69 first month, then $149/mo.
 *
 *  Plan IDs are the API/Stripe metadata values used by the launch flow. Older
 *  records may still contain `company`, `workspace`, or `launch`; helpers below
 *  normalize those to Standard so existing customers do not render as Pro.
 */

import { formatCurrency } from "./i18n";

export const STANDARD_MONTHLY = 49;
export const PRO_MONTHLY = 149;
export const PRO_FIRST_MONTH = 69;

export type LaunchPlanId = "starter" | "growth";

export interface LaunchPlanResources {
  tokens: string;
  cpu: string;
  ram: string;
  storage: string;
}

export interface LaunchPlan {
  id: LaunchPlanId;
  name: string;
  price: string;
  cadence: string;
  dueToday: string;
  monthlyCents: number;
  dueTodayCents: number;
  intro: string;
  blurb: string;
  features: string[];
  resources: LaunchPlanResources;
  recommended?: boolean;
}

export const LAUNCH_PLANS: LaunchPlan[] = [
  {
    id: "growth",
    name: "Pro",
    price: "$149",
    cadence: "/mo",
    dueToday: "$69",
    monthlyCents: PRO_MONTHLY * 100,
    dueTodayCents: PRO_FIRST_MONTH * 100,
    intro: "4x more capacity from day one.",
    blurb: "Best for heavier agent work.",
    features: [
      "20M LLM tokens / month",
      "8 vCPU runtime",
      "16 GB RAM · 160 GB storage",
      "Full organization + unlimited agents",
    ],
    resources: {
      tokens: "20M",
      cpu: "8 vCPU",
      ram: "16 GB",
      storage: "160 GB",
    },
    recommended: true,
  },
  {
    id: "starter",
    name: "Standard",
    price: "$49",
    cadence: "/mo",
    dueToday: "$49",
    monthlyCents: STANDARD_MONTHLY * 100,
    dueTodayCents: STANDARD_MONTHLY * 100,
    intro: "Focused launch capacity.",
    blurb: "Best for starting focused.",
    features: [
      "5M LLM tokens / month",
      "2 vCPU runtime",
      "4 GB RAM · 40 GB storage",
      "Full organization + unlimited agents",
    ],
    resources: {
      tokens: "5M",
      cpu: "2 vCPU",
      ram: "4 GB",
      storage: "40 GB",
    },
  },
];

export const DEFAULT_LAUNCH_PLAN: LaunchPlanId = "growth";
export const STANDARD_LAUNCH_PLAN = LAUNCH_PLANS.find((p) => p.id === "starter")!;
export const PRO_LAUNCH_PLAN = LAUNCH_PLANS.find((p) => p.id === "growth")!;

export interface Feature {
  text: string;
  highlight?: boolean;
  soon?: boolean;
}

export const FEATURES: Feature[] = [
  { text: "Full organization shell" },
  { text: "Unlimited agents" },
  { text: "Managed hosting" },
  {
    text: "Standard: 5M LLM tokens, 2 vCPU, 4 GB RAM, 40 GB storage",
    highlight: true,
  },
  {
    text: "Pro: 20M LLM tokens, 8 vCPU, 16 GB RAM, 160 GB storage",
    highlight: true,
  },
  { text: "Built-in ownership and governance primitives" },
  { text: "API + MCP access" },
  { text: "Mobile app", soon: true },
];

export interface LaunchPlanResourceItem {
  label: string;
  value: string;
}

export function normalizeLaunchPlanId(planId?: string | null): LaunchPlanId {
  const normalized = (planId || "").toLowerCase();
  if (normalized === "growth" || normalized === "pro") return "growth";
  return "starter";
}

export function launchPlanById(planId?: string | null): LaunchPlan {
  const normalized = normalizeLaunchPlanId(planId);
  return normalized === "growth" ? PRO_LAUNCH_PLAN : STANDARD_LAUNCH_PLAN;
}

export function launchPlanDisplayName(planId?: string | null): string {
  if ((planId || "").toLowerCase() === "sandbox") return "Admin sandbox";
  return launchPlanById(planId).name;
}

export function launchPlanBillingLine(planId?: string | null): string {
  if ((planId || "").toLowerCase() === "sandbox") return "Internal runtime. No Stripe billing.";
  const plan = launchPlanById(planId);
  if (plan.id === "growth") return "$69 first month, $149/mo after.";
  return "$49/mo.";
}

export function launchPlanResourceItems(planId?: string | null): LaunchPlanResourceItem[] {
  const plan = launchPlanById(planId);
  return [
    { label: "LLM tokens / month", value: plan.resources.tokens },
    { label: "Compute", value: plan.resources.cpu },
    { label: "Memory", value: plan.resources.ram },
    { label: "Storage", value: plan.resources.storage },
  ];
}

/** Format integer cents as a localized currency string. */
export function formatCents(cents: number, currency: string = "usd"): string {
  return formatCurrency(cents / 100, currency, {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}
