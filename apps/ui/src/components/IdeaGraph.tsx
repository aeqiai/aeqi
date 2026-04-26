import { useCallback, useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

export interface GraphNode {
  id: string;
  name: string;
  content: string;
  tags: string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  hotness: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  strength: number;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelect?: (node: GraphNode | null) => void;
  selectedId?: string | null;
}

// Read from CSS custom properties so the graph follows the design system.
// Tag/relation differentiation is carried by shape + weight, not hue.
interface Palette {
  ink: string;
  inkSoft: string;
  inkDim: string;
  paper: string;
  border: string;
  accent: string;
  accentSoft: string;
}

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function loadPalette(): Palette {
  return {
    ink: readToken("--color-ink-text", "rgba(0,0,0,0.85)"),
    inkSoft: readToken("--color-ink-secondary", "rgba(0,0,0,0.45)"),
    inkDim: readToken("--color-ink-muted", "rgba(0,0,0,0.25)"),
    paper: readToken("--color-paper", "#f4f4f5"),
    border: readToken("--color-border", "rgba(0,0,0,0.06)"),
    accent: readToken("--color-accent", "#0a0a0b"),
    accentSoft: readToken("--color-accent-dim", "#52525b"),
  };
}

// Edge relations map to dash + weight, not hue, to preserve the
// single-accent discipline of the design system.
const RELATION_STYLE: Record<string, { dash: number[]; weight: number }> = {
  supports: { dash: [], weight: 1.25 },
  supersedes: { dash: [], weight: 1.6 },
  contradicts: { dash: [3, 3], weight: 1.25 },
  caused_by: { dash: [6, 3], weight: 1 },
  derived_from: { dash: [1, 3], weight: 1 },
  related_to: { dash: [], weight: 1 },
};

function styleFor(relation: string) {
  return RELATION_STYLE[relation] ?? RELATION_STYLE.related_to;
}

function primaryTag(node: Pick<GraphNode, "tags">): string {
  return node.tags[0] || "untagged";
}

type TagRole = "accent" | "ink" | "soft" | "dim";

function roleFor(node: GraphNode): TagRole {
  const t = primaryTag(node).toLowerCase();
  if (t === "decision" || t === "skill") return "accent";
  if (t === "evergreen" || t === "procedure") return "ink";
  if (t === "preference" || t === "fact") return "soft";
  return "dim";
}

function nodeColor(pal: Palette, role: TagRole): string {
  switch (role) {
    case "accent":
      return pal.accent;
    case "ink":
      return pal.ink;
    case "soft":
      return pal.inkSoft;
    default:
      return pal.inkDim;
  }
}

function nodeRadius(n: GraphNode): number {
  return 5 + n.hotness * 7;
}

// d3-force mutates node objects in place (.x, .y, .vx, .vy, .fx, .fy).
type SimNode = GraphNode & SimulationNodeDatum;
// After the first tick d3 replaces the string IDs on each link with the
// resolved node references; we keep `relation` and `strength` for rendering.
type SimLink = SimulationLinkDatum<SimNode> & { relation: string; strength: number };

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 6;
const FIT_PADDING = 0.12;

// Compute a transform that fits the simulation's bounding box into the
// viewport with FIT_PADDING margin. Returns null when the layout hasn't
// settled into anything fittable yet (single point, NaN positions).
function computeFitTransform(
  nodes: SimNode[],
  width: number,
  height: number,
): ZoomTransform | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x == null || n.y == null || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const r = nodeRadius(n) + 12;
    if (n.x - r < minX) minX = n.x - r;
    if (n.y - r < minY) minY = n.y - r;
    if (n.x + r > maxX) maxX = n.x + r;
    if (n.y + r > maxY) maxY = n.y + r;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, (1 - FIT_PADDING * 2) * Math.min(width / bw, height / bh)),
  );
  const tx = width / 2 - cx * scale;
  const ty = height / 2 - cy * scale;
  return zoomIdentity.translate(tx, ty).scale(scale);
}

export default function IdeaGraph({ nodes, edges, onSelect, selectedId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{
    node: SimNode;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const hoverRef = useRef<SimNode | null>(null);
  const pendingDeselectRef = useRef(false);
  const paletteRef = useRef<Palette | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId ?? null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomBehaviorRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const hasFitRef = useRef(false);
  const fitTickCountRef = useRef(0);
  const [dimensions, setDimensions] = useState({ w: 800, h: 500 });

  useEffect(() => {
    selectedIdRef.current = selectedId ?? null;
  }, [selectedId]);

  // Rebuild the d3-force simulation whenever the data or canvas size changes.
  // d3-force does the heavy lifting — Barnes-Hut quadtree repulsion (no
  // distance-cutoff bug), link distance, collision avoidance, centering.
  useEffect(() => {
    const cx = dimensions.w / 2;
    const cy = dimensions.h / 2;

    // Carry over positions for nodes that already exist so filter changes
    // don't teleport everything back to the center and trigger a flash.
    const prev = new Map(simNodesRef.current.map((n) => [n.id, n]));
    const simNodes: SimNode[] = nodes.map((n) => {
      const existing = prev.get(n.id);
      return {
        ...n,
        x: existing?.x ?? cx + (Math.random() - 0.5) * 80,
        y: existing?.y ?? cy + (Math.random() - 0.5) * 80,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
      };
    });
    const simLinks: SimLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      relation: e.relation,
      strength: e.strength,
    }));

    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;
    // Re-fit on data change so adding/removing many nodes re-centers.
    hasFitRef.current = false;
    fitTickCountRef.current = 0;

    simRef.current?.stop();
    simRef.current = forceSimulation<SimNode, SimLink>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((n) => n.id)
          .distance((l) => 60 + 60 / Math.max(0.2, l.strength))
          .strength((l) => Math.min(1, 0.3 + l.strength * 0.5)),
      )
      // Negative charge = repulsion. distanceMax caps the force radius so
      // huge graphs stay performant without losing useful long-range spread.
      .force("charge", forceManyBody<SimNode>().strength(-260).distanceMax(520))
      .force("center", forceCenter(cx, cy).strength(0.05))
      .force(
        "collide",
        forceCollide<SimNode>()
          .radius((n) => nodeRadius(n) + 6)
          .strength(0.8),
      )
      .alpha(1)
      .alphaDecay(0.03);

    return () => {
      simRef.current?.stop();
    };
  }, [nodes, edges, dimensions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ w: Math.floor(width), h: Math.floor(height) });
        }
      }
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // Wire d3-zoom to the canvas. d3-zoom owns wheel + drag-on-empty-bg + pinch
  // + dblclick. Node-drag interferes, so we filter wheel/touch zoom always
  // and let pan happen only when the gesture didn't start on a node.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sel = select<HTMLCanvasElement, unknown>(canvas);
    const beh = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .filter((event: Event) => {
        // Don't pan when starting a drag on a node — the node-drag code
        // takes over instead. Wheel/dblclick/touch-pinch always zoom.
        if (event.type === "mousedown") {
          const me = event as MouseEvent;
          const rect = canvas.getBoundingClientRect();
          const x = me.clientX - rect.left;
          const y = me.clientY - rect.top;
          const t = transformRef.current;
          const wx = (x - t.x) / t.k;
          const wy = (y - t.y) / t.k;
          for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
            const n = simNodesRef.current[i];
            if (n.x == null || n.y == null) continue;
            const r = nodeRadius(n) + 4;
            const dx = wx - n.x;
            const dy = wy - n.y;
            if (dx * dx + dy * dy < r * r) return false;
          }
          return me.button === 0;
        }
        return !(event as MouseEvent).ctrlKey;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
      });

    sel.call(beh);
    zoomBehaviorRef.current = beh;
    return () => {
      sel.on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    paletteRef.current = loadPalette();

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dimensions.w * dpr;
    canvas.height = dimensions.h * dpr;
    canvas.style.width = `${dimensions.w}px`;
    canvas.style.height = `${dimensions.h}px`;

    function draw() {
      const sim = simNodesRef.current;
      const edgs = simLinksRef.current;
      const pal = paletteRef.current ?? loadPalette();
      const sel = selectedIdRef.current;
      const t = transformRef.current;

      // Reset, then apply DPR + pan/zoom transform together. Anything drawn
      // below now lives in world coordinates.
      ctx!.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
      ctx!.clearRect(-t.x / t.k, -t.y / t.k, dimensions.w / t.k, dimensions.h / t.k);

      if (sim.length === 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Once the layout has had a few hundred ticks to settle, fit it into
      // the viewport so the user lands on a fully-visible graph rather than
      // a centered cluster they have to discover by zooming out.
      if (!hasFitRef.current) {
        fitTickCountRef.current += 1;
        if (fitTickCountRef.current > 80 || (simRef.current?.alpha() ?? 1) < 0.3) {
          const fit = computeFitTransform(sim, dimensions.w, dimensions.h);
          const beh = zoomBehaviorRef.current;
          if (fit && beh) {
            select<HTMLCanvasElement, unknown>(canvas!).call(beh.transform, fit);
            transformRef.current = fit;
            hasFitRef.current = true;
          }
        }
      }

      const selectedNeighbors = new Set<string>();
      if (sel) {
        for (const e of edgs) {
          const sId =
            typeof e.source === "object" ? (e.source as SimNode).id : (e.source as string);
          const tId =
            typeof e.target === "object" ? (e.target as SimNode).id : (e.target as string);
          if (sId === sel) selectedNeighbors.add(tId);
          if (tId === sel) selectedNeighbors.add(sId);
        }
      }

      // Two passes so connected-to-selected edges paint OVER the quiet
      // background layer; otherwise selection neighbors get buried.
      ctx!.lineCap = "round";
      // Compensate stroke widths for zoom — keeps lines visually consistent
      // instead of fattening with scale-up and disappearing on zoom-out.
      const k = t.k;
      for (const pass of [0, 1] as const) {
        for (const e of edgs) {
          const s = typeof e.source === "object" ? (e.source as SimNode) : null;
          const tn = typeof e.target === "object" ? (e.target as SimNode) : null;
          if (!s || !tn || s.x == null || s.y == null || tn.x == null || tn.y == null) continue;
          const isConnected = sel !== null && (s.id === sel || tn.id === sel);
          if (pass === 0 && isConnected) continue;
          if (pass === 1 && !isConnected) continue;

          const sty = styleFor(e.relation);
          ctx!.beginPath();
          ctx!.moveTo(s.x, s.y);
          ctx!.lineTo(tn.x, tn.y);
          if (sty.dash.length) ctx!.setLineDash(sty.dash.map((d) => d / k));
          else ctx!.setLineDash([]);
          if (isConnected) {
            ctx!.strokeStyle = pal.accent;
            ctx!.globalAlpha = 0.55 + e.strength * 0.35;
          } else {
            ctx!.strokeStyle = pal.ink;
            ctx!.globalAlpha = sel ? 0.04 + e.strength * 0.03 : 0.1 + e.strength * 0.12;
          }
          ctx!.lineWidth = sty.weight / k;
          ctx!.stroke();
          ctx!.globalAlpha = 1;
        }
      }
      ctx!.setLineDash([]);

      // Cold-node opacity floor stays at 0.55 — 0.4 left stale memories
      // as near-invisible shadows.
      for (const n of sim) {
        if (n.x == null || n.y == null) continue;
        const isSelected = n.id === sel;
        const isNeighbor = selectedNeighbors.has(n.id);
        const isHovered = hoverRef.current === n;
        const radius = nodeRadius(n) + (isSelected ? 3 : 0);
        const role = roleFor(n);
        const fill = isSelected ? pal.accent : nodeColor(pal, role);
        const isDim = sel !== null && !isSelected && !isNeighbor;

        if (isSelected) {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, radius + 8, 0, Math.PI * 2);
          ctx!.fillStyle = pal.accent;
          ctx!.globalAlpha = 0.12;
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }

        // Paper pad behind the disc so overlapping nodes don't
        // silhouette-merge into one blob.
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, radius + 1.5, 0, Math.PI * 2);
        ctx!.fillStyle = pal.paper;
        ctx!.globalAlpha = 1;
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx!.fillStyle = fill;
        const baseAlpha = 0.55 + n.hotness * 0.45;
        ctx!.globalAlpha = isDim ? Math.min(0.25, baseAlpha) : baseAlpha;
        ctx!.fill();
        ctx!.globalAlpha = 1;

        ctx!.lineWidth = (isSelected || isHovered ? 1.5 : 0.75) / k;
        ctx!.strokeStyle = isSelected ? pal.accent : isHovered ? pal.accentSoft : pal.border;
        ctx!.stroke();

        // Hidden by default; shown for selection/hover/neighbor/hot/sparse.
        const shouldLabel =
          isSelected || isHovered || isNeighbor || n.hotness > 0.6 || sim.length < 24;
        if (shouldLabel) {
          // Counter-scale labels so they stay readable when zoomed out.
          const fontPx = 11 / k;
          ctx!.font = `${isSelected ? 600 : 500} ${fontPx}px 'Inter', system-ui, sans-serif`;
          ctx!.fillStyle = isSelected ? pal.accent : isDim ? pal.inkDim : pal.ink;
          ctx!.globalAlpha = isSelected ? 1 : isDim ? 0.5 : 0.8;
          ctx!.textAlign = "center";
          ctx!.textBaseline = "top";
          // Paper rect behind the label so it doesn't collide with edge lines.
          const label = n.name.length > 42 ? n.name.slice(0, 40) + "…" : n.name;
          const m = ctx!.measureText(label);
          const padX = 3 / k;
          const padY = 7 / k;
          const boxH = 14 / k;
          const lx = n.x - m.width / 2 - padX;
          const ly = n.y + radius + padY;
          ctx!.globalAlpha = isDim ? 0.35 : isSelected ? 0.9 : 0.75;
          ctx!.fillStyle = pal.paper;
          ctx!.fillRect(lx, ly, m.width + padX * 2, boxH);
          ctx!.globalAlpha = isSelected ? 1 : isDim ? 0.6 : 0.9;
          ctx!.fillStyle = isSelected ? pal.accent : pal.ink;
          ctx!.fillText(label, n.x, ly + 1 / k);
          ctx!.globalAlpha = 1;
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [dimensions]);

  // Hit testing: convert the screen coords to world coords via the inverse
  // of the current pan/zoom transform, then run the same disc test.
  const hitTest = useCallback((screenX: number, screenY: number): SimNode | null => {
    const t = transformRef.current;
    const wx = (screenX - t.x) / t.k;
    const wy = (screenY - t.y) / t.k;
    const sim = simNodesRef.current;
    for (let i = sim.length - 1; i >= 0; i--) {
      const n = sim[i];
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n) + 4;
      const dx = wx - n.x;
      const dy = wy - n.y;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  }, []);

  const getCanvasPos = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // Distinguishes click-to-open from drag-to-rearrange — without it, a
  // bare mousedown fires onSelect and navigates before any drag motion
  // can start, making the graph un-draggable.
  const CLICK_THRESHOLD_PX = 4;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      const node = hitTest(pos.x, pos.y);
      if (node && node.x != null && node.y != null) {
        const t = transformRef.current;
        const wx = (pos.x - t.x) / t.k;
        const wy = (pos.y - t.y) / t.k;
        dragRef.current = {
          node,
          offsetX: wx - node.x,
          offsetY: wy - node.y,
          startX: pos.x,
          startY: pos.y,
          moved: false,
        };
        // Reheat so the rest of the graph reacts to the drag.
        simRef.current?.alphaTarget(0.3).restart();
      } else {
        // d3-zoom owns the pan gesture; only treat this as a deselect if no
        // pan motion happens between down and up.
        pendingDeselectRef.current = true;
      }
    },
    [hitTest, getCanvasPos],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      const drag = dragRef.current;
      if (drag) {
        const dx = pos.x - drag.startX;
        const dy = pos.y - drag.startY;
        if (!drag.moved && dx * dx + dy * dy > CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX) {
          drag.moved = true;
          const canvas = canvasRef.current;
          if (canvas) canvas.style.cursor = "grabbing";
        }
        if (drag.moved) {
          const t = transformRef.current;
          const wx = (pos.x - t.x) / t.k;
          const wy = (pos.y - t.y) / t.k;
          // d3-force respects fx/fy as fixed coordinates each tick — the
          // canonical drag handle, much cleaner than zeroing velocities.
          drag.node.fx = wx - drag.offsetX;
          drag.node.fy = wy - drag.offsetY;
        }
      } else {
        const node = hitTest(pos.x, pos.y);
        hoverRef.current = node;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = node ? "pointer" : "grab";
      }
    },
    [hitTest, getCanvasPos],
  );

  const handleMouseUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag && !drag.moved) onSelect?.(drag.node);
    else if (!drag && pendingDeselectRef.current) onSelect?.(null);
    if (drag) {
      // Release the pin so the node settles back into the layout.
      drag.node.fx = null;
      drag.node.fy = null;
      simRef.current?.alphaTarget(0);
    }
    pendingDeselectRef.current = false;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "default";
  }, [onSelect]);

  // `0` resets the view to fit-all, matching the convention in Figma /
  // tldraw / Obsidian's canvas.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key !== "0") return;
      const beh = zoomBehaviorRef.current;
      const canvas = canvasRef.current;
      if (!beh || !canvas) return;
      const fit = computeFitTransform(simNodesRef.current, dimensions.w, dimensions.h);
      if (fit) select<HTMLCanvasElement, unknown>(canvas).call(beh.transform, fit);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dimensions]);

  return (
    <canvas
      ref={canvasRef}
      className="idea-graph-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
}
