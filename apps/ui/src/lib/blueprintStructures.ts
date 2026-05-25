import type { BlueprintSeedRole, BlueprintSeedRoleEdge, SingleBlueprint } from "@/lib/types";

export interface BlueprintStructurePreview {
  id: string;
  title: string;
  subtitle: string;
  rootKeys: string[];
  roles: BlueprintSeedRole[];
  edges: BlueprintSeedRoleEdge[];
  layers: BlueprintSeedRole[][];
}

export function countBlueprintStructures(template: SingleBlueprint): number {
  return describeBlueprintStructures(template).length;
}

export function describeBlueprintStructures(
  template: SingleBlueprint,
): BlueprintStructurePreview[] {
  const roles = template.seed_roles ?? [];
  const edges = template.seed_role_edges ?? [];

  if (roles.length === 0) {
    return [describeFallbackStructure(template)];
  }

  const roleByKey = new Map<string, BlueprintSeedRole>();
  const roleOrder = new Map<string, number>();
  for (const [idx, role] of roles.entries()) {
    roleByKey.set(role.key, role);
    roleOrder.set(role.key, idx);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const role of roles) {
    adjacency.set(role.key, new Set());
  }
  for (const edge of edges) {
    if (!roleByKey.has(edge.parent) || !roleByKey.has(edge.child)) {
      continue;
    }
    adjacency.get(edge.parent)?.add(edge.child);
    adjacency.get(edge.child)?.add(edge.parent);
  }

  const components = collectComponents(roles, adjacency);
  components.sort((a, b) => minRoleIndex(a, roleOrder) - minRoleIndex(b, roleOrder));

  return components.map((componentKeys) => {
    const componentSet = new Set(componentKeys);
    const componentRoles = componentKeys
      .map((key) => roleByKey.get(key))
      .filter((role): role is BlueprintSeedRole => !!role);
    const componentEdges = edges.filter(
      (edge) => componentSet.has(edge.parent) && componentSet.has(edge.child),
    );
    const incoming = buildIncoming(componentRoles, componentEdges);
    const rootRoles = componentRoles.filter((role) => (incoming.get(role.key)?.length ?? 0) === 0);
    const visibleRoots = rootRoles.length > 0 ? rootRoles : [componentRoles[0]];
    const rootKeys = visibleRoots.map((role) => role.key);
    const title =
      visibleRoots.length === 1
        ? visibleRoots[0].title
        : `${visibleRoots[0].title} + ${visibleRoots.length - 1} more top roles`;
    const subtitleParts = [
      `${componentRoles.length} ${componentRoles.length === 1 ? "role" : "roles"}`,
      `${componentEdges.length} ${componentEdges.length === 1 ? "link" : "links"}`,
    ];
    if (visibleRoots.length > 1) {
      subtitleParts.push(`${visibleRoots.length} top roles`);
    }
    return {
      id: rootKeys.join("+") || componentKeys[0] || "structure",
      title,
      subtitle: subtitleParts.join(" · "),
      rootKeys,
      roles: componentRoles,
      edges: componentEdges,
      layers: computeLayers(componentRoles, componentEdges),
    };
  });
}

function describeFallbackStructure(template: SingleBlueprint): BlueprintStructurePreview {
  const rootName = template.root?.name ?? template.name;
  const root: BlueprintSeedRole = {
    key: "default",
    title: rootName,
    default_occupant_agent: "default",
  };
  const children: BlueprintSeedRole[] = (template.seed_agents ?? []).map((seed, i) => ({
    key: `seed-${i}`,
    title: seed.role || seed.name,
    default_occupant_agent: seed.name,
  }));
  const roles = [root, ...children];
  return {
    id: root.key,
    title: rootName,
    subtitle: `1 top role · ${children.length} ${children.length === 1 ? "agent" : "agents"}`,
    rootKeys: [root.key],
    roles,
    edges: [],
    layers: children.length > 0 ? [[root], children] : [[root]],
  };
}

function collectComponents(
  roles: BlueprintSeedRole[],
  adjacency: Map<string, Set<string>>,
): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const role of roles) {
    if (seen.has(role.key)) continue;
    const queue = [role.key];
    const component: string[] = [];
    seen.add(role.key);
    while (queue.length > 0) {
      const key = queue.shift()!;
      component.push(key);
      for (const next of adjacency.get(key) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    out.push(component);
  }
  return out;
}

function minRoleIndex(keys: string[], order: Map<string, number>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const idx = order.get(key);
    if (idx != null && idx < min) min = idx;
  }
  return min;
}

function buildIncoming(
  roles: BlueprintSeedRole[],
  edges: BlueprintSeedRoleEdge[],
): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const role of roles) incoming.set(role.key, []);
  for (const edge of edges) {
    if (!incoming.has(edge.child)) continue;
    incoming.get(edge.child)!.push(edge.parent);
  }
  return incoming;
}

function computeLayers(
  roles: BlueprintSeedRole[],
  edges: BlueprintSeedRoleEdge[],
): BlueprintSeedRole[][] {
  const incoming = buildIncoming(roles, edges);
  const depth = new Map<string, number>();

  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    if (parents.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const parent of parents) {
      d = Math.max(d, visit(parent, seen) + 1);
    }
    depth.set(id, d);
    return d;
  };

  for (const role of roles) visit(role.key, new Set<string>());

  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const layers: BlueprintSeedRole[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const role of roles) {
    layers[depth.get(role.key) ?? 0].push(role);
  }
  return layers;
}
