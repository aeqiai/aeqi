import type { Role, RoleEdge, RoleType, Trust } from "@/lib/types";

export interface RoleBundle {
  trust: Trust;
  roles: Role[];
  edges: RoleEdge[];
  unavailable?: boolean;
}

export interface AuthoritySegment {
  trust: Trust;
  role: Role;
  relation: "direct" | "identity" | "nested";
}

export interface RoleContextOption {
  id: string;
  trust: Trust;
  role: Role;
  route: AuthoritySegment[];
  status: "available" | "ambiguous";
  routeCount: number;
}

export interface TrustMapNode {
  id: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  segment: AuthoritySegment | null;
  routeIds: string[];
  primaryContextId: string;
  terminalContextIds: string[];
}

export interface TrustMapEdge {
  id: string;
  from: string;
  to: string;
  routeIds: string[];
  relation: AuthoritySegment["relation"];
}

export interface TrustMapLayout {
  nodes: TrustMapNode[];
  edges: TrustMapEdge[];
  byId: Map<string, TrustMapNode>;
  width: number;
  height: number;
}

export const SELF_NODE_ID = "actor:self";

const MAX_ROUTE_DEPTH = 4;
const MAP_NODE_WIDTH = 212;
const MAP_NODE_HEIGHT = 76;
const MAP_SELF_WIDTH = 156;
const MAP_SELF_HEIGHT = 68;
const MAP_LAYER_GAP = 248;
const MAP_SIBLING_COLUMN_GAP = 56;
const MAP_ROW_GAP = 106;
const MAP_X_PAD = 32;
const MAP_Y_PAD = 36;
const MAP_MAX_ROWS_PER_COLUMN = 4;

export function buildTrustMapLayout(contexts: RoleContextOption[]): TrustMapLayout {
  const nodeMap = new Map<string, TrustMapNode>();
  const edgeMap = new Map<string, TrustMapEdge>();
  const layerBuckets = new Map<number, TrustMapNode[]>();
  const sortedContexts = [...contexts].sort(compareRoleContexts);

  nodeMap.set(SELF_NODE_ID, {
    id: SELF_NODE_ID,
    layer: 0,
    x: MAP_X_PAD,
    y: MAP_Y_PAD,
    width: MAP_SELF_WIDTH,
    height: MAP_SELF_HEIGHT,
    segment: null,
    routeIds: sortedContexts.map((ctx) => ctx.id),
    primaryContextId: sortedContexts[0]?.id ?? "",
    terminalContextIds: [],
  });

  for (const context of sortedContexts) {
    let previous = SELF_NODE_ID;
    context.route.forEach((segment, index) => {
      const id = routeNodeId(segment, index);
      const layer = index + 1;
      const terminal = index === context.route.length - 1;
      const existing = nodeMap.get(id);
      if (existing) {
        existing.routeIds.push(context.id);
        if (terminal) existing.terminalContextIds.push(context.id);
      } else {
        const node: TrustMapNode = {
          id,
          layer,
          x: MAP_X_PAD + MAP_SELF_WIDTH + 48 + (layer - 1) * MAP_LAYER_GAP,
          y: MAP_Y_PAD,
          width: MAP_NODE_WIDTH,
          height: MAP_NODE_HEIGHT,
          segment,
          routeIds: [context.id],
          primaryContextId: context.id,
          terminalContextIds: terminal ? [context.id] : [],
        };
        nodeMap.set(id, node);
        const bucket = layerBuckets.get(layer) ?? [];
        bucket.push(node);
        layerBuckets.set(layer, bucket);
      }

      const edgeId = `${previous}->${id}`;
      const edge = edgeMap.get(edgeId);
      if (edge) {
        edge.routeIds.push(context.id);
      } else {
        edgeMap.set(edgeId, {
          id: edgeId,
          from: previous,
          to: id,
          routeIds: [context.id],
          relation: segment.relation,
        });
      }
      previous = id;
    });
  }

  let maxLayer = 0;
  let maxHeight = MAP_Y_PAD * 2 + MAP_SELF_HEIGHT;
  let nextLayerX = MAP_X_PAD + MAP_SELF_WIDTH + 48;
  for (const [layer, nodes] of [...layerBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    maxLayer = Math.max(maxLayer, layer);
    nodes.sort(compareMapNodes);
    const columns = Math.max(1, Math.ceil(nodes.length / MAP_MAX_ROWS_PER_COLUMN));
    const rowsPerColumn = Math.ceil(nodes.length / columns);
    nodes.forEach((node, index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      node.x = nextLayerX + column * (MAP_NODE_WIDTH + MAP_SIBLING_COLUMN_GAP);
      node.y = MAP_Y_PAD + row * MAP_ROW_GAP + column * Math.floor(MAP_ROW_GAP / 2);
      maxHeight = Math.max(maxHeight, node.y + MAP_NODE_HEIGHT + MAP_Y_PAD);
    });
    nextLayerX +=
      columns * MAP_NODE_WIDTH + Math.max(0, columns - 1) * MAP_SIBLING_COLUMN_GAP + MAP_LAYER_GAP;
  }

  const height = Math.max(380, maxHeight);
  const self = nodeMap.get(SELF_NODE_ID);
  if (self) {
    self.y = Math.max(MAP_Y_PAD, Math.floor(height / 2 - MAP_SELF_HEIGHT / 2));
  }

  const width =
    maxLayer === 0
      ? MAP_X_PAD * 2 + MAP_SELF_WIDTH
      : Math.max(MAP_X_PAD * 2 + MAP_SELF_WIDTH, nextLayerX - MAP_LAYER_GAP + MAP_X_PAD);

  return {
    nodes: [...nodeMap.values()].sort((a, b) => a.layer - b.layer || a.y - b.y),
    edges: [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    byId: nodeMap,
    width,
    height,
  };
}

export function buildRoleContexts(
  bundles: RoleBundle[],
  userId: string,
  controlledTrustIds: string[],
): RoleContextOption[] {
  if (!userId) return [];

  const byTrust = new Map(bundles.map((bundle) => [bundle.trust.id, bundle]));
  const allRoles = bundles.flatMap((bundle) => bundle.roles.map((role) => ({ bundle, role })));
  const controlledTrusts = new Set(controlledTrustIds);
  const directRoutes: AuthoritySegment[][] = allRoles
    .filter(
      ({ role }) =>
        (role.occupant_kind === "human" && role.occupant_id === userId) ||
        (role.occupant_kind === "trust" &&
          (role.occupant_id ? controlledTrusts.has(role.occupant_id) : false)),
    )
    .map(({ bundle, role }) => [
      {
        trust: bundle.trust,
        role,
        relation: role.occupant_kind === "human" ? ("direct" as const) : ("identity" as const),
      },
    ]);

  const queue = [...directRoutes];
  const routes: AuthoritySegment[][] = [];
  const seenRoutes = new Set<string>();

  while (queue.length > 0) {
    const route = queue.shift();
    if (!route) continue;
    const key = route.map((segment) => `${segment.trust.id}:${segment.role.id}`).join(">");
    if (seenRoutes.has(key)) continue;
    seenRoutes.add(key);
    routes.push(route);

    if (route.length >= MAX_ROUTE_DEPTH) continue;
    const terminalTrust = route[route.length - 1].trust;
    for (const { bundle, role } of allRoles) {
      if (role.occupant_kind !== "trust" || role.occupant_id !== terminalTrust.id) continue;
      if (!byTrust.has(bundle.trust.id)) continue;
      if (route.some((segment) => segment.role.id === role.id)) continue;
      queue.push([...route, { trust: bundle.trust, role, relation: "nested" }]);
    }
  }

  const counts = new Map<string, number>();
  for (const route of routes) {
    const terminal = route[route.length - 1];
    const id = `${terminal.trust.id}:${terminal.role.id}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return routes
    .map((route) => {
      const terminal = route[route.length - 1];
      const terminalId = `${terminal.trust.id}:${terminal.role.id}`;
      const routeCount = counts.get(terminalId) ?? 1;
      return {
        id: `${terminalId}:${route.map((segment, index) => routeNodeId(segment, index)).join(">")}`,
        trust: terminal.trust,
        role: terminal.role,
        route,
        status: routeCount > 1 ? "ambiguous" : "available",
        routeCount,
      } satisfies RoleContextOption;
    })
    .sort(compareRoleContexts);
}

export function pickDefaultContext(contexts: RoleContextOption[], activeTrust: Trust | null) {
  if (contexts.length === 0) return null;
  if (activeTrust) {
    const activeMatch = contexts.find((ctx) => ctx.trust.id === activeTrust.id);
    if (activeMatch) return activeMatch;
  }
  return contexts[0];
}

export function roleTypeLabel(type: RoleType) {
  if (type === "operational") return "Operator";
  if (type === "director") return "Director";
  if (type === "owner") return "Owner";
  return "Advisor";
}

export function relationLabel(relation: AuthoritySegment["relation"]) {
  if (relation === "direct") return "Direct";
  if (relation === "identity") return "TRUST identity";
  return "Nested authority";
}

export function persistRoleContext(ctx: RoleContextOption, userId: string | null) {
  try {
    localStorage.setItem(
      "aeqi_role_context",
      JSON.stringify({
        user_id: userId,
        trust_id: ctx.trust.id,
        role_id: ctx.role.id,
        route: ctx.route.map((segment) => ({
          trust_id: segment.trust.id,
          trust_name: segment.trust.name,
          role_id: segment.role.id,
          role_title: segment.role.title,
          relation: segment.relation,
        })),
      }),
    );
  } catch {
    // localStorage may be unavailable; navigation still works.
  }
}

export function routeNodeId(segment: AuthoritySegment, index?: number) {
  const layer = index === undefined ? "" : `${index + 1}:`;
  return `role:${layer}${segment.trust.id}:${segment.role.id}`;
}

function compareRoleContexts(a: RoleContextOption, b: RoleContextOption) {
  if (a.route.length !== b.route.length) return a.route.length - b.route.length;
  return contextSortKey(a).localeCompare(contextSortKey(b));
}

function compareMapNodes(a: TrustMapNode, b: TrustMapNode) {
  const left = a.segment;
  const right = b.segment;
  return [left?.trust.name ?? "", left?.role.title ?? "", a.id]
    .join(":")
    .localeCompare([right?.trust.name ?? "", right?.role.title ?? "", b.id].join(":"));
}

function contextSortKey(ctx: RoleContextOption) {
  return [
    ctx.trust.name,
    ctx.role.title,
    ctx.trust.id,
    ctx.role.id,
    ctx.route.map((segment) => `${segment.trust.id}:${segment.role.id}`).join(">"),
  ].join(":");
}
