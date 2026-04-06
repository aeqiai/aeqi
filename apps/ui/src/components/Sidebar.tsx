import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "./BlockAvatar";
import type { Agent, AgentRef } from "@/lib/types";

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.15s ease",
        flexShrink: 0,
        opacity: 0.4,
      }}
    >
      <path
        d="M4.5 3L7.5 6L4.5 9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface AgentNode {
  id: string;
  name: string;
  display_name?: string;
  status: string;
  model?: string;
  children: AgentNode[];
}

function buildAgentTree(agents: Agent[]): AgentNode[] {
  const byId = new Map<string, Agent>();
  for (const a of agents) byId.set(a.id, a);

  const childrenMap = new Map<string, Agent[]>();
  const roots: Agent[] = [];

  for (const a of agents) {
    if (a.parent_id && byId.has(a.parent_id)) {
      const existing = childrenMap.get(a.parent_id) || [];
      existing.push(a);
      childrenMap.set(a.parent_id, existing);
    } else {
      roots.push(a);
    }
  }

  function toNode(agent: Agent): AgentNode {
    const kids = childrenMap.get(agent.id) || [];
    return {
      id: agent.id,
      name: agent.name,
      display_name: agent.display_name,
      status: agent.status,
      model: agent.model,
      children: kids.map(toNode),
    };
  }

  return roots.map(toNode);
}

function countDescendants(node: AgentNode): number {
  let count = node.children.length;
  for (const child of node.children) count += countDescendants(child);
  return count;
}

function AgentNodeView({
  node,
  depth,
  selectedId,
  collapsed,
  onSelectAgent,
  onToggle,
}: {
  node: AgentNode;
  depth: number;
  selectedId: string | null;
  collapsed: Record<string, boolean>;
  onSelectAgent: (agent: AgentRef) => void;
  onToggle: (id: string, e: React.MouseEvent) => void;
}) {
  const isActive = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed[node.id] ?? false;
  const label = node.display_name || node.name;
  const descendantCount = countDescendants(node);

  return (
    <div className="agent-tree-node">
      <div
        className={`agent-row${isActive ? " active" : ""}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() =>
          onSelectAgent({
            id: node.id,
            name: node.name,
            display_name: node.display_name,
            model: node.model,
          })
        }
      >
        <BlockAvatar name={node.name} size={22} />
        <span className="agent-row-label">{label}</span>
        {hasChildren && (
          <span
            className="agent-tree-toggle"
            onClick={(e) => onToggle(node.id, e)}
          >
            {isCollapsed && <span className="agent-tree-count">{descendantCount}</span>}
            <Chevron expanded={!isCollapsed} />
          </span>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div className="agent-tree-children">
          {node.children.map((child) => (
            <AgentNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              collapsed={collapsed}
              onSelectAgent={onSelectAgent}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentTree() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const allAgents = useDaemonStore((s) => s.agents);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const selectedId = params.get("agent");
  const tree = buildAgentTree(allAgents);

  const toggleNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectAgent = (agent: AgentRef) => {
    setSelectedAgent(agent);
    navigate(`/?agent=${encodeURIComponent(agent.id)}`);
  };

  return (
    <nav className="agent-tree">
      <div className="agent-tree-list">
        {tree.map((node) => (
          <AgentNodeView
            key={node.id}
            node={node}
            depth={0}
            selectedId={selectedId}
            collapsed={collapsed}
            onSelectAgent={handleSelectAgent}
            onToggle={toggleNode}
          />
        ))}

        {allAgents.length === 0 && (
          <div className="agent-tree-empty">No agents yet</div>
        )}
      </div>
    </nav>
  );
}
