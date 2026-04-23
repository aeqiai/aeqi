import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
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
 * RailGlyph — SVG path for one rail cell. Three variants:
 *
 *   guide  — ancestor column still has siblings below: straight vertical
 *            line at x=9 running the full cell height.
 *   tee    — middle child: trunk passes through, branch exits right with
 *            a soft quadratic curve at the junction.
 *   elbow  — last child: trunk stops at mid, branch exits right with the
 *            same soft curve.
 *
 * Using SVG (not CSS pseudo-elements) so the corner is a real curve with
 * antialiased stroke, not a jagged `border-radius` on a rectangle.
 * `vectorEffect="non-scaling-stroke"` keeps the line at 1px even as the
 * cell stretches to match --sidebar-row-h.
 */
function RailGlyph({ variant }: { variant: "guide" | "tee" | "elbow" }) {
  // 16×32 cell. Trunk runs at x=8 (cell center) so it lines up perfectly
  // with the avatar column above (also 16px, center at 8) and the
  // primitive-nav icons in sidebar-nav-item (SVG width 16, identical
  // row-padding). Branch exits to the right edge at x=16.
  const d =
    variant === "guide"
      ? "M8 0 V32"
      : variant === "tee"
        ? "M8 0 V32 M8 9 Q8 16 14 16 H16"
        : "M8 0 V9 Q8 16 14 16 H16";
  return (
    <svg
      className={styles.railSvg}
      viewBox="0 0 16 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
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
        <span key={i} className={drawLine ? styles.guideLine : styles.guideGap} aria-hidden="true">
          {drawLine && <RailGlyph variant="guide" />}
        </span>
      ))}
      <span
        className={`${styles.connector} ${isLast ? styles.connectorEnd : styles.connectorMid}`}
        aria-hidden="true"
      >
        <RailGlyph variant={isLast ? "elbow" : "tee"} />
      </span>
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
  const label = node.name;
  const descendantCount = countDescendants(node);

  const select = () =>
    onSelectAgent({
      id: node.id,
      name: node.name,
      model: node.model,
    });
  // Treeview-ish: Enter/Space selects the row, ArrowRight expands or moves into
  // children, ArrowLeft collapses. Keeps focus management lightweight — no
  // roving tabindex yet; Tab still walks all rows in order.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select();
      return;
    }
    if (hasChildren && e.key === "ArrowRight" && !isExpanded) {
      e.preventDefault();
      onToggle(node.id, true, e as unknown as React.MouseEvent);
    }
    if (hasChildren && e.key === "ArrowLeft" && isExpanded) {
      e.preventDefault();
      onToggle(node.id, false, e as unknown as React.MouseEvent);
    }
  };

  return (
    <div className={styles.node}>
      <div
        className={isActive ? styles.rowActive : styles.row}
        role="treeitem"
        tabIndex={0}
        aria-selected={isActive}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        <Rail ancestors={ancestors} isLast={isLast} />
        <span className={styles.iconSlot}>
          <BlockAvatar name={label} size={16} />
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {hasChildren && !isExpanded && <span className={styles.count}>{descendantCount}</span>}
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
  const label = agent.name;
  const isSelectedRow = selectedId === agent.id;
  const subtree = useMemo(() => buildSubtree(allAgents, agent.id), [allAgents, agent.id]);
  const descendantCount = subtree ? countDescendants(subtree) : 0;
  const hasChildren = descendantCount > 0;
  const isExpanded = expanded[agent.id] ?? isActive;
  const showChildren = hasChildren && isExpanded;

  const select = () =>
    onSelectAgent({
      id: agent.id,
      name: agent.name,
      model: agent.model,
    });
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select();
      return;
    }
    if (hasChildren && e.key === "ArrowRight" && !isExpanded) {
      e.preventDefault();
      onToggle(agent.id, true, e as unknown as React.MouseEvent);
    }
    if (hasChildren && e.key === "ArrowLeft" && isExpanded) {
      e.preventDefault();
      onToggle(agent.id, false, e as unknown as React.MouseEvent);
    }
  };

  return (
    <div className={styles.node}>
      <div
        className={isSelectedRow ? styles.rowActive : styles.row}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelectedRow}
        aria-expanded={hasChildren ? isExpanded : undefined}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        <span className={styles.iconSlot}>
          <BlockAvatar name={label} size={16} />
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {hasChildren && !isExpanded && <span className={styles.count}>{descendantCount}</span>}
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
 * root expanded to show its subtree. Creating a root company is an
 * exclusively home-page action (/) — this rail is pure navigation.
 * Sub-agents are created from within an agent's Agents tab.
 */
export default function AgentTree() {
  const navigate = useNavigate();
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const allAgents = useDaemonStore((s) => s.agents);
  const activeRoot = useUIStore((s) => s.activeRoot);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { agentId } = useParams<{ agentId?: string }>();
  const selectedId = agentId || null;

  // Context-less routes (/, /profile, /drive) still expand the last-visited
  // root so the tree reads identically everywhere. When there's no last root,
  // the first root auto-expands — collapsed guessing games are worse than a
  // consistent default.
  const activeRootId = useMemo(() => {
    if (agentId) return findRootId(allAgents, agentId);
    if (activeRoot && allAgents.some((a) => a.id === activeRoot)) return activeRoot;
    return allAgents.find((a) => !a.parent_id)?.id || null;
  }, [agentId, activeRoot, allAgents]);

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
      <div className={styles.list} role="tree" aria-label="Agent tree">
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
