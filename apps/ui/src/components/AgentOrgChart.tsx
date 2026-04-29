import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { CardTrigger } from "./ui";
import BlockAvatar from "./BlockAvatar";
import BrandMark from "./BrandMark";
import { BlueprintPickerModal } from "@/components/blueprints/BlueprintPickerModal";
import type { Agent, Position, PositionEdge } from "@/lib/types";
import "@/styles/org-chart.css";

interface OrgNode {
  id: string;
  label: string;
  subLabel?: string;
  isRoot: boolean;
  children: OrgNode[];
}

/**
 * Build a tree of agent OrgNodes from the position DAG. Roots are
 * positions with no incoming edges. The DAG is rendered as a tree by
 * walking each child position once (cycle-safe via a visited set).
 */
function buildOrgFromPositions(
  agents: Agent[],
  positions: Position[],
  edges: PositionEdge[],
  rootAgentId: string,
): OrgNode | null {
  const agentById = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  const positionById = new Map<string, Position>(positions.map((p) => [p.id, p]));

  const childrenByPosition = new Map<string, string[]>();
  const incomingByPosition = new Map<string, number>();
  for (const p of positions) incomingByPosition.set(p.id, 0);
  for (const e of edges) {
    const list = childrenByPosition.get(e.parent_position_id) || [];
    list.push(e.child_position_id);
    childrenByPosition.set(e.parent_position_id, list);
    incomingByPosition.set(
      e.child_position_id,
      (incomingByPosition.get(e.child_position_id) || 0) + 1,
    );
  }

  const rootPosition = positions.find(
    (p) => p.occupant_kind === "agent" && p.occupant_id === rootAgentId,
  );
  if (!rootPosition) {
    const fallback = agentById.get(rootAgentId);
    if (!fallback) return null;
    return {
      id: fallback.id,
      label: fallback.name,
      subLabel: fallback.status,
      isRoot: true,
      children: [],
    };
  }

  function toNode(positionId: string, isRoot: boolean, visited: Set<string>): OrgNode | null {
    if (visited.has(positionId)) return null;
    visited.add(positionId);
    const position = positionById.get(positionId);
    if (!position) return null;
    const occupant =
      position.occupant_kind === "agent" && position.occupant_id
        ? agentById.get(position.occupant_id)
        : undefined;
    const label = occupant?.name ?? position.title ?? "(vacant)";
    const subLabel = occupant?.status ?? position.occupant_kind;
    const kids = (childrenByPosition.get(positionId) || [])
      .map((cid) => toNode(cid, false, visited))
      .filter((n): n is OrgNode => n != null);
    return {
      id: occupant?.id ?? position.id,
      label,
      subLabel,
      isRoot,
      children: kids,
    };
  }

  return toNode(rootPosition.id, true, new Set());
}

/**
 * Org-chart view of a subtree rooted at `parentAgentId`. A classic
 * top-down hierarchy: the parent sits atop a row of direct reports, and
 * each report unfolds its own descendants below it. Card-styled nodes,
 * hairline connectors drawn with CSS pseudo-elements.
 *
 * The rightmost slot of the first row is a "+ New agent" placeholder
 * that opens the Blueprint picker modal, so spawning a report is one
 * click away from reading the structure.
 */
export default function AgentOrgChart({
  parentAgentId,
  onSelect,
}: {
  parentAgentId: string;
  onSelect?: (agentId: string) => void;
}) {
  const navigate = useNavigate();
  const agents = useDaemonStore((s) => s.agents);
  const entityId = useMemo(() => {
    const found = agents.find((a) => a.id === parentAgentId);
    return found?.entity_id ?? null;
  }, [agents, parentAgentId]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [positions, setPositions] = useState<Position[]>([]);
  const [edges, setEdges] = useState<PositionEdge[]>([]);
  useEffect(() => {
    if (!entityId) {
      setPositions([]);
      setEdges([]);
      return;
    }
    let cancelled = false;
    api
      .getPositions(entityId)
      .then((resp) => {
        if (cancelled) return;
        setPositions(resp.positions ?? []);
        setEdges(resp.edges ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setPositions([]);
        setEdges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const org = useMemo(
    () => buildOrgFromPositions(agents, positions, edges, parentAgentId),
    [agents, positions, edges, parentAgentId],
  );

  // Flat nav index: for each node, remember the parent, the sibling row
  // (in display order), and the first child. Arrow keys turn this into a
  // 2D tree walk without re-crawling on every keypress.
  const navIndex = useMemo(() => {
    if (!org) return null;
    const info = new Map<
      string,
      { parentId: string | null; siblings: string[]; firstChildId: string | null }
    >();
    const walk = (node: OrgNode, parentId: string | null, siblings: string[]) => {
      info.set(node.id, {
        parentId,
        siblings,
        firstChildId: node.children[0]?.id ?? null,
      });
      const childIds = node.children.map((c) => c.id);
      for (const child of node.children) walk(child, node.id, childIds);
    };
    walk(org, null, [org.id]);
    return info;
  }, [org]);

  // Claim focus on the root card when the chart first mounts — only if
  // nothing else has grabbed it. Lets keyboard users land here and start
  // arrow-walking without hunting for the first Tab stop.
  const chartRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const active = document.activeElement;
    const claimable = !active || active === document.body || active.tagName === "HTML";
    if (!claimable) return;
    const first = el.querySelector<HTMLElement>("[data-agent-id]");
    first?.focus({ preventScroll: true });
  }, [parentAgentId]);

  if (!org) return null;

  const handleSelect = (id: string) => {
    if (onSelect) onSelect(id);
    else navigate(`/${encodeURIComponent(id)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!navIndex) return;
    const isArrow =
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown";
    const isPlus = e.key === "+" || e.key === "=";
    if (!isArrow && !isPlus) return;
    const active = (e.target as HTMLElement).closest("[data-agent-id]") as HTMLElement | null;
    if (!active) return;
    const id = active.dataset.agentId;
    if (!id) return;
    if (isPlus) {
      e.preventDefault();
      setPickerOpen(true);
      return;
    }
    const entry = navIndex.get(id);
    if (!entry) return;
    let dest: string | null = null;
    if (e.key === "ArrowRight") {
      const idx = entry.siblings.indexOf(id);
      if (idx >= 0 && idx < entry.siblings.length - 1) dest = entry.siblings[idx + 1];
    } else if (e.key === "ArrowLeft") {
      const idx = entry.siblings.indexOf(id);
      if (idx > 0) dest = entry.siblings[idx - 1];
    } else if (e.key === "ArrowUp") {
      dest = entry.parentId;
    } else if (e.key === "ArrowDown") {
      dest = entry.firstChildId;
    }
    if (!dest) return;
    const next = e.currentTarget.querySelector<HTMLElement>(
      `[data-agent-id="${CSS.escape(dest)}"]`,
    );
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <div className="org-chart" ref={chartRef} onKeyDown={onKeyDown}>
      <div className="org-scroll">
        <OrgNodeView node={org} onSelect={handleSelect} onAddChild={() => setPickerOpen(true)} />
      </div>
      {entityId && (
        <BlueprintPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          entityId={entityId}
        />
      )}
    </div>
  );
}

function OrgNodeView({
  node,
  onSelect,
  onAddChild,
}: {
  node: OrgNode;
  onSelect: (id: string) => void;
  onAddChild: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const showAddSlot = node.isRoot; // Only the root exposes an inline +New on the org chart.
  const showChildRow = hasChildren || showAddSlot;

  return (
    <div className={`org-node ${showChildRow ? "has-below" : ""}`}>
      <CardTrigger
        className={`org-card ${node.isRoot ? "is-root" : ""}`}
        data-agent-id={node.id}
        onClick={() => onSelect(node.id)}
        aria-label={`Select agent: ${node.label}`}
      >
        <span className="org-card-avatar">
          {node.isRoot ? <BlockAvatar name={node.label} size={20} /> : <BrandMark size={14} />}
        </span>
        <span className="org-card-body">
          <span className="org-card-name">{node.label}</span>
          {node.subLabel && <span className="org-card-sub">{node.subLabel}</span>}
        </span>
      </CardTrigger>

      {showChildRow && (
        <div
          className={`org-children ${node.children.length + (showAddSlot ? 1 : 0) === 1 ? "is-single" : ""}`}
        >
          {node.children.map((child) => (
            <OrgNodeView key={child.id} node={child} onSelect={onSelect} onAddChild={onAddChild} />
          ))}
          {showAddSlot && (
            <div className="org-node">
              <CardTrigger
                className="org-card is-add"
                onClick={onAddChild}
                aria-label="Spawn sub-agent"
                title="Spawn sub-agent"
              >
                <span className="org-card-avatar">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </span>
              </CardTrigger>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
