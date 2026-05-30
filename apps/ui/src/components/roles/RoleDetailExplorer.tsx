import type { Role, RoleEdge } from "@/lib/types";
import { labelRoleType } from "./RoleInspectorPrimitives";

interface RoleTreeNode {
  role: Role;
  children: RoleTreeNode[];
}

function buildRoleForest(roles: Role[], edges: RoleEdge[]): RoleTreeNode[] {
  const nodes = new Map<string, RoleTreeNode>();
  const childIds = new Set<string>();

  for (const role of roles) nodes.set(role.id, { role, children: [] });

  for (const edge of edges) {
    const parent = nodes.get(edge.parent_role_id);
    const child = nodes.get(edge.child_role_id);
    if (!parent || !child || parent.role.id === child.role.id) continue;
    parent.children.push(child);
    childIds.add(child.role.id);
  }

  const roots = roles
    .filter((role) => !childIds.has(role.id))
    .map((role) => nodes.get(role.id))
    .filter((node): node is RoleTreeNode => Boolean(node));

  return roots.length
    ? roots
    : roles.map((role) => nodes.get(role.id)).filter((node): node is RoleTreeNode => Boolean(node));
}

function RoleTreeRow({
  node,
  depth,
  activeRoleId,
  onOpenRole,
}: {
  node: RoleTreeNode;
  depth: number;
  activeRoleId: string;
  onOpenRole: (id: string) => void;
}) {
  const role = node.role;
  const active = role.id === activeRoleId;
  const depthClass = `role-detail-explorer-row--depth-${Math.min(depth, 6)}`;

  return (
    <>
      <button
        type="button"
        className={`quest-detail-rail-row role-detail-explorer-row ${depthClass}${
          active ? " is-current" : ""
        }`}
        aria-current={active ? "page" : undefined}
        onClick={() => onOpenRole(role.id)}
      >
        <span className={`role-detail-explorer-dot role-detail-explorer-dot--${role.role_type}`} />
        <span>
          <small>{labelRoleType(role.role_type)}</small>
          <strong>{role.title || "(untitled)"}</strong>
        </span>
      </button>
      {node.children.map((child) => (
        <RoleTreeRow
          key={child.role.id}
          node={child}
          depth={depth + 1}
          activeRoleId={activeRoleId}
          onOpenRole={onOpenRole}
        />
      ))}
    </>
  );
}

export default function RoleDetailExplorer({
  roles,
  edges,
  activeRoleId,
  onOpenRole,
}: {
  roles: Role[];
  edges: RoleEdge[];
  activeRoleId: string;
  onOpenRole: (id: string) => void;
}) {
  const forest = buildRoleForest(roles, edges);

  return (
    <aside className="quest-detail-rail trust-role-detail-explorer" aria-label="Role hierarchy">
      <header className="ideas-workspace-tree-head">
        <span>Explorer</span>
        <small>{roles.length} roles</small>
      </header>
      <div className="quest-detail-rail-list role-detail-explorer-list">
        {forest.map((node) => (
          <RoleTreeRow
            key={node.role.id}
            node={node}
            depth={0}
            activeRoleId={activeRoleId}
            onOpenRole={onOpenRole}
          />
        ))}
      </div>
    </aside>
  );
}
