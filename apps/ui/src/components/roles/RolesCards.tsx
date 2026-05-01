import type { Role } from "@/lib/types";
import RoleNode from "./RoleNode";

export interface RolesCardsProps {
  roles: Role[];
  agentNames: Map<string, string>;
  onSelectRole: (role: Role) => void;
}

export default function RolesCards({ roles, agentNames, onSelectRole }: RolesCardsProps) {
  return (
    <div className="roles-cards-grid" role="list" aria-label="Roles">
      {roles.map((role) => (
        <RoleNode
          key={role.id}
          role={role}
          agentName={role.occupant_id ? agentNames.get(role.occupant_id) : undefined}
          onClick={() => onSelectRole(role)}
          className="role-node--card"
        />
      ))}
    </div>
  );
}
