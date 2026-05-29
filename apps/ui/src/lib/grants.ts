import type { RoleType } from "@/lib/types";

export const GRANT_CATALOG = [
  {
    id: "roles.manage",
    label: "Manage roles",
    desc: "Create / edit / archive / invite to roles below this one",
  },
  {
    id: "agents.spawn",
    label: "Spawn agents",
    desc: "Create new agents under a role you control",
  },
  {
    id: "agents.configure",
    label: "Configure agents",
    desc: "Edit agent ideas, events, quests",
  },
  {
    id: "treasury.read",
    label: "View treasury",
    desc: "See billing and resource usage",
  },
  {
    id: "governance.read",
    label: "View governance",
    desc: "Read proposals, votes, and treasury motions",
  },
  {
    id: "settings.modify",
    label: "Modify settings",
    desc: "Change TRUST name, billing, integrations",
  },
] as const;

// Product language: roles expose capabilities under their Authority section.
// The legacy wire/storage name is still "grants" because it models the
// assignment record. Keep this alias so new UI code can speak the domain
// language without forcing a risky schema rename in the same patch.
export const CAPABILITY_CATALOG = GRANT_CATALOG;

export type GrantId = (typeof GRANT_CATALOG)[number]["id"];
export type CapabilityId = GrantId;

export const DEFAULT_GRANTS: Record<RoleType, string[]> = {
  // Owner — ownership rights only. Reads treasury/governance for
  // visibility; no operational grants. Wire schema for the "owner"
  // role_type is not finalized yet; this is a placeholder until the
  // three-tier-role-model migration ships.
  owner: ["treasury.read", "governance.read"],
  director: GRANT_CATALOG.map((g) => g.id),
  operational: ["roles.manage", "agents.spawn", "agents.configure", "treasury.read"],
  advisor: ["treasury.read", "governance.read"],
};
