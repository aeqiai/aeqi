import { useMemo } from "react";
import type { Role, RoleEdge } from "@/lib/types";

export interface RolesListProps {
  roles: Role[];
  edges: RoleEdge[];
  agentNames: Map<string, string>;
  onSelectRole: (role: Role) => void;
}

export default function RolesList({ roles, edges, agentNames, onSelectRole }: RolesListProps) {
  const parentTitleByChild = useMemo(() => {
    const titleById = new Map(roles.map((r) => [r.id, r.title || "(untitled)"]));
    const map = new Map<string, string[]>();
    for (const e of edges) {
      const parentTitle = titleById.get(e.parent_role_id);
      if (!parentTitle) continue;
      const list = map.get(e.child_role_id) ?? [];
      list.push(parentTitle);
      map.set(e.child_role_id, list);
    }
    return map;
  }, [roles, edges]);

  return (
    <div className="roles-list">
      <div className="roles-list-head" role="row">
        <span>Title</span>
        <span>Occupant</span>
        <span>Reports to</span>
        <span>Created</span>
      </div>
      {roles.map((role) => {
        const parents = parentTitleByChild.get(role.id) ?? [];
        return (
          <button
            key={role.id}
            type="button"
            className="roles-list-row"
            onClick={() => onSelectRole(role)}
            role="row"
          >
            <span className="roles-list-cell-title">{role.title || <em>(untitled)</em>}</span>
            <span className="roles-list-cell-occupant">
              <OccupantInline role={role} agentName={agentNames.get(role.occupant_id ?? "")} />
            </span>
            <span className="roles-list-cell-parents">
              {parents.length === 0 ? (
                <span className="roles-list-cell-muted">—</span>
              ) : (
                parents.join(", ")
              )}
            </span>
            <span className="roles-list-cell-meta">{role.created_at.slice(0, 10)}</span>
          </button>
        );
      })}
    </div>
  );
}

function OccupantInline({ role, agentName }: { role: Role; agentName?: string }) {
  if (role.occupant_kind === "vacant") {
    return <span className="roles-list-cell-muted">vacant</span>;
  }
  if (role.occupant_kind === "agent") {
    return (
      <span>
        <span className="roles-list-cell-kind">agent</span>{" "}
        <strong>{agentName ?? role.occupant_id?.slice(0, 8) ?? ""}</strong>
      </span>
    );
  }
  return (
    <span>
      <span className="roles-list-cell-kind">human</span>{" "}
      <strong>{role.occupant_id?.slice(0, 12) ?? ""}</strong>
    </span>
  );
}
