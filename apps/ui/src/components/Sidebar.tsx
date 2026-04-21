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
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.14s ease",
        flexShrink: 0,
      }}
    >
      <path
        d="M4.5 3L7.5 6L4.5 9"
        stroke="currentColor"
        strokeWidth="1.4"
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

/**
 * Rail — one vertical column per ancestor depth plus a connector at the
 * current depth. `ancestors[i] === true` means the ancestor at column i
 * still has siblings below it, so a continuous vertical guide is drawn
 * in that column. `isLast` decides elbow vs tee at the current depth.
 */
function Rail({ ancestors, isLast }: { ancestors: boolean[]; isLast: boolean }) {
  return (
    <>
      {ancestors.map((drawLine, i) => (
        <span
          key={i}
          className={drawLine ? styles.guideLine : styles.guideGap}
          aria-hidden="true"
        />
      ))}
      <span
        className={`${styles.connector} ${isLast ? styles.connectorEnd : styles.connectorMid}`}
        aria-hidden="true"
      />
    </>
  );
}

function AgentNodeView({
  node,
  ancestors,
  isLast,
  selectedId,
  expanded,
  onSelectAgent,
  onToggle,
}: {
  node: AgentNode;
  ancestors: boolean[];
  isLast: boolean;
  selectedId: string | null;
  expanded: Record<string, boolean>;
  onSelectAgent: (agent: AgentRef) => void;
  onToggle: (id: string, nextExpanded: boolean, e: React.MouseEvent) => void;
}) {
  const isActive = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded[node.id] ?? true;
  const showChildren = hasChildren && isExpanded;
  const label = node.display_name || node.name;
  const descendantCount = countDescendants(node);

  return (
    <div className={styles.node}>
      <div
        className={isActive ? styles.rowActive : styles.row}
        onClick={() =>
          onSelectAgent({
            id: node.id,
            name: node.name,
            display_name: node.display_name,
            model: node.model,
          })
        }
      >
        <Rail ancestors={ancestors} isLast={isLast} />
        {hasChildren ? (
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={(e) => onToggle(node.id, !isExpanded, e)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            aria-expanded={isExpanded}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <Chevron expanded={isExpanded} />
          </button>
        ) : (
          <span className={styles.collapseSpacer} aria-hidden="true" />
        )}
        <span className={styles.iconSlot}>
          <BrandMark size={14} />
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {hasChildren && !isExpanded && <span className={styles.count}>{descendantCount}</span>}
      </div>
      {showChildren && (
        <div className={styles.children}>
          {node.children.map((child, i) => (
            <AgentNodeView
              key={child.id}
              node={child}
              ancestors={[...ancestors, !isLast]}
              isLast={i === node.children.length - 1}
              selectedId={selectedId}
              expanded={expanded}
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
 * Root-row: one row per root agent. Roots sit flush-left with no rail.
 * The active root (URL) auto-expands; clicking the chevron on any root
 * overrides that default so inactive roots can also be peeked.
 */
function RootRow({
  agent,
  isActive,
  selectedId,
  allAgents,
  expanded,
  onSelectAgent,
  onToggle,
}: {
  agent: Agent;
  isActive: boolean;
  selectedId: string | null;
  allAgents: Agent[];
  expanded: Record<string, boolean>;
  onSelectAgent: (agent: AgentRef) => void;
  onToggle: (id: string, nextExpanded: boolean, e: React.MouseEvent) => void;
}) {
  const label = agent.display_name || agent.name;
  const isSelectedRow = selectedId === agent.id;
  const subtree = useMemo(() => buildSubtree(allAgents, agent.id), [allAgents, agent.id]);
  const descendantCount = subtree ? countDescendants(subtree) : 0;
  const hasChildren = descendantCount > 0;
  const isExpanded = expanded[agent.id] ?? isActive;
  const showChildren = hasChildren && isExpanded;

  return (
    <div className={styles.node}>
      <div
        className={`${isSelectedRow ? styles.rowActive : styles.row} ${styles.rootRow}`}
        onClick={() =>
          onSelectAgent({
            id: agent.id,
            name: agent.name,
            display_name: agent.display_name,
            model: agent.model,
          })
        }
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={(e) => onToggle(agent.id, !isExpanded, e)}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            aria-expanded={isExpanded}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            <Chevron expanded={isExpanded} />
          </button>
        ) : (
          <span className={styles.collapseSpacer} aria-hidden="true" />
        )}
        <span className={styles.iconSlot}>
          <BlockAvatar name={label} size={18} />
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {hasChildren && !isExpanded && <span className={styles.count}>{descendantCount}</span>}
      </div>
      {showChildren &&
        subtree &&
        subtree.children.map((child, i) => (
          <AgentNodeView
            key={child.id}
            node={child}
            ancestors={[]}
            isLast={i === subtree.children.length - 1}
            selectedId={selectedId}
            expanded={expanded}
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { agentId } = useParams<{ agentId?: string }>();
  const selectedId = agentId || null;

  const activeRootId = useMemo(
    () => (agentId ? findRootId(allAgents, agentId) : null),
    [agentId, allAgents],
  );

  const roots = useMemo(() => allAgents.filter((a) => !a.parent_id), [allAgents]);

  const toggleNode = (id: string, next: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: next }));
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
            expanded={expanded}
            onSelectAgent={handleSelectAgent}
            onToggle={toggleNode}
          />
        ))}
      </div>
    </nav>
  );
}
