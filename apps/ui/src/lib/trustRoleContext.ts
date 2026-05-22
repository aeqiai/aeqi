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
  kind: "self" | "trust";
  trust: Trust | null;
  routeIds: string[];
  primaryContextId: string;
  terminalContextIds: string[];
}

export interface TrustMapEdge {
  id: string;
  from: string;
  to: string;
  routeIds: string[];
  role: Role | null;
  relation: AuthoritySegment["relation"];
  label: string;
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
const MAP_NODE_WIDTH = 278;
const MAP_NODE_HEIGHT = 96;
const MAP_SELF_WIDTH = 156;
const MAP_SELF_HEIGHT = 68;
const MAP_ROLE_CARD_HEIGHT = 92;
const MAP_LAYER_GAP = 342;
const MAP_SIBLING_COLUMN_GAP = 84;
const MAP_ROW_GAP = 300;
const MAP_X_PAD = 52;
const MAP_Y_PAD = 52;
const MAP_MAX_ROWS_PER_COLUMN = 4;

export function buildTrustMapLayout(
  contexts: RoleContextOption[],
  trusts: Trust[] = [],
): TrustMapLayout {
  const nodeMap = new Map<string, TrustMapNode>();
  const edgeMap = new Map<string, TrustMapEdge>();
  const sortedContexts = [...contexts].sort(compareRoleContexts);
  const trustById = new Map<string, Trust>();
  for (const trust of trusts) trustById.set(trust.id, trust);
  for (const context of sortedContexts) {
    trustById.set(context.trust.id, context.trust);
    for (const segment of context.route) trustById.set(segment.trust.id, segment.trust);
  }

  nodeMap.set(SELF_NODE_ID, {
    id: SELF_NODE_ID,
    layer: 0,
    x: MAP_X_PAD,
    y: MAP_Y_PAD,
    width: MAP_SELF_WIDTH,
    height: MAP_SELF_HEIGHT,
    kind: "self",
    trust: null,
    routeIds: sortedContexts.map((ctx) => ctx.id),
    primaryContextId: sortedContexts[0]?.id ?? "",
    terminalContextIds: [],
  });

  const ensureTrustNode = (
    trust: Trust,
    layer: number,
    contextId: string,
    terminal: boolean,
  ): TrustMapNode => {
    const id = trustNodeId(trust.id);
    const existing = nodeMap.get(id);
    if (existing) {
      existing.layer = Math.min(existing.layer, layer);
      if (!existing.routeIds.includes(contextId)) existing.routeIds.push(contextId);
      if (terminal && !existing.terminalContextIds.includes(contextId)) {
        existing.terminalContextIds.push(contextId);
      }
      existing.height = trustNodeHeight(existing.terminalContextIds.length);
      return existing;
    }

    const node: TrustMapNode = {
      id,
      layer,
      x: MAP_X_PAD + MAP_SELF_WIDTH + 72 + (layer - 1) * MAP_LAYER_GAP,
      y: MAP_Y_PAD,
      width: MAP_NODE_WIDTH,
      height: trustNodeHeight(terminal ? 1 : 0),
      kind: "trust",
      trust,
      routeIds: [contextId],
      primaryContextId: contextId,
      terminalContextIds: terminal ? [contextId] : [],
    };
    nodeMap.set(id, node);
    return node;
  };

  const upsertEdge = (
    from: string,
    to: string,
    contextId: string,
    role: Role | null,
    relation: AuthoritySegment["relation"],
    label: string,
  ) => {
    const edgeId = role ? `${from}->${to}:${role.id}` : `${from}->${to}:identity`;
    const edge = edgeMap.get(edgeId);
    if (edge) {
      if (!edge.routeIds.includes(contextId)) edge.routeIds.push(contextId);
      return;
    }
    edgeMap.set(edgeId, {
      id: edgeId,
      from,
      to,
      routeIds: [contextId],
      role,
      relation,
      label,
    });
  };

  for (const context of sortedContexts) {
    let previous = SELF_NODE_ID;
    context.route.forEach((segment, index) => {
      let layer = index + 1;
      if (index === 0 && segment.role.occupant_kind === "trust" && segment.role.occupant_id) {
        const originTrust = trustById.get(segment.role.occupant_id);
        if (originTrust) {
          const origin = ensureTrustNode(originTrust, 1, context.id, false);
          upsertEdge(SELF_NODE_ID, origin.id, context.id, null, "identity", "");
          previous = origin.id;
          layer = 2;
        }
      }
      const terminal = index === context.route.length - 1;
      const node = ensureTrustNode(segment.trust, layer, context.id, terminal);
      upsertEdge(previous, node.id, context.id, segment.role, segment.relation, segment.role.title);
      previous = node.id;
    });
  }

  let maxLayer = 0;
  let maxHeight = MAP_Y_PAD * 2 + MAP_SELF_HEIGHT;
  let nextLayerX = MAP_X_PAD + MAP_SELF_WIDTH + 48;
  const layerBuckets = new Map<number, TrustMapNode[]>();
  for (const node of nodeMap.values()) {
    if (node.kind === "self") continue;
    const bucket = layerBuckets.get(node.layer) ?? [];
    bucket.push(node);
    layerBuckets.set(node.layer, bucket);
  }
  for (const [layer, nodes] of [...layerBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    maxLayer = Math.max(maxLayer, layer);
    nodes.sort(compareMapNodes);
    const columns = Math.max(1, Math.ceil(nodes.length / MAP_MAX_ROWS_PER_COLUMN));
    const rowsPerColumn = Math.ceil(nodes.length / columns);
    nodes.forEach((node, index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      node.x = nextLayerX + column * (MAP_NODE_WIDTH + MAP_SIBLING_COLUMN_GAP);
      node.y = MAP_Y_PAD + row * MAP_ROW_GAP + column * Math.floor(MAP_ROW_GAP / 3);
      maxHeight = Math.max(maxHeight, node.y + MAP_NODE_HEIGHT + MAP_Y_PAD);
    });
    nextLayerX +=
      columns * MAP_NODE_WIDTH + Math.max(0, columns - 1) * MAP_SIBLING_COLUMN_GAP + MAP_LAYER_GAP;
  }

  const height = Math.max(540, maxHeight);
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
  const left = a.trust;
  const right = b.trust;
  return [left?.name ?? "", a.id].join(":").localeCompare([right?.name ?? "", b.id].join(":"));
}

function trustNodeId(trustId: string) {
  return `trust:${trustId}`;
}

function trustNodeHeight(roleCount: number) {
  if (roleCount <= 0) return MAP_NODE_HEIGHT;
  return MAP_NODE_HEIGHT + Math.min(roleCount, 3) * MAP_ROLE_CARD_HEIGHT;
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
