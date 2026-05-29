import { useMemo } from "react";
import type { Role, RoleEdge, RoleType } from "@/lib/types";
import { Table, type TableColumn } from "../ui";
import BlockAvatar from "../BlockAvatar";

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

// Bucket order: directors first (board), then operational (CEO/C-suite/agents),
// then advisors. Within each bucket, stable original order.
const BUCKET_ORDER: RoleType[] = ["director", "operational", "advisor"];

function sortByBucket(roles: Role[]): Role[] {
  const bucketRank = new Map<RoleType, number>(BUCKET_ORDER.map((t, i) => [t, i]));
  return [...roles].sort((a, b) => {
    const ra = bucketRank.get(a.role_type) ?? BUCKET_ORDER.length;
    const rb = bucketRank.get(b.role_type) ?? BUCKET_ORDER.length;
    return ra - rb;
  });
}

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
  const ordered = useMemo(() => sortByBucket(roles), [roles]);
  const allRolesRef = allRoles ?? roles;

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
        header: "Title",
        width: "28%",
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
        key: "occupant",
        header: "Occupant",
        width: "30%",
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
        width: "26%",
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
        width: "16%",
        align: "end",
        sortable: true,
        sortAccessor: (role) => role.created_at,
        cell: (role) => <span className="roles-list-date">{role.created_at.slice(0, 10)}</span>,
      },
    ],
    [agentNames, agentAvatars, allRolesRef, edges, ambiguousTitles, firstParentTitle],
  );

  return (
    <div className="trust-roles-table">
      <Table<Role>
        columns={columns}
        data={ordered}
        rowKey={(role) => role.id}
        onRowClick={onSelectRole}
        density="compact"
        scrollWidth="sm"
        ariaLabel="Roles"
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
  const parts: string[] = [];
  for (const p of parents) {
    const title = (p.title || "(untitled)").trim();
    if (ambiguousTitles.has(title)) {
      const occ = parentOccupantLabel(p, agentNames);
      parts.push(occ ? `${title} · ${occ}` : title);
    } else {
      parts.push(title);
    }
  }
  return <>{parts.join(", ")}</>;
}

function parentOccupantLabel(role: Role, agentNames: Map<string, string>): string {
  if (role.occupant_kind === "vacant") return "vacant";
  if (role.occupant_kind === "agent") {
    return agentNames.get(role.occupant_id ?? "") ?? role.occupant_id?.slice(0, 6) ?? "";
  }
  return role.occupant_name ?? (role.occupant_id ? `${role.occupant_id.slice(0, 6)}…` : "");
}

const AVATAR_SIZE = 18;

/**
 * Avatar render contract — matches RoleNode (the chart/cards surface):
 *
 *   agent + URL    → square <img> (borderRadius 4) — block aesthetic
 *   agent + no URL → BlockAvatar identicon (already borderRadius 4)
 *   human + URL    → circular <img> (borderRadius 999px)
 *   human + no URL → circular initials chip (borderRadius 999px)
 *
 * Square-vs-circle is the agent/human shape rule shipped on RoleNode.
 */
function AgentAvatarChip({
  avatarUrl,
  label,
}: {
  avatarUrl: string | null | undefined;
  label: string;
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="roles-list-avatar roles-list-avatar--agent" />;
  }
  return (
    <span aria-hidden className="roles-list-avatar-shell">
      <BlockAvatar name={label} size={AVATAR_SIZE} />
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
