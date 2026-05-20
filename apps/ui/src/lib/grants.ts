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

export type GrantId = (typeof GRANT_CATALOG)[number]["id"];

export const DEFAULT_GRANTS: Record<RoleType, string[]> = {
  director: GRANT_CATALOG.map((g) => g.id),
  operational: ["roles.manage", "agents.spawn", "agents.configure", "treasury.read"],
  advisor: ["treasury.read", "governance.read"],
};
