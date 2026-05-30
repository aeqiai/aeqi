export type TrustNavGroupId = "operations" | "ownership" | "infrastructure";
export type TrustNavGroupState = Record<TrustNavGroupId, boolean>;

export const TRUST_NAV_MATCHES: Record<TrustNavGroupId, string[]> = {
  operations: [
    "agents",
    "sessions",
    "quests",
    "ideas",
    "apps",
    "mails",
    "websites",
    "campaigns",
    "events",
  ],
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
  infrastructure: ["integrations", "gateways", "channels", "tools", "settings"],
};
