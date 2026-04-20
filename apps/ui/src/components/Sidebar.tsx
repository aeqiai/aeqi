import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import BrandMark from "./BrandMark";
import BlockAvatar from "./BlockAvatar";
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
        opacity: 0.5,
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
 * Root-row: one row per root agent. The active root (the one in the URL)
 * renders its subtree directly beneath it; non-active roots stay
 * collapsed. Clicking an inactive root navigates to it, which makes it
 * the active root and auto-expands its tree on the next render — no
 * separate expand state to manage.
 */
function RootRow({
  agent,
  isActive,
  selectedId,
  allAgents,
  collapsed,
  onSelectAgent,
  onToggle,
}: {
  agent: Agent;
  isActive: boolean;
  selectedId: string | null;
  allAgents: Agent[];
  collapsed: Record<string, boolean>;
  onSelectAgent: (agent: AgentRef) => void;
  onToggle: (id: string, e: React.MouseEvent) => void;
}) {
  const label = agent.display_name || agent.name;
  const isSelectedRow = selectedId === agent.id;
  const subtree = useMemo(() => buildSubtree(allAgents, agent.id), [allAgents, agent.id]);
  const descendantCount = subtree ? countDescendants(subtree) : 0;

  return (
    <div className={styles.node}>
      <div
        className={isSelectedRow ? styles.rowActive : styles.row}
        style={{ paddingLeft: "8px" }}
        onClick={() =>
          onSelectAgent({
            id: agent.id,
            name: agent.name,
            display_name: agent.display_name,
            model: agent.model,
          })
        }
      >
        <span className={styles.iconSlot}>
          <BlockAvatar name={label} size={18} />
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {descendantCount > 0 && (
          <span className={styles.toggle}>
            {!isActive && <span className={styles.count}>{descendantCount}</span>}
            <Chevron expanded={isActive} />
          </span>
        )}
      </div>
      {isActive &&
        subtree &&
        subtree.children.map((child) => (
          <AgentNodeView
            key={child.id}
            node={child}
            depth={1}
            selectedId={selectedId}
            collapsed={collapsed}
            onSelectAgent={onSelectAgent}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

/**
 * Agent tree: one flat list of every root agent, with the URL's active
 * root expanded to show its subtree. "+ New company" at the top creates
 * a new root (routes to /new). Sub-agents are created from within an
 * agent's Agents tab — not from this sidebar.
 */
export default function AgentTree() {
  const navigate = useNavigate();
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const allAgents = useDaemonStore((s) => s.agents);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const { agentId } = useParams<{ agentId?: string }>();
  const selectedId = agentId || null;

  const activeRootId = useMemo(
    () => (agentId ? findRootId(allAgents, agentId) : null),
    [agentId, allAgents],
  );

  const roots = useMemo(() => allAgents.filter((a) => !a.parent_id), [allAgents]);

  const toggleNode = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectAgent = (agent: AgentRef) => {
    setSelectedAgent(agent);
    navigate(`/${encodeURIComponent(agent.id)}`);
  };

  return (
    <nav className={styles.tree}>
      <button type="button" className={styles.newCompany} onClick={() => navigate("/new")}>
        <span className={styles.iconSlot}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M7 3v8M3 7h8" />
          </svg>
        </span>
        <span className={styles.rowLabel}>New company</span>
      </button>
      <div className={styles.list}>
        {roots.length === 0 && <div className={styles.empty}>No agents</div>}
        {roots.map((r) => (
          <RootRow
            key={r.id}
            agent={r}
            isActive={r.id === activeRootId}
            selectedId={selectedId}
            allAgents={allAgents}
            collapsed={collapsed}
            onSelectAgent={handleSelectAgent}
            onToggle={toggleNode}
          />
        ))}
      </div>
    </nav>
  );
}
