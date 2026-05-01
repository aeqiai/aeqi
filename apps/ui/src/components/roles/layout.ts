import type { Role, RoleEdge } from "@/lib/types";

export const NODE_W = 220;
export const NODE_H = 76;
export const H_GAP = 28;
export const V_GAP = 76;
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
 * Sugiyama-lite layered DAG layout.
 *
 * Pipeline:
 *   1. Longest-path layering — depth = max(parent.depth) + 1.
 *   2. Two passes of barycenter ordering within each layer to dampen
 *      crossings (top-down then bottom-up).
 *   3. Pixel placement — each layer centred within max-width band.
 *
 * Single-pass approximate; sufficient for org charts up to ~50 nodes.
 * Replace with elk/dagre when a real cap-table-sized DAG arrives.
 */
export function layoutChart(roles: Role[], edges: RoleEdge[]): ChartLayout {
  if (roles.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const byId = new Map(roles.map((r) => [r.id, r]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const r of roles) {
    incoming.set(r.id, []);
    outgoing.set(r.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.parent_role_id) || !byId.has(e.child_role_id)) continue;
    incoming.get(e.child_role_id)!.push(e.parent_role_id);
    outgoing.get(e.parent_role_id)!.push(e.child_role_id);
  }

  const depth = new Map<string, number>();
  const computeDepth = (id: string, seen: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    if (parents.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const p of parents) d = Math.max(d, computeDepth(p, seen) + 1);
    depth.set(id, d);
    return d;
  };
  for (const r of roles) computeDepth(r.id, new Set());

  const maxDepth = Math.max(...Array.from(depth.values()));
  const layers: Role[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const r of roles) layers[depth.get(r.id) ?? 0].push(r);

  for (const layer of layers) {
    layer.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }

  const indexInLayer = new Map<string, number>();
  const reindex = () => {
    indexInLayer.clear();
    for (const layer of layers) {
      layer.forEach((r, i) => indexInLayer.set(r.id, i));
    }
  };
  reindex();

  const barycenter = (id: string, neighbours: string[]): number => {
    if (neighbours.length === 0) return indexInLayer.get(id) ?? 0;
    let sum = 0;
    let n = 0;
    for (const nb of neighbours) {
      const idx = indexInLayer.get(nb);
      if (idx !== undefined) {
        sum += idx;
        n += 1;
      }
    }
    return n === 0 ? (indexInLayer.get(id) ?? 0) : sum / n;
  };

  for (let pass = 0; pass < 4; pass += 1) {
    const downward = pass % 2 === 0;
    if (downward) {
      for (let li = 1; li < layers.length; li += 1) {
        const layer = layers[li];
        const scored = layer.map((r) => ({ r, key: barycenter(r.id, incoming.get(r.id) ?? []) }));
        scored.sort((a, b) => a.key - b.key || a.r.title.localeCompare(b.r.title));
        layers[li] = scored.map((s) => s.r);
      }
    } else {
      for (let li = layers.length - 2; li >= 0; li -= 1) {
        const layer = layers[li];
        const scored = layer.map((r) => ({ r, key: barycenter(r.id, outgoing.get(r.id) ?? []) }));
        scored.sort((a, b) => a.key - b.key || a.r.title.localeCompare(b.r.title));
        layers[li] = scored.map((s) => s.r);
      }
    }
    reindex();
  }

  const widestCount = layers.reduce((m, l) => Math.max(m, l.length), 0);
  const innerWidth = widestCount * NODE_W + Math.max(0, widestCount - 1) * H_GAP;
  const width = innerWidth + PAD * 2;
  const height = layers.length * NODE_H + Math.max(0, layers.length - 1) * V_GAP + PAD * 2;

  const positions = new Map<string, NodePos>();
  const nodes: NodePos[] = [];
  layers.forEach((layer, li) => {
    const layerWidth = layer.length * NODE_W + Math.max(0, layer.length - 1) * H_GAP;
    const startX = PAD + (innerWidth - layerWidth) / 2;
    layer.forEach((r, i) => {
      const pos: NodePos = {
        role: r,
        layer: li,
        x: startX + i * (NODE_W + H_GAP),
        y: PAD + li * (NODE_H + V_GAP),
      };
      positions.set(r.id, pos);
      nodes.push(pos);
    });
  });

  const edgesOut: EdgePos[] = [];
  for (const e of edges) {
    const from = positions.get(e.parent_role_id);
    const to = positions.get(e.child_role_id);
    if (from && to) edgesOut.push({ from, to });
  }

  return { nodes, edges: edgesOut, width, height };
}
