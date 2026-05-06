import { useMemo } from "react";
import type { Role, RoleEdge } from "@/lib/types";

export interface RolesListProps {
  roles: Role[];
  edges: RoleEdge[];
  /** Full role set for parent-title lookups. Defaults to `roles` when omitted. */
  allRoles?: Role[];
  agentNames: Map<string, string>;
  /** Avatar URLs keyed by agent id, sourced from the daemon store. */
  agentAvatars: Map<string, string>;
  onSelectRole: (role: Role) => void;
}

interface RoleWithDepth {
  role: Role;
  depth: number;
}

/**
 * Compute pre-order traversal of the role DAG.
 *
 * Roots are roles with no parent in the provided edge set. For each root
 * we DFS children in stable (insertion) order. Depth drives the indent
 * applied to each row's title cell. Diamond edges (role with two parents)
 * are handled by the visited set — the first-encountered position wins.
 */
function preorder(roles: Role[], edges: RoleEdge[]): RoleWithDepth[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  const parentCount = new Map<string, number>();

  for (const r of roles) {
    children.set(r.id, []);
    parentCount.set(r.id, 0);
  }
  for (const e of edges) {
    if (!byId.has(e.parent_role_id) || !byId.has(e.child_role_id)) continue;
    children.get(e.parent_role_id)!.push(e.child_role_id);
    parentCount.set(e.child_role_id, (parentCount.get(e.child_role_id) ?? 0) + 1);
  }

  const roots = roles.filter((r) => (parentCount.get(r.id) ?? 0) === 0);
  const result: RoleWithDepth[] = [];
  const visited = new Set<string>();

  function visit(id: string, depth: number): void {
    if (visited.has(id)) return;
    visited.add(id);
    const role = byId.get(id);
    if (role) result.push({ role, depth });
    for (const childId of children.get(id) ?? []) {
      visit(childId, depth + 1);
    }
  }

  for (const root of roots) {
    visit(root.id, 0);
  }

  // Append any disconnected roles (not reachable from roots) at depth 0.
  for (const role of roles) {
    if (!visited.has(role.id)) result.push({ role, depth: 0 });
  }

  return result;
}

const INDENT = 24; // px per depth level

export default function RolesList({
  roles,
  edges,
  allRoles,
  agentNames,
  agentAvatars,
  onSelectRole,
}: RolesListProps) {
  const ordered = useMemo(() => preorder(roles, edges), [roles, edges]);

  return (
    <div className="roles-list">
      <div className="roles-list-head">
        <span>Title</span>
        <span>Occupant</span>
        <span>Reports to</span>
        <span>Created</span>
      </div>
      {ordered.map(({ role, depth }) => (
        <button
          key={role.id}
          type="button"
          className="roles-list-row"
          onClick={() => onSelectRole(role)}
        >
          <span
            className="roles-list-cell-title"
            style={depth > 0 ? { paddingLeft: depth * INDENT } : undefined}
          >
            {role.title || <em>(untitled)</em>}
          </span>
          <span className="roles-list-cell-occupant">
            <OccupantInline
              role={role}
              agentName={agentNames.get(role.occupant_id ?? "")}
              agentAvatar={agentAvatars.get(role.occupant_id ?? "")}
            />
          </span>
          <span className="roles-list-cell-parents">
            <ParentsCell roleId={role.id} allRoles={allRoles ?? roles} edges={edges} />
          </span>
          <span className="roles-list-cell-meta">{role.created_at.slice(0, 10)}</span>
        </button>
      ))}
    </div>
  );
}

function ParentsCell({
  roleId,
  allRoles,
  edges,
}: {
  roleId: string;
  allRoles: Role[];
  edges: RoleEdge[];
}) {
  const parents = useMemo(() => {
    // Use allRoles for title lookups so cross-type edges (e.g. CEO reports
    // to a Director) resolve correctly when only a type-group is passed as roles.
    const titleById = new Map(allRoles.map((r) => [r.id, r.title || "(untitled)"]));
    return edges
      .filter((e) => e.child_role_id === roleId && titleById.has(e.parent_role_id))
      .map((e) => titleById.get(e.parent_role_id)!);
  }, [roleId, allRoles, edges]);

  if (parents.length === 0) return <span className="roles-list-cell-muted">—</span>;
  return <>{parents.join(", ")}</>;
}

function OccupantAvatar({
  avatarUrl,
  label,
}: {
  avatarUrl: string | null | undefined;
  label: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        style={{
          width: 18,
          height: 18,
          borderRadius: "999px",
          objectFit: "cover",
          flexShrink: 0,
          verticalAlign: "middle",
          display: "inline-block",
          marginRight: 4,
        }}
      />
    );
  }
  const initials = label
    ? label
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "·";
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: "999px",
        background: "var(--color-bg-subtle)",
        color: "var(--color-text-muted)",
        fontSize: 9,
        fontWeight: 600,
        flexShrink: 0,
        verticalAlign: "middle",
        marginRight: 4,
      }}
    >
      {initials}
    </span>
  );
}

function OccupantInline({
  role,
  agentName,
  agentAvatar,
}: {
  role: Role;
  agentName?: string;
  agentAvatar?: string;
}) {
  if (role.occupant_kind === "vacant") {
    return <span className="roles-list-cell-muted">vacant</span>;
  }
  if (role.occupant_kind === "agent") {
    const name = agentName ?? role.occupant_id?.slice(0, 8) ?? "";
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <OccupantAvatar avatarUrl={agentAvatar} label={name} />
        <span className="roles-list-cell-kind">agent</span> <strong>{name}</strong>
      </span>
    );
  }
  // Human occupant: prefer platform-resolved display name over raw id.
  const displayName = role.occupant_name
    ? role.occupant_name
    : role.occupant_id
      ? `${role.occupant_id.slice(0, 4)}…${role.occupant_id.slice(-4)}`
      : "";
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <OccupantAvatar avatarUrl={role.occupant_avatar_url} label={displayName} />
      <span className="roles-list-cell-kind">human</span> <strong>{displayName}</strong>
    </span>
  );
}
