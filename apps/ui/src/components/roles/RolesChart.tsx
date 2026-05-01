import { useMemo } from "react";
import type { Role, RoleEdge } from "@/lib/types";
import RoleNode from "./RoleNode";
import { layoutChart, NODE_H, NODE_W } from "./layout";

export interface RolesChartProps {
  roles: Role[];
  edges: RoleEdge[];
  agentNames: Map<string, string>;
  onSelectRole: (role: Role) => void;
}

/**
 * Real layered DAG render. Nodes are absolutely positioned within a
 * computed canvas and connected by cubic bezier `<path>`s so the
 * org-chart reads as one coherent diagram instead of a stack of rows.
 *
 * Layout decisions live in `./layout.ts` so the algorithm is pure and
 * unit-testable; this component is the SVG + DOM renderer.
 */
export default function RolesChart({ roles, edges, agentNames, onSelectRole }: RolesChartProps) {
  const layout = useMemo(() => layoutChart(roles, edges), [roles, edges]);

  if (layout.nodes.length === 0) return null;

  return (
    <div className="roles-chart-scroll">
      <div
        className="roles-chart-canvas"
        style={{ width: layout.width, height: layout.height }}
        role="figure"
        aria-label="Organisation chart"
      >
        <svg
          className="roles-chart-edges"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden
        >
          {layout.edges.map((e, i) => {
            const x1 = e.from.x + NODE_W / 2;
            const y1 = e.from.y + NODE_H;
            const x2 = e.to.x + NODE_W / 2;
            const y2 = e.to.y;
            const midY = (y1 + y2) / 2;
            const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            return <path key={i} d={d} className="roles-chart-edge-path" />;
          })}
        </svg>
        {layout.nodes.map((n) => (
          <RoleNode
            key={n.role.id}
            role={n.role}
            agentName={n.role.occupant_id ? agentNames.get(n.role.occupant_id) : undefined}
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
  );
}
