import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
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
  /** Path to the "create role" flow — used by the ghost-add affordance
   *  below the operational subtree. When omitted, no ghost renders. */
  newRolePath?: string;
}

interface CrossConnector {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Explicit edges come from `role_edges` data — they were wired by an
   *  operator and read as solid ink. Implicit edges are synthesized
   *  (director → apex operator) when no explicit governance wiring
   *  exists; they render dashed + muted to match the inspector's
   *  implicit chip treatment so canvas and inspector tell the same
   *  story about edge provenance. */
  implicit: boolean;
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
  newRolePath,
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
  //
  // When the data has explicit director→operational edges, draw those.
  // When it doesn't (very common — Foundation TRUSTs rarely encode the
  // implicit "board governs leadership" relation as an edge), synthesize
  // a connection from each director to each operational APEX role
  // (roles with no operational parent). The relationship is structural,
  // not data-driven, and not showing it makes the board look orphaned.
  // Each cross-zone edge carries an `implicit` flag so downstream
  // rendering can distinguish wired governance from synthesized
  // governance. The inspector already encodes this distinction via
  // chip variants; the canvas should too — otherwise a quick glance
  // at the chart misreads "definitely wired" for what is in fact
  // "structurally implied because the schema is empty here".
  const crossEdges = useMemo<Array<RoleEdge & { implicit: boolean }>>(() => {
    if (directors.length === 0 || operational.length === 0) return [];
    // Apex = operational roles with no operational parent.
    const opChildIds = new Set<string>();
    for (const e of edges) {
      if (opIds.has(e.parent_role_id) && opIds.has(e.child_role_id)) {
        opChildIds.add(e.child_role_id);
      }
    }
    const apexOps = operational.filter((r) => !opChildIds.has(r.id));
    const apexIds = new Set(apexOps.map((r) => r.id));

    // All explicit director→operational edges (any operator, not just apex).
    // Preserved verbatim — a director wired to a mid-tree operator stays
    // drawn as before.
    const explicitEdges = edges.filter(
      (e) => directorIds.has(e.parent_role_id) && opIds.has(e.child_role_id),
    );

    // Per-director synthesis of director→APEX coverage. For each director,
    // fill in implicit edges to every apex operator the director has NOT
    // explicitly wired. A director with zero explicit edges gets full
    // implicit fan-out (current cycle-2 behaviour). A director with
    // explicit edges to every apex gets none. A director with explicit
    // edges to a subset gets the "partial implicit" mix the c5 tooltip
    // surfaces in the inspector.
    const explicitApexByDir = new Map<string, Set<string>>();
    for (const e of explicitEdges) {
      if (!apexIds.has(e.child_role_id)) continue;
      const set = explicitApexByDir.get(e.parent_role_id) ?? new Set<string>();
      set.add(e.child_role_id);
      explicitApexByDir.set(e.parent_role_id, set);
    }

    const result: Array<RoleEdge & { implicit: boolean }> = explicitEdges.map((e) => ({
      ...e,
      implicit: false,
    }));
    for (const dir of directors) {
      const wired = explicitApexByDir.get(dir.id) ?? new Set<string>();
      for (const apex of apexOps) {
        if (wired.has(apex.id)) continue;
        result.push({ parent_role_id: dir.id, child_role_id: apex.id, implicit: true });
      }
    }
    return result;
  }, [edges, directorIds, opIds, directors, operational]);

  // Director IDs whose governance edges to the operational tree are
  // ALL synthesized (no explicit wiring). RoleNode uses this to render
  // a quieter selected ring + a small "implicit" head-row hint, so
  // governance-by-implication is legible on the node itself — not just
  // on the cross-edge stroke. Pairs with the dashed/muted edge variant
  // shipped in cycle 2 and the inspector's implicit chip/hint pair so
  // inspector / canvas / node all carry the same provenance signal.
  const implicitDirectorIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const e of crossEdges) {
      if (!e.implicit) continue;
      ids.add(e.parent_role_id);
    }
    // A director with at least one explicit outbound governance edge is
    // NOT implicit overall — explicit wiring wins for the node-level
    // signal, even if some peers are synthesized.
    for (const e of crossEdges) {
      if (!e.implicit) ids.delete(e.parent_role_id);
    }
    return ids;
  }, [crossEdges]);

  // Operator IDs whose inbound governance edges from the director roster
  // are ALL synthesized — the apex-operator mirror of `implicitDirectorIds`.
  // Without this, an apex operator under an implicit-governance board
  // looks identical to one whose director->operator delegation is wired
  // in `role_edges`. The dashed cross-edge already tells the story for
  // the line; the receiving node should carry the same provenance hint
  // so the implication reads bidirectionally on canvas — director AND
  // apex both marked implicit, mirroring the inspector's chip treatment.
  const implicitOperatorIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const e of crossEdges) {
      if (!e.implicit) continue;
      ids.add(e.child_role_id);
    }
    // Any explicit inbound governance edge promotes the operator out of
    // the implicit set — explicit wiring wins, matching the director
    // rule above.
    for (const e of crossEdges) {
      if (!e.implicit) ids.delete(e.child_role_id);
    }
    return ids;
  }, [crossEdges]);

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
          implicit: e.implicit,
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
              const midX = (c.x1 + c.x2) / 2;
              const midY = (c.y1 + c.y2) / 2;
              const d = `M ${c.x1} ${c.y1} C ${c.x1} ${midY}, ${c.x2} ${midY}, ${c.x2} ${c.y2}`;
              // Explicit edges = wired role_edges -> solid ink, no
              // hedge. Implicit edges = structurally synthesized ->
              // dashed + muted, labelled "implicit" so the canvas
              // tells the same provenance story as the inspector.
              const pathClass = c.implicit
                ? "roles-chart-cross-edge-path roles-chart-cross-edge-path--implicit"
                : "roles-chart-cross-edge-path";
              const label = c.implicit ? "implicit governance" : "delegates execution";
              const labelW = c.implicit ? 132 : 128;
              return (
                <g key={i}>
                  <path d={d} className={pathClass} />
                  {/* Label rendered as a paper-coloured pill in the middle
                     of the line so the stroke visibly threads through it.
                     For implicit edges the pill carries the provenance
                     hint ("implicit governance") so a reader can see at
                     a glance that the edge is inferred, not wired. */}
                  <rect
                    x={midX - labelW / 2}
                    y={midY - 8}
                    width={labelW}
                    height={16}
                    rx={8}
                    className="roles-chart-cross-edge-label-bg"
                  />
                  <text
                    x={midX}
                    y={midY + 3}
                    className={
                      c.implicit
                        ? "roles-chart-cross-edge-label roles-chart-cross-edge-label--implicit"
                        : "roles-chart-cross-edge-label"
                    }
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                </g>
              );
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
                  implicit={implicitDirectorIds.has(r.id)}
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
                  implicit={implicitOperatorIds.has(n.role.id)}
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
            {/* Ghost-add CTA below the operational tree — turns the
               canvas empty-state into an intentional "expand here"
               affordance instead of dead whitespace. */}
            {newRolePath && (
              <Link to={newRolePath} className="roles-chart-suggest">
                <Plus size={14} strokeWidth={1.8} />
                Add a role
              </Link>
            )}
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
    if (
      ai.x1 !== bi.x1 ||
      ai.y1 !== bi.y1 ||
      ai.x2 !== bi.x2 ||
      ai.y2 !== bi.y2 ||
      ai.implicit !== bi.implicit
    ) {
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
