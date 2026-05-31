import { useEffect, useMemo, useState } from "react";
import type { Role, RoleEdge } from "@/lib/types";
import AgentAvatar from "../AgentAvatar";
import { Table, type TableColumn } from "../ui";
import { labelRoleType } from "./RoleInspectorPrimitives";

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

const ROLES_PAGE_SIZE = 25;

function occupantSortKey(role: Role, agentNames: Map<string, string>): string {
  if (role.occupant_kind === "vacant") return "￿"; // sort vacant to the end
  if (role.occupant_kind === "agent") {
    return (agentNames.get(role.occupant_id ?? "") ?? role.occupant_id ?? "").toLowerCase();
  }
  return (role.occupant_name ?? role.occupant_id ?? "").toLowerCase();
}

export default function RolesList({
  roles,
  edges,
  allRoles,
  agentNames,
  agentAvatars,
  onSelectRole,
}: RolesListProps) {
  const [page, setPage] = useState(1);
  const allRolesRef = allRoles ?? roles;

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(roles.length / ROLES_PAGE_SIZE));
    setPage((current) => Math.min(current, pageCount));
  }, [roles.length]);

  /**
   * Titles aren't globally unique (two "Engineer"s reporting to the same
   * manager is normal). When a parent's title collides with another role's
   * title in the data set, ParentsCell appends the occupant for
   * disambiguation. Computed here once, threaded down via prop.
   */
  const ambiguousTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of allRolesRef) {
      const t = (r.title || "(untitled)").trim();
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, n]) => n > 1)
        .map(([t]) => t),
    );
  }, [allRolesRef]);

  const firstParentTitle = useMemo(() => {
    const titleById = new Map(allRolesRef.map((r) => [r.id, r.title || "(untitled)"]));
    const out = new Map<string, string>();
    for (const e of edges) {
      if (out.has(e.child_role_id)) continue;
      const t = titleById.get(e.parent_role_id);
      if (t) out.set(e.child_role_id, t);
    }
    return out;
  }, [allRolesRef, edges]);

  const columns = useMemo<Array<TableColumn<Role>>>(
    () => [
      {
        key: "title",
        header: "Name",
        width: "24%",
        sortable: true,
        sortAccessor: (role) => (role.title || "").toLowerCase(),
        cell: (role) =>
          role.title ? (
            <span className="roles-list-title">{role.title}</span>
          ) : (
            <em className="roles-list-muted">(untitled)</em>
          ),
      },
      {
        key: "type",
        header: "Type",
        width: "14%",
        sortable: true,
        sortAccessor: (role) => labelRoleType(role.role_type),
        cell: (role) => (
          <span className={`roles-list-type roles-list-type--${role.role_type}`}>
            {labelRoleType(role.role_type)}
          </span>
        ),
      },
      {
        key: "occupant",
        header: "Occupant",
        width: "26%",
        sortable: true,
        sortAccessor: (role) => occupantSortKey(role, agentNames),
        cell: (role) => (
          <OccupantInline
            role={role}
            agentName={agentNames.get(role.occupant_id ?? "")}
            agentAvatar={agentAvatars.get(role.occupant_id ?? "")}
          />
        ),
      },
      {
        key: "parents",
        header: "Reports to",
        width: "22%",
        sortable: true,
        sortAccessor: (role) => (firstParentTitle.get(role.id) ?? "").toLowerCase(),
        cell: (role) => (
          <ParentsCell
            roleId={role.id}
            allRoles={allRolesRef}
            edges={edges}
            agentNames={agentNames}
            ambiguousTitles={ambiguousTitles}
          />
        ),
      },
      {
        key: "created",
        header: "Created",
        width: "14%",
        align: "end",
        sortable: true,
        sortAccessor: (role) => role.created_at,
        cell: (role) => <span className="roles-list-date">{role.created_at.slice(0, 10)}</span>,
      },
    ],
    [agentNames, agentAvatars, allRolesRef, edges, ambiguousTitles, firstParentTitle],
  );

  return (
    <div className="company-roles-table">
      <Table<Role>
        columns={columns}
        data={roles}
        rowKey={(role) => role.id}
        onRowClick={onSelectRole}
        density="compact"
        scrollWidth="sm"
        ariaLabel="Roles"
        pagination={{
          page,
          pageSize: ROLES_PAGE_SIZE,
          total: roles.length,
          itemLabel: "roles",
          onPageChange: setPage,
        }}
      />
    </div>
  );
}

function ParentsCell({
  roleId,
  allRoles,
  edges,
  agentNames,
  ambiguousTitles,
}: {
  roleId: string;
  allRoles: Role[];
  edges: RoleEdge[];
  agentNames: Map<string, string>;
  ambiguousTitles: Set<string>;
}) {
  const parents = useMemo(() => {
    // Use allRoles for parent lookups so cross-type edges (e.g. CEO reports
    // to a Director) resolve correctly when only a type-group is passed as
    // roles. Each entry carries the parent role so the cell can disambiguate
    // by occupant when the title collides with another role's title.
    const byId = new Map(allRoles.map((r) => [r.id, r]));
    return edges
      .filter((e) => e.child_role_id === roleId && byId.has(e.parent_role_id))
      .map((e) => byId.get(e.parent_role_id)!);
  }, [roleId, allRoles, edges]);

  if (parents.length === 0) return <span className="roles-list-muted">—</span>;
  return (
    <span className="roles-list-parents">
      {parents.slice(0, 2).map((p) => {
        const title = (p.title || "(untitled)").trim();
        const occupant = ambiguousTitles.has(title) ? parentOccupantLabel(p, agentNames) : "";
        return (
          <span key={p.id} className="roles-list-parent-chip">
            <span className="roles-list-parent-title">{title}</span>
            {occupant && <span className="roles-list-parent-meta">{occupant}</span>}
          </span>
        );
      })}
      {parents.length > 2 && <span className="roles-list-parent-more">+{parents.length - 2}</span>}
    </span>
  );
}

function parentOccupantLabel(role: Role, agentNames: Map<string, string>): string {
  if (role.occupant_kind === "vacant") return "vacant";
  if (role.occupant_kind === "agent") {
    return agentNames.get(role.occupant_id ?? "") ?? role.occupant_id?.slice(0, 6) ?? "";
  }
  return role.occupant_name ?? (role.occupant_id ? `${role.occupant_id.slice(0, 6)}…` : "");
}

/**
 * Avatar render contract — matches RoleNode (the chart/cards surface):
 *
 *   agent          → AgentAvatar circle — software glyph unless a real avatar exists
 *   human + URL    → circular <img> (borderRadius 999px)
 *   human + no URL → circular initials chip (borderRadius 999px)
 *
 * Humans and agents are identity circles; Companies keep the institutional
 * rounded-square shape.
 */
function AgentAvatarChip({
  avatarUrl,
  label,
}: {
  avatarUrl: string | null | undefined;
  label: string;
}) {
  return (
    <span aria-hidden className="roles-list-avatar-shell">
      <AgentAvatar name={label} src={avatarUrl ?? undefined} />
    </span>
  );
}

function HumanAvatarChip({
  avatarUrl,
  label,
}: {
  avatarUrl: string | null | undefined;
  label: string;
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="roles-list-avatar roles-list-avatar--human" />;
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
    <span aria-hidden className="roles-list-avatar roles-list-avatar--initials">
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
    return <span className="roles-list-muted">vacant</span>;
  }
  if (role.occupant_kind === "agent") {
    const name = agentName ?? role.occupant_id?.slice(0, 8) ?? "";
    return (
      <span className="roles-list-occupant">
        <AgentAvatarChip avatarUrl={agentAvatar} label={name} />
        <KindLabel>agent</KindLabel> <strong>{name}</strong>
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
    <span className="roles-list-occupant">
      <HumanAvatarChip avatarUrl={role.occupant_avatar_url} label={displayName} />
      <KindLabel>human</KindLabel> <strong>{displayName}</strong>
    </span>
  );
}

function KindLabel({ children }: { children: React.ReactNode }) {
  return <span className="roles-list-kind">{children}</span>;
}
