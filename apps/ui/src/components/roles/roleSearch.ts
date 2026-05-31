import type { Role } from "@/lib/types";
import { labelRoleType } from "./RoleInspectorPrimitives";

export function roleSearchText({
  role,
  agentNames,
  trustNames,
  parents,
}: {
  role: Role;
  agentNames: Map<string, string>;
  trustNames: Map<string, string>;
  parents: Role[];
}): string {
  const parts = [
    role.title,
    labelRoleType(role.role_type),
    role.occupant_kind,
    occupantSearchLabel(role, agentNames, trustNames),
    role.occupant_id,
    ...parents.flatMap((parent) => [
      parent.title,
      labelRoleType(parent.role_type),
      parent.occupant_kind,
      occupantSearchLabel(parent, agentNames, trustNames),
      parent.occupant_id,
    ]),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function occupantSearchLabel(
  role: Role,
  agentNames: Map<string, string>,
  trustNames: Map<string, string>,
): string {
  if (role.occupant_kind === "agent") return agentNames.get(role.occupant_id ?? "") ?? "";
  if (role.occupant_kind === "trust") return trustNames.get(role.occupant_id ?? "") ?? "";
  if (role.occupant_kind === "human") return role.occupant_name ?? "";
  return "vacant";
}
