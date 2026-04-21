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

  if (!org) return null;

  const handleSelect = (id: string) => {
    if (onSelect) onSelect(id);
    else navigate(`/${encodeURIComponent(id)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!navIndex) return;
    if (
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown"
    )
      return;
    const active = (e.target as HTMLElement).closest("[data-agent-id]") as HTMLElement | null;
    if (!active) return;
    const id = active.dataset.agentId;
    if (!id) return;
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
    <div className="org-chart" onKeyDown={onKeyDown}>
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
        data-agent-id={node.id}
        onClick={() => onSelect(node.id)}
      >
        <span className="org-card-avatar">
          {node.isRoot ? <BlockAvatar name={node.label} size={20} /> : <BrandMark size={14} />}
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
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
