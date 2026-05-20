import type { Role } from "@/lib/types";
import RoleNode from "./RoleNode";

export interface RolesCardsProps {
  roles: Role[];
  agentNames: Map<string, string>;
  /** Avatar URLs keyed by agent id, sourced from the daemon store. */
  agentAvatars: Map<string, string>;
  onSelectRole: (role: Role) => void;
  selectedRoleId?: string | null;
}

export default function RolesCards({
  roles,
  agentNames,
  agentAvatars,
  onSelectRole,
  selectedRoleId,
}: RolesCardsProps) {
  return (
    <div className="roles-cards-grid" role="list" aria-label="Roles">
      {roles.map((role) => (
        <RoleNode
          key={role.id}
          role={role}
          agentName={role.occupant_id ? agentNames.get(role.occupant_id) : undefined}
          agentAvatar={role.occupant_id ? agentAvatars.get(role.occupant_id) : undefined}
          onClick={() => onSelectRole(role)}
          selected={role.id === selectedRoleId}
          className="role-node--card"
        />
      ))}
    </div>
  );
}
