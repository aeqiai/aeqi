import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "./BlockAvatar";
import BrandMark from "./BrandMark";
import type { Agent } from "@/lib/types";
import "@/styles/org-chart.css";

interface OrgNode {
  id: string;
  label: string;
  subLabel?: string;
  isRoot: boolean;
  children: OrgNode[];
}

function buildOrg(agents: Agent[], rootId: string): OrgNode | null {
  const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  const root = byId.get(rootId);
  if (!root) return null;

  const childrenByParent = new Map<string, Agent[]>();
  for (const a of agents) {
    if (!a.parent_id) continue;
    const list = childrenByParent.get(a.parent_id) || [];
    list.push(a);
    childrenByParent.set(a.parent_id, list);
  }

  function toNode(agent: Agent, isRoot: boolean): OrgNode {
    const kids = childrenByParent.get(agent.id) || [];
    return {
      id: agent.id,
      label: agent.display_name || agent.name,
      subLabel: agent.status,
      isRoot,
      children: kids.map((k) => toNode(k, false)),
    };
  }

  return toNode(root, true);
}

/**
 * Org-chart view of a subtree rooted at `parentAgentId`. A classic
 * top-down hierarchy: the parent sits atop a row of direct reports, and
 * each report unfolds its own descendants below it. Card-styled nodes,
 * hairline connectors drawn with CSS pseudo-elements.
 *
 * The rightmost slot of the first row is a "+ New agent" placeholder
 * that routes to /new?parent=<id>, so spawning a report is one click
 * away from reading the structure.
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
  const org = useMemo(() => buildOrg(agents, parentAgentId), [agents, parentAgentId]);

  if (!org) return null;

  const handleSelect = (id: string) => {
    if (onSelect) onSelect(id);
    else navigate(`/${encodeURIComponent(id)}`);
  };

  return (
    <div className="org-chart">
      <div className="org-scroll">
        <OrgNodeView
          node={org}
          onSelect={handleSelect}
          onAddChild={(parentId) => navigate(`/new?parent=${encodeURIComponent(parentId)}`)}
        />
      </div>
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
  onAddChild: (parentId: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const showAddSlot = node.isRoot; // Only the root exposes an inline +New on the org chart.
  const showChildRow = hasChildren || showAddSlot;

  return (
    <div className={`org-node ${showChildRow ? "has-below" : ""}`}>
      <button
        type="button"
        className={`org-card ${node.isRoot ? "is-root" : ""}`}
        onClick={() => onSelect(node.id)}
      >
        <span className="org-card-avatar">
          {node.isRoot ? <BlockAvatar name={node.label} size={28} /> : <BrandMark size={18} />}
        </span>
        <span className="org-card-body">
          <span className="org-card-name">{node.label}</span>
          {node.subLabel && <span className="org-card-sub">{node.subLabel}</span>}
        </span>
      </button>

      {showChildRow && (
        <div
          className={`org-children ${node.children.length + (showAddSlot ? 1 : 0) === 1 ? "is-single" : ""}`}
        >
          {node.children.map((child) => (
            <OrgNodeView key={child.id} node={child} onSelect={onSelect} onAddChild={onAddChild} />
          ))}
          {showAddSlot && (
            <div className="org-node">
              <button
                type="button"
                className="org-card is-add"
                onClick={() => onAddChild(node.id)}
                title="Spawn sub-agent"
              >
                <span className="org-card-avatar">
                  <svg
                    width="16"
                    height="16"
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
                <span className="org-card-body">
                  <span className="org-card-name">New agent</span>
                  <span className="org-card-sub">Spawn a report</span>
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
