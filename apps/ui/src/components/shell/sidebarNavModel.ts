export type CompanyNavGroupId = "operations" | "ownership" | "infrastructure";
export type CompanyNavGroupState = Record<CompanyNavGroupId, boolean>;

export const COMPANY_NAV_MATCHES: Record<CompanyNavGroupId, string[]> = {
  operations: ["agents", "sessions", "projects", "goals", "skills", "quests", "ideas", "events"],
  ownership: [
    "roles",
    "members",
    "controls",
    "filings",
    "shares",
    "equity",
    "rounds",
    "budgets",
    "assets",
    "transactions",
  ],
  infrastructure: [
    "integrations",
    "gateways",
    "channels",
    "tools",
    "runtime",
    "usage",
    "billing",
    "logs",
    "settings",
  ],
};
