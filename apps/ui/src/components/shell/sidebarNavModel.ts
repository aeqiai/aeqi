export type TrustNavGroupId = "operations" | "ownership" | "infrastructure";
export type TrustNavGroupState = Record<TrustNavGroupId, boolean>;

export const TRUST_NAV_MATCHES: Record<TrustNavGroupId, string[]> = {
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
  infrastructure: ["integrations", "gateways", "channels", "tools", "logs", "settings"],
};
