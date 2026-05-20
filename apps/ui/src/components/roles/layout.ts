import type { Role, RoleEdge } from "@/lib/types";

/**
 * Re-root the role DAG to a subset of roles.
 *
 * In agent-only views (Agents tab list / chart), filtering by occupant kind
 * leaves orphan agents whose original parent is human-occupied or vacant —
 * they would otherwise float to depth 0 alongside true roots like advisors,
 * making the chart look like an advisor leads the C-suite.
 *
 * For each role in the subset, walk parents transitively in the FULL DAG
 * until a parent that is also in the subset is found; emit that as the
 * effective parent edge. If no ancestor is in the subset, the role becomes
 * a true root (no edge emitted). Cycle defence via visited set.
 *
 * Returns edges only between subset roles. The caller is expected to pass
 * the subset itself as the `roles` argument to layoutChart.
 */
export function reRootEdges(subsetIds: Set<string>, allEdges: RoleEdge[]): RoleEdge[] {
  const parentsOf = new Map<string, string[]>();
  for (const e of allEdges) {
    if (!parentsOf.has(e.child_role_id)) parentsOf.set(e.child_role_id, []);
    parentsOf.get(e.child_role_id)!.push(e.parent_role_id);
  }

  const out: RoleEdge[] = [];
  for (const childId of subsetIds) {
    const ancestor = nearestAncestorInSubset(childId, parentsOf, subsetIds);
    if (ancestor) {
      out.push({ parent_role_id: ancestor, child_role_id: childId });
    }
  }
  return out;
}

function nearestAncestorInSubset(
  start: string,
  parentsOf: Map<string, string[]>,
  subsetIds: Set<string>,
): string | null {
  // BFS over parents in the original DAG; first hit in subset wins.
  const visited = new Set<string>([start]);
  const queue: string[] = [...(parentsOf.get(start) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (subsetIds.has(id)) return id;
    for (const p of parentsOf.get(id) ?? []) {
      if (!visited.has(p)) queue.push(p);
    }
  }
  return null;
}

export const NODE_W = 232;
export const NODE_H = 92;
export const H_GAP = 48;
export const V_GAP = 120;
export const PAD = 36;

export interface NodePos {
  role: Role;
  x: number;
  y: number;
  layer: number;
}

export interface EdgePos {
  from: NodePos;
  to: NodePos;
}

export interface ChartLayout {
  nodes: NodePos[];
  edges: EdgePos[];
  width: number;
  height: number;
}

/**
 * Reingold-Tilford tidy-tree layout.
 *
 * Each subtree claims a horizontal slot proportional to its own width:
 *   - Leaf nodes claim exactly NODE_W.
 *   - Interior nodes claim the sum of their children's subtree widths
 *     plus (n-1) * H_GAP between them.
 *   - The parent is centred over its children cluster.
 *
 * This ensures Backend Engineer's column (with a Backend Intern child)
 * gets more horizontal space than a leaf sibling like Frontend Engineer,
 * so subtrees never overlap and branches are visually separable.
 *
 * The graph is treated as a forest rooted at nodes with no parents. If
 * the DAG contains genuine diamonds (one node, two parents) the first
 * parent encountered in DFS wins; the second edge is still drawn but
 * the node keeps the first-assigned position.
 */
export function layoutChart(roles: Role[], edges: RoleEdge[]): ChartLayout {
  if (roles.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const byId = new Map(roles.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  const parentCount = new Map<string, number>();

  for (const r of roles) {
    children.set(r.id, []);
    parentCount.set(r.id, 0);
  }
  for (const e of edges) {
    if (!byId.has(e.parent_role_id) || !byId.has(e.child_role_id)) continue;
    children.get(e.parent_role_id)!.push(e.child_role_id);
    parentCount.set(e.child_role_id, (parentCount.get(e.child_role_id) ?? 0) + 1);
  }

  // Sort children alphabetically for deterministic left-to-right ordering.
  for (const [, kids] of children) {
    kids.sort((a, b) => {
      const ra = byId.get(a);
      const rb = byId.get(b);
      if (!ra || !rb) return 0;
      return ra.title.localeCompare(rb.title) || a.localeCompare(b);
    });
  }

  // Roots = nodes with no parents in the valid edge set.
  const roots = roles
    .filter((r) => (parentCount.get(r.id) ?? 0) === 0)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  // --- Phase 1: compute subtree width for every node (bottom-up). ---
  const subtreeWidth = new Map<string, number>();
  const nodeDepth = new Map<string, number>();

  const measureSubtree = (id: string, depth: number): number => {
    nodeDepth.set(id, depth);
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      subtreeWidth.set(id, NODE_W);
      return NODE_W;
    }
    let total = 0;
    for (const kid of kids) {
      total += measureSubtree(kid, depth + 1);
    }
    total += (kids.length - 1) * H_GAP;
    const w = Math.max(NODE_W, total);
    subtreeWidth.set(id, w);
    return w;
  };

  for (const root of roots) {
    measureSubtree(root.id, 0);
  }

  // --- Phase 2: assign absolute x positions (top-down). ---
  // slotLeft = left edge of this node's subtree slot.
  const absX = new Map<string, number>();

  const placeSubtree = (id: string, slotLeft: number): void => {
    const kids = children.get(id) ?? [];
    const sw = subtreeWidth.get(id) ?? NODE_W;

    // Parent centre = slotLeft + sw/2; x = centre - NODE_W/2.
    absX.set(id, slotLeft + sw / 2 - NODE_W / 2);

    if (kids.length === 0) return;

    // Children cluster spans the sum of their slot widths + gaps.
    const kidsTotal = kids.reduce((s, k) => s + (subtreeWidth.get(k) ?? NODE_W), 0);
    const kidsGaps = (kids.length - 1) * H_GAP;
    const clusterWidth = kidsTotal + kidsGaps;

    // Centre children cluster under the parent centre.
    let cursor = slotLeft + sw / 2 - clusterWidth / 2;
    for (const kid of kids) {
      const kw = subtreeWidth.get(kid) ?? NODE_W;
      placeSubtree(kid, cursor);
      cursor += kw + H_GAP;
    }
  };

  // Layout the forest: each root gets its own horizontal slot.
  let forestCursor = PAD;
  for (const root of roots) {
    placeSubtree(root.id, forestCursor);
    forestCursor += (subtreeWidth.get(root.id) ?? NODE_W) + H_GAP;
  }

  // --- Phase 3: emit NodePos[] and compute canvas bounds. ---
  const positions = new Map<string, NodePos>();
  const nodes: NodePos[] = [];
  let maxRight = 0;
  let maxBottom = 0;

  for (const r of roles) {
    const depth = nodeDepth.get(r.id) ?? 0;
    const x = absX.get(r.id) ?? PAD;
    const y = PAD + depth * (NODE_H + V_GAP);
    const pos: NodePos = { role: r, x, y, layer: depth };
    positions.set(r.id, pos);
    nodes.push(pos);
    maxRight = Math.max(maxRight, x + NODE_W);
    maxBottom = Math.max(maxBottom, y + NODE_H);
  }

  const width = maxRight + PAD;
  const height = maxBottom + PAD;

  const edgesOut: EdgePos[] = [];
  for (const e of edges) {
    const from = positions.get(e.parent_role_id);
    const to = positions.get(e.child_role_id);
    if (from && to) edgesOut.push({ from, to });
  }

  return { nodes, edges: edgesOut, width, height };
}
