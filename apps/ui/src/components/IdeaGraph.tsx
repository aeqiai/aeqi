import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Runtime palette — read once from CSS custom properties so the graph
 * follows the design system instead of carrying its own rainbow. A
 * neutral ink base with steel-blue accent mirrors the rest of the app;
 * differentiation between tag/relation kinds is carried by shape and
 * weight, not by raw hue.
 */
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

/**
 * Semantic edge relations map to line style, not hue. Keeping everything
 * in the accent/ink family is what separates this from a generic graph —
 * relation kind is read from dash pattern + weight, which preserves the
 * app's single-accent discipline without losing information.
 */
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

/**
 * Tag → visual role. Four buckets replace the previous seven-hue rainbow:
 * decisions/skills pick up the accent, evergreen/procedural ideas read as
 * dominant ink, facts/preferences as soft ink, and everything else falls
 * to dim. Differentiation survives; the palette stays disciplined.
 */
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

export default function IdeaGraph({ nodes, edges, onSelect, selectedId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>(edges);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{
    node: GraphNode;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const hoverRef = useRef<GraphNode | null>(null);
  const pendingDeselectRef = useRef(false);
  const paletteRef = useRef<Palette | null>(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 500 });

  // Initialize simulation nodes with positions.
  useEffect(() => {
    const cx = dimensions.w / 2;
    const cy = dimensions.h / 2;
    simRef.current = nodes.map((n, i) => ({
      ...n,
      x: cx + (n.x ? (n.x % 600) - 300 : Math.cos(i * 2.4) * 150),
      y: cy + (n.y ? (n.y % 400) - 200 : Math.sin(i * 2.4) * 150),
      vx: 0,
      vy: 0,
    }));
    edgesRef.current = edges;
  }, [nodes, edges, dimensions]);

  // Resize observer.
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

  // Force simulation + render loop.
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const nodeMap = new Map<string, GraphNode>();

    function tick() {
      const sim = simRef.current;
      const edgs = edgesRef.current;
      const pal = paletteRef.current ?? loadPalette();
      if (sim.length === 0) return;

      nodeMap.clear();
      for (const n of sim) nodeMap.set(n.id, n);

      const cx = dimensions.w / 2;
      const cy = dimensions.h / 2;

      // Forces.
      for (const n of sim) {
        // Center gravity.
        n.vx += (cx - n.x) * 0.001;
        n.vy += (cy - n.y) * 0.001;

        // Repulsion between all nodes.
        for (const m of sim) {
          if (n === m) continue;
          const dx = n.x - m.x;
          const dy = n.y - m.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 200) {
            const force = 800 / (dist * dist);
            n.vx += (dx / dist) * force;
            n.vy += (dy / dist) * force;
          }
        }
      }

      // Spring forces for edges.
      for (const e of edgs) {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ideal = 120;
        const force = (dist - ideal) * 0.005 * e.strength;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      }

      // Apply velocity with damping.
      for (const n of sim) {
        if (dragRef.current?.node === n) continue;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        // Bounds.
        n.x = Math.max(30, Math.min(dimensions.w - 30, n.x));
        n.y = Math.max(30, Math.min(dimensions.h - 30, n.y));
      }

      // Render.
      ctx!.clearRect(0, 0, dimensions.w, dimensions.h);

      const selectedNeighbors = new Set<string>();
      if (selectedId) {
        for (const e of edgs) {
          if (e.source === selectedId) selectedNeighbors.add(e.target);
          if (e.target === selectedId) selectedNeighbors.add(e.source);
        }
      }

      // Draw edges — two passes so connected-to-selected render over the
      // quiet background layer. Default edges stay in the neutral border
      // token at low alpha; selection-connected edges pick up the accent.
      ctx!.lineCap = "round";
      for (const pass of [0, 1] as const) {
        for (const e of edgs) {
          const s = nodeMap.get(e.source);
          const t = nodeMap.get(e.target);
          if (!s || !t) continue;
          const isConnected =
            selectedId !== null && (e.source === selectedId || e.target === selectedId);
          if (pass === 0 && isConnected) continue;
          if (pass === 1 && !isConnected) continue;

          const sty = styleFor(e.relation);
          ctx!.beginPath();
          ctx!.moveTo(s.x, s.y);
          ctx!.lineTo(t.x, t.y);
          if (sty.dash.length) ctx!.setLineDash(sty.dash);
          else ctx!.setLineDash([]);
          if (isConnected) {
            ctx!.strokeStyle = pal.accent;
            ctx!.globalAlpha = 0.55 + e.strength * 0.35;
          } else {
            ctx!.strokeStyle = pal.ink;
            ctx!.globalAlpha = selectedId ? 0.04 + e.strength * 0.03 : 0.1 + e.strength * 0.12;
          }
          ctx!.lineWidth = sty.weight;
          ctx!.stroke();
          ctx!.globalAlpha = 1;
        }
      }
      ctx!.setLineDash([]);

      // Draw nodes. The radius carries hotness; stroke signals state.
      // Cold nodes stay readable (min 0.55 opacity) — a 0.4 floor left
      // stale memories as near-invisible shadows. Active selection gets
      // a concentric halo in the paper color so the node "lifts" off the
      // graph regardless of surrounding density.
      for (const n of sim) {
        const isSelected = n.id === selectedId;
        const isNeighbor = selectedNeighbors.has(n.id);
        const isHovered = hoverRef.current === n;
        const radius = 5 + n.hotness * 7 + (isSelected ? 3 : 0);
        const role = roleFor(n);
        const fill = isSelected ? pal.accent : nodeColor(pal, role);
        const isDim = selectedId !== null && !isSelected && !isNeighbor;

        // Concentric halo ring for selected — a wider translucent accent
        // disc anchors the eye without needing a second DOM overlay.
        if (isSelected) {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, radius + 8, 0, Math.PI * 2);
          ctx!.fillStyle = pal.accent;
          ctx!.globalAlpha = 0.12;
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }

        // Node disc — always drawn on top of a paper pad so overlapping
        // nodes never silhouette-merge into one blob.
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

        // Stroke outline — a 1px hairline keeps small cold nodes crisp
        // against paper. Selected/hovered nodes get a slightly heavier
        // accent ring.
        ctx!.lineWidth = isSelected || isHovered ? 1.5 : 0.75;
        ctx!.strokeStyle = isSelected ? pal.accent : isHovered ? pal.accentSoft : pal.border;
        ctx!.stroke();

        // Label — hidden by default to let the graph breathe; shown on
        // selection / hover / when the idea is hot, or in sparse graphs
        // where there's room. Labels use the design-system text tokens,
        // not the old raw-black rgba literal.
        const shouldLabel =
          isSelected || isHovered || isNeighbor || n.hotness > 0.6 || sim.length < 24;
        if (shouldLabel) {
          ctx!.font = `${isSelected ? 600 : 500} 11px 'Inter', system-ui, sans-serif`;
          ctx!.fillStyle = isSelected ? pal.accent : isDim ? pal.inkDim : pal.ink;
          ctx!.globalAlpha = isSelected ? 1 : isDim ? 0.5 : 0.8;
          ctx!.textAlign = "center";
          ctx!.textBaseline = "top";
          // Paper halo behind the label so text never collides with an
          // edge line running underneath it.
          const label = n.name.length > 42 ? n.name.slice(0, 40) + "…" : n.name;
          const m = ctx!.measureText(label);
          const lx = n.x - m.width / 2 - 3;
          const ly = n.y + radius + 7;
          ctx!.globalAlpha = isDim ? 0.35 : isSelected ? 0.9 : 0.75;
          ctx!.fillStyle = pal.paper;
          ctx!.fillRect(lx, ly, m.width + 6, 14);
          ctx!.globalAlpha = isSelected ? 1 : isDim ? 0.6 : 0.9;
          ctx!.fillStyle = isSelected ? pal.accent : pal.ink;
          ctx!.fillText(label, n.x, ly + 1);
          ctx!.globalAlpha = 1;
        }
      }

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [dimensions, selectedId]);

  // Hit test helper.
  const hitTest = useCallback((x: number, y: number): GraphNode | null => {
    const sim = simRef.current;
    for (let i = sim.length - 1; i >= 0; i--) {
      const n = sim[i];
      const r = 6 + n.hotness * 8 + 4;
      const dx = x - n.x;
      const dy = y - n.y;
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

  // Distinguish click-to-open from drag-to-rearrange. A bare mousedown on
  // a node used to fire onSelect immediately, which navigated away before
  // any drag motion could start — the graph was un-draggable. Now the
  // click intent is resolved on mouseup only if the pointer stayed within
  // a small threshold; anything further becomes a drag and suppresses nav.
  const CLICK_THRESHOLD_PX = 4;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const pos = getCanvasPos(e);
      const node = hitTest(pos.x, pos.y);
      if (node) {
        dragRef.current = {
          node,
          offsetX: pos.x - node.x,
          offsetY: pos.y - node.y,
          startX: pos.x,
          startY: pos.y,
          moved: false,
        };
      } else {
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
          drag.node.x = pos.x - drag.offsetX;
          drag.node.y = pos.y - drag.offsetY;
          drag.node.vx = 0;
          drag.node.vy = 0;
        }
      } else {
        const node = hitTest(pos.x, pos.y);
        hoverRef.current = node;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = node ? "pointer" : "default";
      }
    },
    [hitTest, getCanvasPos],
  );

  const handleMouseUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag && !drag.moved) onSelect?.(drag.node);
    else if (!drag && pendingDeselectRef.current) onSelect?.(null);
    pendingDeselectRef.current = false;
    dragRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "default";
  }, [onSelect]);

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
