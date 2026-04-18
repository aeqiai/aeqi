import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import BrandMark from "./BrandMark";
import type { Agent, AgentRef } from "@/lib/types";
import styles from "./Sidebar.module.css";

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

function buildSubtree(agents: Agent[], rootId: string): AgentNode | null {
  const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  const root = byId.get(rootId);
  if (!root) return null;

  const childrenByParent = new Map<string, Agent[]>();
  for (const a of agents) {
    if (!a.parent_id) continue;
    const existing = childrenByParent.get(a.parent_id) || [];
    existing.push(a);
    childrenByParent.set(a.parent_id, existing);
  }

  function toNode(agent: Agent): AgentNode {
    const kids = childrenByParent.get(agent.id) || [];
    return {
      id: agent.id,
      name: agent.name,
      display_name: agent.display_name,
      status: agent.status,
      model: agent.model,
      children: kids.map(toNode),
    };
  }
  return toNode(root);
}

function countDescendants(node: AgentNode): number {
  let count = node.children.length;
  for (const child of node.children) count += countDescendants(child);
  return count;
}

/** Walk up parent_id chain to find the root of this agent's tree. */
function findRootId(agents: Agent[], id: string): string | null {
  const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  let current = byId.get(id);
  for (let i = 0; i < 20 && current; i++) {
    if (!current.parent_id) return current.id;
    current = byId.get(current.parent_id);
  }
  return current?.id || null;
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
    <div className={styles.node}>
      <div
        className={isActive ? styles.rowActive : styles.row}
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
        <span className={styles.iconSlot}>
          <BrandMark size={14} />
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {hasChildren && (
          <span className={styles.toggle} onClick={(e) => onToggle(node.id, e)}>
            {isCollapsed && <span className={styles.count}>{descendantCount}</span>}
            <Chevron expanded={!isCollapsed} />
          </span>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <div className={styles.children}>
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

/**
 * Recursive agent tree rooted at the current URL agent's root ancestor.
 *
 * Version B: clicking any agent navigates to `/{id}` — no more `/agents/`
 * segment. Selection highlighted by matching against `:agentId` from URL.
 */
export default function AgentTree() {
  const navigate = useNavigate();
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const allAgents = useDaemonStore((s) => s.agents);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { agentId } = useParams<{ agentId?: string }>();
  const selectedId = agentId || null;

  // Resolve the tree's root from the URL's agent (walk up parent chain).
  const rootId = useMemo(
    () => (agentId ? findRootId(allAgents, agentId) : null),
    [agentId, allAgents],
  );
  const tree = useMemo(
    () => (rootId ? buildSubtree(allAgents, rootId) : null),
    [rootId, allAgents],
  );

  const toggleNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectAgent = (agent: AgentRef) => {
    setSelectedAgent(agent);
    navigate(`/${encodeURIComponent(agent.id)}`);
  };

  if (!tree) {
    return <div className={styles.empty}>No agents</div>;
  }

  return (
    <nav className={styles.tree}>
      <div className={styles.list}>
        <AgentNodeView
          node={tree}
          depth={0}
          selectedId={selectedId}
          collapsed={collapsed}
          onSelectAgent={handleSelectAgent}
          onToggle={toggleNode}
        />
      </div>
    </nav>
  );
}
