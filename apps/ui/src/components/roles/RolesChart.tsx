import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Role, RoleEdge } from "@/lib/types";
import { IconButton } from "@/components/ui";
import RoleNode from "./RoleNode";
import { layoutChart, NODE_H, NODE_W } from "./layout";

export interface RolesChartProps {
  roles: Role[];
  edges: RoleEdge[];
  agentNames: Map<string, string>;
  /** Avatar URLs keyed by agent id, sourced from the daemon store. */
  agentAvatars: Map<string, string>;
  onSelectRole: (role: Role) => void;
  selectedRoleId?: string | null;
}

interface CrossConnector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

const FIT_TRANSFORM: Transform = { scale: 1, tx: 0, ty: 0 };

/**
 * Org surface — three role tiers rendered as calm peers:
 *
 *   Directors   — horizontal roster at the top; no tinted zone, no band
 *                 divider, no eyebrow label. Board governance is orthogonal
 *                 to the operational tree — directors appear as peer nodes.
 *   Operational — pure layered DAG tree via the Sugiyama-lite layout.
 *                 CEO at layer 0; direct reports at layer 1; etc.
 *                 No painted department-cluster envelopes.
 *   Advisors    — trailing horizontal roster.
 *
 * Empty sections collapse entirely. Cross-section edges are dropped silently.
 *
 * The chart content is wrapped in a zoom+pan viewport. Wheel zooms,
 * click+drag pans, and the toolbar buttons (+/-/fit) give precise
 * control. Default view scales to fit the container width.
 */
export default function RolesChart({
  roles,
  edges,
  agentNames,
  agentAvatars,
  onSelectRole,
  selectedRoleId,
}: RolesChartProps) {
  // Memoize the type-split lists so identity is stable between renders
  // — the cross-zone measurement effect depends transitively on these
  // (via crossEdges) and a fresh array ref per render fires the effect
  // on every state write the effect itself triggers (React #185).
  const directors = useMemo(() => roles.filter((r) => r.role_type === "director"), [roles]);
  const advisors = useMemo(() => roles.filter((r) => r.role_type === "advisor"), [roles]);
  const operational = useMemo(() => roles.filter((r) => r.role_type === "operational"), [roles]);

  const opIds = useMemo(() => new Set(operational.map((r) => r.id)), [operational]);
  const directorIds = useMemo(() => new Set(directors.map((r) => r.id)), [directors]);
  const opEdges = useMemo(
    () => edges.filter((e) => opIds.has(e.parent_role_id) && opIds.has(e.child_role_id)),
    [edges, opIds],
  );
  const treeLayout = useMemo(() => layoutChart(operational, opEdges), [operational, opEdges]);

  // Governance edges — director → operational. These cross the band
  // boundary between the director roster and the operational tree.
  // Layout-wise the roster is a flex row above the canvas; we measure
  // post-layout DOM positions and draw connectors as an absolute SVG
  // anchored to .roles-chart-stack.
  const crossEdges = useMemo(
    () => edges.filter((e) => directorIds.has(e.parent_role_id) && opIds.has(e.child_role_id)),
    [edges, directorIds, opIds],
  );

  const stackRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const setNodeRef = useCallback(
    (roleId: string) => (el: HTMLButtonElement | null) => {
      if (el) nodeRefs.current.set(roleId, el);
      else nodeRefs.current.delete(roleId);
    },
    [],
  );
  const [crossConnectors, setCrossConnectors] = useState<CrossConnector[]>([]);
  const [stackSize, setStackSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    // ResizeObserver fires when our own state writes change layout —
    // guard each setState with a content-equality check or we'll
    // bounce between identical values via fresh object refs (React
    // #185). Compare numeric fields rather than JSON.stringify so the
    // hot path stays cheap.
    const measure = () => {
      const stackW = stack.offsetWidth;
      const stackH = stack.offsetHeight;
      const next: CrossConnector[] = [];
      for (const e of crossEdges) {
        const dirEl = nodeRefs.current.get(e.parent_role_id);
        const opEl = nodeRefs.current.get(e.child_role_id);
        if (!dirEl || !opEl) continue;
        const dir = offsetRelative(dirEl, stack);
        const op = offsetRelative(opEl, stack);
        next.push({
          x1: dir.x + dirEl.offsetWidth / 2,
          y1: dir.y + dirEl.offsetHeight,
          x2: op.x + opEl.offsetWidth / 2,
          y2: op.y,
        });
      }
      setStackSize((prev) =>
        prev.w === stackW && prev.h === stackH ? prev : { w: stackW, h: stackH },
      );
      setCrossConnectors((prev) => (sameConnectors(prev, next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stack);
    return () => ro.disconnect();
  }, [crossEdges]);

  if (roles.length === 0) return null;

  return (
    <OrgZoomViewport>
      <div className="roles-chart-stack" ref={stackRef}>
        {crossConnectors.length > 0 && (
          <svg
            className="roles-chart-cross-edges"
            width={stackSize.w}
            height={stackSize.h}
            viewBox={`0 0 ${stackSize.w} ${stackSize.h}`}
            aria-hidden
          >
            {crossConnectors.map((c, i) => {
              const midY = (c.y1 + c.y2) / 2;
              const d = `M ${c.x1} ${c.y1} C ${c.x1} ${midY}, ${c.x2} ${midY}, ${c.x2} ${c.y2}`;
              return <path key={i} d={d} className="roles-chart-cross-edge-path" />;
            })}
          </svg>
        )}
        {directors.length > 0 && (
          <section className="roles-chart-zone" aria-label="Director">
            <div className="roles-chart-roster">
              {directors.map((r) => (
                <RoleNode
                  key={r.id}
                  role={r}
                  agentName={r.occupant_id ? agentNames.get(r.occupant_id) : undefined}
                  agentAvatar={r.occupant_id ? agentAvatars.get(r.occupant_id) : undefined}
                  onClick={() => onSelectRole(r)}
                  selected={r.id === selectedRoleId}
                  nodeRef={setNodeRef(r.id)}
                  style={{ width: NODE_W, height: NODE_H }}
                />
              ))}
            </div>
          </section>
        )}
        {operational.length > 0 && (
          <section className="roles-chart-zone" aria-label="Operational">
            <div
              className="roles-chart-canvas"
              style={{ width: treeLayout.width, height: treeLayout.height }}
              role="figure"
              aria-label="Organisation chart"
            >
              <svg
                className="roles-chart-edges"
                width={treeLayout.width}
                height={treeLayout.height}
                viewBox={`0 0 ${treeLayout.width} ${treeLayout.height}`}
                aria-hidden
              >
                {treeLayout.edges.map((e, i) => {
                  const x1 = e.from.x + NODE_W / 2;
                  const y1 = e.from.y + NODE_H;
                  const x2 = e.to.x + NODE_W / 2;
                  const y2 = e.to.y;
                  const midY = (y1 + y2) / 2;
                  const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                  return <path key={i} d={d} className="roles-chart-edge-path" />;
                })}
              </svg>
              {treeLayout.nodes.map((n) => (
                <RoleNode
                  key={n.role.id}
                  role={n.role}
                  agentName={n.role.occupant_id ? agentNames.get(n.role.occupant_id) : undefined}
                  agentAvatar={
                    n.role.occupant_id ? agentAvatars.get(n.role.occupant_id) : undefined
                  }
                  onClick={() => onSelectRole(n.role)}
                  selected={n.role.id === selectedRoleId}
                  nodeRef={setNodeRef(n.role.id)}
                  className={n.layer === 0 ? "role-node--apex" : undefined}
                  style={{
                    position: "absolute",
                    left: n.x,
                    top: n.y,
                    width: NODE_W,
                    height: NODE_H,
                  }}
                />
              ))}
            </div>
          </section>
        )}
        {advisors.length > 0 && (
          <section className="roles-chart-zone" aria-label="Advisor">
            <div className="roles-chart-roster">
              {advisors.map((r) => (
                <RoleNode
                  key={r.id}
                  role={r}
                  agentName={r.occupant_id ? agentNames.get(r.occupant_id) : undefined}
                  agentAvatar={r.occupant_id ? agentAvatars.get(r.occupant_id) : undefined}
                  onClick={() => onSelectRole(r)}
                  selected={r.id === selectedRoleId}
                  nodeRef={setNodeRef(r.id)}
                  style={{ width: NODE_W, height: NODE_H }}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </OrgZoomViewport>
  );
}

/**
 * Compute an element's position relative to an ancestor using the
 * offsetParent chain. Returns layout (pre-transform) coordinates — the
 * org chart sits inside a CSS-transformed zoom viewport and
 * getBoundingClientRect would return scaled values that don't match
 * the SVG's own (pre-transform) coordinate space.
 */
function sameConnectors(a: CrossConnector[], b: CrossConnector[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai.x1 !== bi.x1 || ai.y1 !== bi.y1 || ai.x2 !== bi.x2 || ai.y2 !== bi.y2) {
      return false;
    }
  }
  return true;
}

function offsetRelative(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== ancestor) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = (cur.offsetParent as HTMLElement | null) ?? null;
  }
  return { x, y };
}

/**
 * Zoom + pan viewport for the org chart. The inner content is wrapped in
 * a div that receives a CSS transform. Wheel zooms anchored on the cursor
 * position; drag pans. A corner overlay provides +/−/fit affordances.
 *
 * Auto-fit on mount: the inner content overflows a `width:100%` container
 * naturally. On first render we scale the content to fit the container
 * width by measuring both and computing the initial scale factor.
 */
function OrgZoomViewport({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);
  const [transform, setTransform] = useState<Transform>(FIT_TRANSFORM);
  const hasFit = useRef(false);

  const applyFit = useCallback(() => {
    const viewport = viewportRef.current;
    const inner = innerRef.current;
    if (!viewport || !inner) return;
    const vw = viewport.clientWidth;
    // Use offsetWidth/offsetHeight rather than scrollWidth/scrollHeight.
    // scrollWidth only reflects overflow in the scroll direction, and
    // can be clamped by the parent container. offsetWidth is the
    // natural laid-out width of the element regardless of clipping.
    const iw = inner.offsetWidth;
    const ih = inner.offsetHeight;
    if (iw === 0 || ih === 0) return;
    const scale = Math.min(1, (vw - 24) / iw);
    // Center horizontally; small top offset for visual breathing room.
    const tx = (vw - iw * scale) / 2;
    const ty = 16;
    setTransform({ scale, tx, ty });
    hasFit.current = true;
  }, []);

  // Auto-fit on mount: use a ResizeObserver on the inner div so we fire
  // once the content has measurable dimensions (accounts for async renders).
  // We disconnect immediately after the first successful measurement so
  // subsequent user interactions are not overridden.
  useLayoutEffect(() => {
    if (hasFit.current) return;
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (hasFit.current) {
        ro.disconnect();
        return;
      }
      applyFit();
      if (hasFit.current) ro.disconnect();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [applyFit]);

  const clampedScale = useCallback(
    (next: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next)),
    [],
  );

  // Wheel: zoom anchored on cursor position within the viewport.
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      setTransform((prev) => {
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const next = clampedScale(prev.scale * factor);
        const ratio = next / prev.scale;
        return {
          scale: next,
          tx: mx - ratio * (mx - prev.tx),
          ty: my - ratio * (my - prev.ty),
        };
      });
    },
    [clampedScale],
  );

  // Drag: pointer events for cross-device pan.
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only primary button, not clicks on role nodes themselves.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".role-node")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setTransform((prev) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTx: prev.tx,
        startTy: prev.ty,
      };
      return prev;
    });
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setTransform((prev) => ({
      ...prev,
      tx: drag.startTx + dx,
      ty: drag.startTy + dy,
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const zoomIn = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    setTransform((prev) => {
      const next = clampedScale(prev.scale * 1.25);
      const ratio = next / prev.scale;
      const cx = vw / 2;
      const cy = vh / 2;
      return {
        scale: next,
        tx: cx - ratio * (cx - prev.tx),
        ty: cy - ratio * (cy - prev.ty),
      };
    });
  }, [clampedScale]);

  const zoomOut = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    setTransform((prev) => {
      const next = clampedScale(prev.scale / 1.25);
      const ratio = next / prev.scale;
      const cx = vw / 2;
      const cy = vh / 2;
      return {
        scale: next,
        tx: cx - ratio * (cx - prev.tx),
        ty: cy - ratio * (cy - prev.ty),
      };
    });
  }, [clampedScale]);

  const resetFit = useCallback(() => {
    hasFit.current = false;
    setTransform(FIT_TRANSFORM);
    requestAnimationFrame(applyFit);
  }, [applyFit]);

  const isDragging = dragRef.current !== null;
  const { scale, tx, ty } = transform;

  return (
    <div
      ref={viewportRef}
      className="roles-chart-viewport"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      <div
        ref={innerRef}
        className="roles-chart-inner"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
      >
        {children}
      </div>

      <div className="roles-chart-controls" role="toolbar" aria-label="Zoom controls">
        <IconButton aria-label="Zoom in" variant="bordered" size="xs" onClick={zoomIn}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M5 1v8M1 5h8" />
          </svg>
        </IconButton>
        <IconButton aria-label="Zoom out" variant="bordered" size="xs" onClick={zoomOut}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M1 5h8" />
          </svg>
        </IconButton>
        <IconButton aria-label="Reset zoom to fit" variant="bordered" size="xs" onClick={resetFit}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
            <path d="M3.5 3.5l3 3M6.5 3.5l-3 3" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
