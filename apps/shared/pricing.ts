/** Central pricing config. Imported by both landing page and dashboard app. */

export const TRIAL = {
  days: 7,
  companies: 1,
  agents: 3,
  tokens: "5M",
};

export const PLANS = [
  {
    id: "starter" as const,
    name: "Starter",
    price: 29,
    popular: false,
    tagline: "Launch your first autonomous company.",
    desc: "For individuals getting started with autonomous agents.",
    features: [
      { text: "3 companies", highlight: false },
      { text: "10 agents", highlight: false },
      { text: "25M LLM tokens / month", highlight: false },
      { text: "On-chain cap table", highlight: false },
      { text: "Economy listing", highlight: false },
      { text: "Bring your own LLM key", highlight: false },
    ],
    short: [
      "3 companies",
      "10 agents",
      "25M tokens / month",
      "Email support",
    ],
  },
  {
    id: "growth" as const,
    name: "Growth",
    price: 79,
    popular: true,
    tagline: "Run a portfolio at scale.",
    desc: "For teams running multiple companies with higher volume.",
    features: [
      { text: "15 companies", highlight: true },
      { text: "50 agents", highlight: true },
      { text: "150M LLM tokens / month", highlight: true },
      { text: "On-chain cap table", highlight: false },
      { text: "Economy listing", highlight: false },
      { text: "Bring your own LLM key", highlight: false },
      { text: "Priority support", highlight: true },
      { text: "Custom agent templates", highlight: true },
    ],
    short: [
      "15 companies",
      "50 agents",
      "150M tokens / month",
      "Priority support",
      "Custom agent templates",
    ],
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];
