import type { Role, RoleEdge, RoleType, Company } from "@/lib/types";

export interface RoleBundle {
  company: Company;
  roles: Role[];
  edges: RoleEdge[];
  unavailable?: boolean;
}

export interface AuthoritySegment {
  company: Company;
  role: Role;
  relation: "direct" | "identity" | "nested";
}

export interface RoleContextOption {
  id: string;
  company: Company;
  role: Role;
  route: AuthoritySegment[];
  status: "available" | "ambiguous";
  routeCount: number;
}

export interface CompanyMapNode {
  id: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "self" | "company";
  company: Company | null;
  routeIds: string[];
  primaryContextId: string;
  terminalContextIds: string[];
}

export interface CompanyMapEdge {
  id: string;
  from: string;
  to: string;
  routeIds: string[];
  role: Role | null;
  relation: AuthoritySegment["relation"];
  label: string;
}

export interface CompanyMapLayout {
  nodes: CompanyMapNode[];
  edges: CompanyMapEdge[];
  byId: Map<string, CompanyMapNode>;
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

export function buildCompanyMapLayout(
  contexts: RoleContextOption[],
  companies: Company[] = [],
): CompanyMapLayout {
  const nodeMap = new Map<string, CompanyMapNode>();
  const edgeMap = new Map<string, CompanyMapEdge>();
  const sortedContexts = [...contexts].sort(compareRoleContexts);
  const trustById = new Map<string, Company>();
  for (const company of companies) trustById.set(company.id, company);
  for (const context of sortedContexts) {
    trustById.set(context.company.id, context.company);
    for (const segment of context.route) trustById.set(segment.company.id, segment.company);
  }

  nodeMap.set(SELF_NODE_ID, {
    id: SELF_NODE_ID,
    layer: 0,
    x: MAP_X_PAD,
    y: MAP_Y_PAD,
    width: MAP_SELF_WIDTH,
    height: MAP_SELF_HEIGHT,
    kind: "self",
    company: null,
    routeIds: sortedContexts.map((ctx) => ctx.id),
    primaryContextId: sortedContexts[0]?.id ?? "",
    terminalContextIds: [],
  });

  const ensureCompanyNode = (
    company: Company,
    layer: number,
    contextId: string,
    terminal: boolean,
  ): CompanyMapNode => {
    const id = trustNodeId(company.id);
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

    const node: CompanyMapNode = {
      id,
      layer,
      x: MAP_X_PAD + MAP_SELF_WIDTH + 72 + (layer - 1) * MAP_LAYER_GAP,
      y: MAP_Y_PAD,
      width: MAP_NODE_WIDTH,
      height: trustNodeHeight(terminal ? 1 : 0),
      kind: "company",
      company,
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
      if (index === 0 && segment.role.occupant_kind === "company" && segment.role.occupant_id) {
        const originCompany = trustById.get(segment.role.occupant_id);
        if (originCompany) {
          const origin = ensureCompanyNode(originCompany, 1, context.id, false);
          upsertEdge(SELF_NODE_ID, origin.id, context.id, null, "identity", "");
          previous = origin.id;
          layer = 2;
        }
      }
      const terminal = index === context.route.length - 1;
      const node = ensureCompanyNode(segment.company, layer, context.id, terminal);
      upsertEdge(previous, node.id, context.id, segment.role, segment.relation, segment.role.title);
      previous = node.id;
    });
  }

  let maxLayer = 0;
  let maxHeight = MAP_Y_PAD * 2 + MAP_SELF_HEIGHT;
  let nextLayerX = MAP_X_PAD + MAP_SELF_WIDTH + 48;
  const layerBuckets = new Map<number, CompanyMapNode[]>();
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
  controlledCompanyIds: string[],
): RoleContextOption[] {
  if (!userId) return [];

  const byCompany = new Map(bundles.map((bundle) => [bundle.company.id, bundle]));
  const allRoles = bundles.flatMap((bundle) => bundle.roles.map((role) => ({ bundle, role })));
  const controlledCompanies = new Set(controlledCompanyIds);
  const humanPrincipalIds = new Set([userId, ...controlledCompanyIds].filter(Boolean));
  const directRoutes: AuthoritySegment[][] = allRoles
    .filter(
      ({ role }) =>
        (role.occupant_kind === "human" &&
          (role.occupant_id ? humanPrincipalIds.has(role.occupant_id) : false)) ||
        (role.occupant_kind === "company" &&
          (role.occupant_id ? controlledCompanies.has(role.occupant_id) : false)),
    )
    .map(({ bundle, role }) => [
      {
        company: bundle.company,
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
    const key = route.map((segment) => `${segment.company.id}:${segment.role.id}`).join(">");
    if (seenRoutes.has(key)) continue;
    seenRoutes.add(key);
    routes.push(route);

    if (route.length >= MAX_ROUTE_DEPTH) continue;
    const terminalCompany = route[route.length - 1].company;
    for (const { bundle, role } of allRoles) {
      if (role.occupant_kind !== "company" || role.occupant_id !== terminalCompany.id) continue;
      if (!byCompany.has(bundle.company.id)) continue;
      if (route.some((segment) => segment.role.id === role.id)) continue;
      queue.push([...route, { company: bundle.company, role, relation: "nested" }]);
    }
  }

  const counts = new Map<string, number>();
  for (const route of routes) {
    const terminal = route[route.length - 1];
    const id = `${terminal.company.id}:${terminal.role.id}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return routes
    .map((route) => {
      const terminal = route[route.length - 1];
      const terminalId = `${terminal.company.id}:${terminal.role.id}`;
      const routeCount = counts.get(terminalId) ?? 1;
      return {
        id: `${terminalId}:${route.map((segment, index) => routeNodeId(segment, index)).join(">")}`,
        company: terminal.company,
        role: terminal.role,
        route,
        status: routeCount > 1 ? "ambiguous" : "available",
        routeCount,
      } satisfies RoleContextOption;
    })
    .sort(compareRoleContexts);
}

export function collapseRoleContextsByTerminal(contexts: RoleContextOption[]): RoleContextOption[] {
  const byTerminal = new Map<string, RoleContextOption>();
  for (const context of contexts) {
    const key = terminalContextKey(context);
    const current = byTerminal.get(key);
    if (!current || compareRouteRepresentatives(context, current) < 0) {
      byTerminal.set(key, context);
    }
  }
  return [...byTerminal.values()].sort(compareRoleContexts);
}

export function pickDefaultContext(contexts: RoleContextOption[], activeCompany: Company | null) {
  if (contexts.length === 0) return null;
  if (activeCompany) {
    const activeMatch = contexts.find((ctx) => ctx.company.id === activeCompany.id);
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
  if (relation === "identity") return "COMPANY identity";
  return "Nested authority";
}

export function persistRoleContext(ctx: RoleContextOption, userId: string | null) {
  try {
    localStorage.setItem(
      "aeqi_role_context",
      JSON.stringify({
        user_id: userId,
        company_id: ctx.company.id,
        role_id: ctx.role.id,
        route: ctx.route.map((segment) => ({
          company_id: segment.company.id,
          company_name: segment.company.name,
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
  return `role:${layer}${segment.company.id}:${segment.role.id}`;
}

function compareRoleContexts(a: RoleContextOption, b: RoleContextOption) {
  if (a.route.length !== b.route.length) return a.route.length - b.route.length;
  return contextSortKey(a).localeCompare(contextSortKey(b));
}

function compareMapNodes(a: CompanyMapNode, b: CompanyMapNode) {
  const left = a.company;
  const right = b.company;
  return [left?.name ?? "", a.id].join(":").localeCompare([right?.name ?? "", b.id].join(":"));
}

function trustNodeId(companyId: string) {
  return `company:${companyId}`;
}

function trustNodeHeight(roleCount: number) {
  if (roleCount <= 0) return MAP_NODE_HEIGHT;
  return MAP_NODE_HEIGHT + Math.min(roleCount, 3) * MAP_ROLE_CARD_HEIGHT;
}

function contextSortKey(ctx: RoleContextOption) {
  return [
    ctx.company.name,
    ctx.role.title,
    ctx.company.id,
    ctx.role.id,
    ctx.route.map((segment) => `${segment.company.id}:${segment.role.id}`).join(">"),
  ].join(":");
}

function terminalContextKey(ctx: RoleContextOption) {
  return `${ctx.company.id}:${ctx.role.id}`;
}

function compareRouteRepresentatives(a: RoleContextOption, b: RoleContextOption) {
  if (a.route.length !== b.route.length) return b.route.length - a.route.length;
  return contextSortKey(a).localeCompare(contextSortKey(b));
}
