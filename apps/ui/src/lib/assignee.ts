import type { Agent, User } from "./types";

/**
 * Polymorphic assignee identity. The wire format is a prefix-typed
 * string — `agent:<id>` | `user:<id>` | `role:<id>` — so a single column
 * on the server holds all kinds without three-nullable awkwardness.
 * This module is the only place that parses or formats those strings;
 * everywhere else in the UI uses the typed `AssigneeIdentity` shape.
 *
 * `role:<id>` was added by quest 67-213 phase-1. A role-bound quest is
 * claimable by any principal occupying that role or controlling it via
 * `role_edges` (transitive ancestry within the same entity). The role
 * stays the canonical assignee even after a principal picks it up.
 */
export type AssigneeKind = "agent" | "user" | "role";

export interface AssigneeIdentity {
  kind: AssigneeKind;
  id: string;
  raw: string;
}

export function parseAssignee(raw: string | null | undefined): AssigneeIdentity | null {
  if (!raw) return null;
  if (raw.startsWith("agent:")) return { kind: "agent", id: raw.slice(6), raw };
  if (raw.startsWith("user:")) return { kind: "user", id: raw.slice(5), raw };
  if (raw.startsWith("role:")) return { kind: "role", id: raw.slice(5), raw };
  // Unprefixed legacy values are interpreted as agent ids — that's
  // what `agent_id` carried before the polymorphic field landed.
  return { kind: "agent", id: raw, raw: `agent:${raw}` };
}

export function formatAssignee(kind: AssigneeKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Resolved display data for an assignee — the avatar / picker rows
 * collapse "is this an agent, a user, or a role, and what do I call
 * them" into one shape the renderer can consume without branching.
 */
export interface AssigneeDisplay {
  kind: AssigneeKind;
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/**
 * Minimal role shape this resolver needs. Pulled inline (rather than
 * imported from `./types`) so the UI doesn't have to gate the assignee
 * parser on the role types module shape. Quest 67-213 phase-1.
 */
export interface AssigneeRoleHint {
  id: string;
  title: string;
}

export function resolveAssigneeDisplay(
  identity: AssigneeIdentity,
  agents: Pick<Agent, "id" | "name">[],
  users: Pick<User, "id" | "name" | "avatar_url">[],
  roles: AssigneeRoleHint[] = [],
): AssigneeDisplay | null {
  if (identity.kind === "agent") {
    const agent = agents.find((a) => a.id === identity.id);
    if (!agent) return { kind: "agent", id: identity.id, name: identity.id };
    return { kind: "agent", id: agent.id, name: agent.name };
  }
  if (identity.kind === "role") {
    const role = roles.find((r) => r.id === identity.id);
    if (!role) return { kind: "role", id: identity.id, name: identity.id };
    return { kind: "role", id: role.id, name: role.title };
  }
  const user = users.find((u) => u.id === identity.id);
  if (!user) return { kind: "user", id: identity.id, name: identity.id };
  return {
    kind: "user",
    id: user.id,
    name: user.name,
    avatarUrl: user.avatar_url ?? null,
  };
}

// TODO(67-213 phase-1 UI follow-up): AssigneePicker today renders
// People + Agents only. The picker's third tab (Roles) needs a roles
// data source (read via `/api/roles` for the active entity) and a row
// renderer matching role_type. Tracking on quest 67-213 — the parser +
// resolver above already accept `role:<id>`, so existing role-bound
// rows render via AssigneeAvatar without crashing.
