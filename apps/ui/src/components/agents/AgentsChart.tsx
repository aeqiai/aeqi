import { useMemo } from "react";
import type { Agent, Role, RoleEdge } from "@/lib/types";
import { EmptyState } from "../ui";
import { layoutChart, reRootEdges, NODE_W, NODE_H } from "@/components/roles/layout";
import AgentChartCard from "./AgentChartCard";

/**
 * Pure layered-DAG chart over agent-occupied roles.
 *
 * Uses `layoutChart` (Sugiyama-lite) directly over the operational
 * role DAG. CEO at layer 0; direct reports at layer 1; grandchildren
 * at layer 2; etc. No painted department-cluster envelopes — hierarchy
 * is expressed by vertical position and connecting bezier edges.
 *
 * Unoccupied roles render as muted vacant placeholders so the shape
 * of the org is visible even when agents haven't been assigned yet.
 */
export default function AgentsChart({
  positions,
  edges,
  entityAgents,
  loading,
  error,
  onSelect,
}: {
  positions: Role[];
  edges: RoleEdge[];
  entityAgents: Agent[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}) {
  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of entityAgents) m.set(a.id, a);
    return m;
  }, [entityAgents]);

  if (loading) {
    return (
      <div className="ideas-list-body" style={{ color: "var(--color-text-muted)" }}>
        Loading org chart…
      </div>
    );
  }
  if (error) {
    return (
      <div className="ideas-list-body" style={{ color: "var(--color-error)" }}>
        {error}
      </div>
    );
  }

  // Agents-only view — the chart MUST reflect agent-to-agent hierarchy,
  // not the literal subset of original edges. Filter to roles whose
  // occupant is an agent (any role_type — operational, advisor, etc.),
  // then re-root: each agent's effective parent is the nearest agent
  // ancestor in the full DAG. Otherwise human-occupied or vacant
  // intermediaries (e.g. a human CEO between Director and CFO) leave
  // every direct report stranded as a depth-0 root, falsely peering
  // them with parentless advisors.
  const agentRoles = positions.filter((r) => r.occupant_kind === "agent");
  const agentRoleIds = new Set(agentRoles.map((r) => r.id));
  const agentEdges = reRootEdges(agentRoleIds, edges);
  const treeLayout = layoutChart(agentRoles, agentEdges);

  if (agentRoles.length === 0) {
    return (
      <div className="ideas-list-body">
        <EmptyState
          title="No org chart yet."
          description="Roles appear once a Blueprint finishes seeding."
        />
      </div>
    );
  }

  return (
    <div className="ideas-list-body" style={{ padding: "24px 28px 48px", overflowX: "auto" }}>
      <div
        className="roles-chart-canvas"
        style={{ position: "relative", width: treeLayout.width, height: treeLayout.height }}
        role="figure"
        aria-label="Agents org chart"
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
          <AgentChartCard
            key={n.role.id}
            role={n.role}
            agent={n.role.occupant_id ? agentById.get(n.role.occupant_id) : undefined}
            apex={n.layer === 0}
            onSelect={onSelect}
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              width: NODE_W,
              minHeight: NODE_H,
            }}
          />
        ))}
      </div>
    </div>
  );
}
