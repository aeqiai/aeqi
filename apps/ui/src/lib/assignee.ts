import type { Agent, User } from "./types";

/**
 * Polymorphic assignee identity. The wire format is a prefix-typed
 * string — `agent:<id>` | `user:<id>` — so a single column on the
 * server holds both kinds without two-nullable awkwardness. This
 * module is the only place that parses or formats those strings;
 * everywhere else in the UI uses the typed `AssigneeIdentity` shape.
 */
export type AssigneeKind = "agent" | "user";

export interface AssigneeIdentity {
  kind: AssigneeKind;
  id: string;
  raw: string;
}

export function parseAssignee(raw: string | null | undefined): AssigneeIdentity | null {
  if (!raw) return null;
  if (raw.startsWith("agent:")) return { kind: "agent", id: raw.slice(6), raw };
  if (raw.startsWith("user:")) return { kind: "user", id: raw.slice(5), raw };
  // Unprefixed legacy values are interpreted as agent ids — that's
  // what `agent_id` carried before the polymorphic field landed.
  return { kind: "agent", id: raw, raw: `agent:${raw}` };
}

export function formatAssignee(kind: AssigneeKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Resolved display data for an assignee — the avatar / picker rows
 * collapse "is this an agent or a user, and what do I call them"
 * into one shape the renderer can consume without branching.
 */
export interface AssigneeDisplay {
  kind: AssigneeKind;
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export function resolveAssigneeDisplay(
  identity: AssigneeIdentity,
  agents: Pick<Agent, "id" | "name">[],
  users: Pick<User, "id" | "name" | "avatar_url">[],
): AssigneeDisplay | null {
  if (identity.kind === "agent") {
    const agent = agents.find((a) => a.id === identity.id);
    if (!agent) return { kind: "agent", id: identity.id, name: identity.id };
    return { kind: "agent", id: agent.id, name: agent.name };
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
