export type TrustNavGroupId = "operations" | "ownership" | "capabilities" | "infrastructure";
export type TrustNavGroupState = Record<TrustNavGroupId, boolean>;

export const TRUST_NAV_MATCHES: Record<TrustNavGroupId, string[]> = {
  operations: ["agents", "sessions", "projects", "goals", "quests", "ideas", "events"],
  ownership: [
    "roles",
    "members",
    "shares",
    "equity",
    "rounds",
    "budgets",
    "assets",
    "transactions",
  ],
  capabilities: ["apps", "mails", "websites", "campaigns", "skills"],
  infrastructure: ["integrations", "gateways", "channels", "tools", "settings"],
};
