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

  const columns = useMemo<Array<TableColumn<Role>>>(
    () => [
      {
        key: "title",
        header: "Title",
        width: "28%",
        cell: (role) =>
          role.title || <em style={{ color: "var(--color-text-muted)" }}>(untitled)</em>,
      },
      {
        key: "occupant",
        header: "Occupant",
        width: "30%",
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
        cell: (role) => <ParentsCell roleId={role.id} allRoles={allRolesRef} edges={edges} />,
      },
      {
        key: "created",
        header: "Created",
        width: "16%",
        align: "end",
        cell: (role) => role.created_at.slice(0, 10),
      },
    ],
    [agentNames, agentAvatars, allRolesRef, edges],
  );

  return (
    <div className="roles-list">
      <Table<Role>
        columns={columns}
        data={ordered}
        rowKey={(role) => role.id}
        onRowClick={onSelectRole}
        ariaLabel="Roles"
      />
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

  if (parents.length === 0) return <span style={{ color: "var(--color-text-muted)" }}>—</span>;
  return <>{parents.join(", ")}</>;
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
    return (
      <img
        src={avatarUrl}
        alt=""
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: 4,
          objectFit: "cover",
          flexShrink: 0,
          verticalAlign: "middle",
          display: "inline-block",
          marginRight: 4,
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        flexShrink: 0,
        verticalAlign: "middle",
        marginRight: 4,
      }}
    >
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
    return (
      <img
        src={avatarUrl}
        alt=""
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
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
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
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
    return <span style={{ color: "var(--color-text-muted)" }}>vacant</span>;
  }
  if (role.occupant_kind === "agent") {
    const name = agentName ?? role.occupant_id?.slice(0, 8) ?? "";
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <AgentAvatarChip avatarUrl={agentAvatar} label={name} />
        <KindLabel>agent</KindLabel> <strong style={{ fontWeight: 500 }}>{name}</strong>
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
      <HumanAvatarChip avatarUrl={role.occupant_avatar_url} label={displayName} />
      <KindLabel>human</KindLabel> <strong style={{ fontWeight: 500 }}>{displayName}</strong>
    </span>
  );
}

function KindLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        color: "var(--color-text-muted)",
        fontSize: 11,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        marginRight: 4,
      }}
    >
      {children}
    </span>
  );
}
