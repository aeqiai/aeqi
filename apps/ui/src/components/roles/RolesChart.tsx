import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Role, RoleEdge } from "@/lib/types";
import { IconButton } from "@/components/ui";
import RoleNode from "./RoleNode";
import { layoutDepts, NODE_H, NODE_W } from "./layout";

export interface RolesChartProps {
  roles: Role[];
  edges: RoleEdge[];
  agentNames: Map<string, string>;
  onSelectRole: (role: Role) => void;
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
 * Three-band org surface:
 *
 *   BOARD       — directors as a horizontal roster (no edges drawn).
 *                 Governance is not reporting; the board is appointed,
 *                 not managed, so a bezier into the operational tree
 *                 would be a category error.
 *   ORG         — operational roles as department clusters. The CEO (root)
 *                 sits above a horizontal row of department columns. Each
 *                 column is headed by a C-suite role and shows its full
 *                 subtree via the Sugiyama-lite layout. Departments are
 *                 visually separated with whitespace and a subtle tinted
 *                 background — no hairlines.
 *   ADVISORS    — advisors as a trailing horizontal roster.
 *
 * Empty bands collapse entirely. Cross-band edges are dropped silently.
 *
 * The chart content is wrapped in a zoom+pan viewport. Wheel zooms,
 * click+drag pans, and the toolbar buttons (+/-/fit) give precise
 * control. Default view scales to fit the container width.
 */
export default function RolesChart({ roles, edges, agentNames, onSelectRole }: RolesChartProps) {
  const directors = roles.filter((r) => r.role_type === "director");
  const advisors = roles.filter((r) => r.role_type === "advisor");
  const operational = roles.filter((r) => r.role_type === "operational");

  const opIds = new Set(operational.map((r) => r.id));
  const opEdges = edges.filter((e) => opIds.has(e.parent_role_id) && opIds.has(e.child_role_id));
  const deptLayout = layoutDepts(operational, opEdges);

  if (roles.length === 0) return null;

  return (
    <OrgZoomViewport>
      <div className="roles-chart-stack">
        {directors.length > 0 && (
          <RolesBand
            label="Board"
            roles={directors}
            agentNames={agentNames}
            onSelect={onSelectRole}
          />
        )}
        {(deptLayout.ceo != null || deptLayout.clusters.length > 0) && (
          <section className="roles-chart-zone" aria-label="Org">
            <div className="roles-chart-zone-eyebrow">Org</div>
            <div className="roles-chart-dept-root" role="figure" aria-label="Organisation chart">
              {deptLayout.ceo && (
                <div className="roles-chart-ceo-row">
                  <RoleNode
                    role={deptLayout.ceo}
                    agentName={
                      deptLayout.ceo.occupant_id
                        ? agentNames.get(deptLayout.ceo.occupant_id)
                        : undefined
                    }
                    onClick={() => onSelectRole(deptLayout.ceo!)}
                    className="role-node--apex"
                    style={{ width: NODE_W, height: NODE_H }}
                  />
                </div>
              )}
              {deptLayout.clusters.length > 0 && (
                <div className="roles-chart-dept-row">
                  {deptLayout.clusters.map((cluster) => (
                    <div
                      key={cluster.head.id}
                      className="roles-chart-dept-cluster"
                      aria-label={cluster.head.title}
                    >
                      <div className="roles-chart-dept-label">{cluster.head.title}</div>
                      <div
                        className="roles-chart-canvas"
                        style={{ width: cluster.layout.width, height: cluster.layout.height }}
                      >
                        <svg
                          className="roles-chart-edges"
                          width={cluster.layout.width}
                          height={cluster.layout.height}
                          viewBox={`0 0 ${cluster.layout.width} ${cluster.layout.height}`}
                          aria-hidden
                        >
                          {cluster.layout.edges.map((e, i) => {
                            const x1 = e.from.x + NODE_W / 2;
                            const y1 = e.from.y + NODE_H;
                            const x2 = e.to.x + NODE_W / 2;
                            const y2 = e.to.y;
                            const midY = (y1 + y2) / 2;
                            const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                            return <path key={i} d={d} className="roles-chart-edge-path" />;
                          })}
                        </svg>
                        {cluster.layout.nodes.map((n) => (
                          <RoleNode
                            key={n.role.id}
                            role={n.role}
                            agentName={
                              n.role.occupant_id ? agentNames.get(n.role.occupant_id) : undefined
                            }
                            onClick={() => onSelectRole(n.role)}
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
        {advisors.length > 0 && (
          <RolesBand
            label="Advisors"
            roles={advisors}
            agentNames={agentNames}
            onSelect={onSelectRole}
          />
        )}
      </div>
    </OrgZoomViewport>
  );
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
    // Center horizontally; small top offset keeps eyebrow labels visible.
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
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTransform((prev) => ({
      ...prev,
      tx: dragRef.current!.startTx + dx,
      ty: dragRef.current!.startTy + dy,
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

interface RolesBandProps {
  label: string;
  roles: Role[];
  agentNames: Map<string, string>;
  onSelect: (role: Role) => void;
}

function RolesBand({ label, roles, agentNames, onSelect }: RolesBandProps) {
  return (
    <section className="roles-chart-zone" aria-label={label}>
      <div className="roles-chart-zone-eyebrow">{label}</div>
      <div className="roles-chart-roster">
        {roles.map((r) => (
          <RoleNode
            key={r.id}
            role={r}
            agentName={r.occupant_id ? agentNames.get(r.occupant_id) : undefined}
            onClick={() => onSelect(r)}
            style={{ width: NODE_W, height: NODE_H }}
          />
        ))}
      </div>
    </section>
  );
}
