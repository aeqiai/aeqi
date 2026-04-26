import { useEffect, useMemo, useRef, useState } from "react";
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
 * RootPicker — workspace-switcher pattern that takes over the tree's
 * sidebar space inline (no overlay/popover). Two states:
 *
 *   closed → picker row at top with switcher icon, descendants tree below
 *   open   → picker row at top with close icon, descendants tree REPLACED
 *            by the full root list + a "New company" CTA at the bottom.
 *            The picker + list + footer read as one bordered card so the
 *            takeover is visually contained.
 *
 * Tree visibility is owned by the AgentTree parent (it hides the subtree
 * while open) — keeps the inline takeover seamless without animating
 * mass node removal.
 */
function SwitchGlyph() {
  // Two arrows pointing in opposite directions — the canonical "swap"
  // affordance. Reads as switch, not as expand-disclosure.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h6l-1.5-1.5M9.5 8h-6l1.5 1.5" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

function RootPicker({
  activeRoot,
  allRoots,
  isRootSelected,
  open,
  onOpenChange,
  onSelectRoot,
  onCreateRoot,
}: {
  activeRoot: Agent;
  allRoots: Agent[];
  /** True when the current route is the root agent itself (not a descendant). */
  isRootSelected: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSelectRoot: (agent: Agent) => void;
  onCreateRoot: () => void;
}) {
  const hasMany = allRoots.length > 1;
  const containerRef = useRef<HTMLDivElement>(null);

  // Active root sits at the top (with check), the rest follow alphabetically.
  const orderedRoots = useMemo(() => {
    return [...allRoots].sort((a, b) => {
      if (a.id === activeRoot.id) return -1;
      if (b.id === activeRoot.id) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allRoots, activeRoot.id]);

  // Esc closes; outside-click closes (so clicking elsewhere in the rail
  // collapses the takeover instead of stranding the user inside it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={containerRef} className={open ? styles.pickerCardOpen : styles.pickerCard}>
      <div className={styles.pickerRow}>
        <button
          type="button"
          className={`${styles.pickerMain} ${isRootSelected ? styles.pickerMainActive : ""}`}
          onClick={() => {
            if (open) onOpenChange(false);
            else onSelectRoot(activeRoot);
          }}
          title={open ? "Close switcher" : `Open ${activeRoot.name}`}
        >
          <span className={styles.iconSlot}>
            <BlockAvatar name={activeRoot.name} size={16} />
          </span>
          <span className={styles.pickerLabel}>{activeRoot.name}</span>
        </button>
        {hasMany ? (
          <button
            type="button"
            className={`${styles.pickerSwitcherBtn} ${open ? styles.pickerSwitcherBtnOpen : ""}`}
            aria-label={open ? "Close switcher" : "Switch root agent"}
            title={open ? "Close switcher" : "Switch root agent"}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              onOpenChange(!open);
            }}
          >
            {open ? <CloseGlyph /> : <SwitchGlyph />}
          </button>
        ) : (
          <span className={styles.pickerChevronSpacer} aria-hidden="true" />
        )}
      </div>

      {open && (
        <>
          <div className={styles.pickerListBody} role="listbox" aria-label="Root agents">
            {orderedRoots.map((r) => {
              const isCurrent = r.id === activeRoot.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className={`${styles.pickerListItem} ${isCurrent ? styles.pickerListItemActive : ""}`}
                  onClick={() => {
                    onSelectRoot(r);
                    onOpenChange(false);
                  }}
                >
                  <span className={styles.pickerListAvatar}>
                    <BlockAvatar name={r.name} size={16} />
                  </span>
                  <span className={styles.pickerListLabel}>{r.name}</span>
                  {isCurrent && (
                    <span className={styles.pickerListCheck} aria-hidden="true">
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                        <path
                          d="M2.5 6.5l2.5 2.5 4.5-5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={styles.pickerFooter}
            onClick={() => {
              onOpenChange(false);
              onCreateRoot();
            }}
          >
            <span className={styles.pickerFooterPlus} aria-hidden="true">
              +
            </span>
            <span>New company</span>
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Agent tree: a single "scope picker" header for the active root, with that
 * root's descendants below. The other roots live behind the switcher chevron
 * on the picker — see RootPicker. Creating a root agent is the +New CTA in
 * the popover (or the home-page Launch CTA); sub-agents are created from
 * within an agent's Agents tab.
 */
export default function AgentTree() {
  const navigate = useNavigate();
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const allAgents = useDaemonStore((s) => s.agents);
  const activeRoot = useUIStore((s) => s.activeRoot);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Picker takeover state — when open, the descendants tree is hidden and
  // the picker card shows the full root list + "New company" CTA in its place.
  const [pickerOpen, setPickerOpen] = useState(false);

  const { agentId } = useParams<{ agentId?: string }>();
  const selectedId = agentId || null;

  // Context-less routes (/, /profile, /drive) still pin the last-visited
  // root so the tree reads identically everywhere. When there's no last
  // root, the first root takes the slot — collapsed guessing games are
  // worse than a consistent default.
  const activeRootId = useMemo(() => {
    if (agentId) return findRootId(allAgents, agentId);
    if (activeRoot && allAgents.some((a) => a.id === activeRoot)) return activeRoot;
    return allAgents.find((a) => !a.parent_id)?.id || null;
  }, [agentId, activeRoot, allAgents]);

  const roots = useMemo(() => allAgents.filter((a) => !a.parent_id), [allAgents]);
  const activeRootAgent = useMemo(
    () => roots.find((r) => r.id === activeRootId) ?? null,
    [roots, activeRootId],
  );
  const activeSubtree = useMemo(
    () => (activeRootAgent ? buildSubtree(allAgents, activeRootAgent.id) : null),
    [allAgents, activeRootAgent],
  );

  const toggleNode = (id: string, next: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [id]: next }));
  };

  const handleSelectAgent = (agent: AgentRef) => {
    setSelectedAgent(agent);
    navigate(`/${encodeURIComponent(agent.id)}`);
  };

  if (roots.length === 0) {
    return (
      <nav className={styles.tree}>
        <div className={styles.empty}>No agents</div>
      </nav>
    );
  }

  return (
    <nav className={styles.tree} role="tree" aria-label="Agent tree">
      {/* Root picker stays pinned at the top — outside the scrolling area
          so long subtrees can scroll without dragging the company-scope
          row off-screen. */}
      {activeRootAgent && (
        <div className={styles.rootSlot}>
          <RootPicker
            activeRoot={activeRootAgent}
            allRoots={roots}
            isRootSelected={selectedId === activeRootAgent.id}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelectRoot={(a) =>
              handleSelectAgent({ id: a.id, name: a.name, model: a.model ?? undefined })
            }
            onCreateRoot={() => navigate("/start")}
          />
        </div>
      )}
      {/* Scrolling children. Hidden while the picker takeover is open so
          the switch experience stays focused. */}
      {!pickerOpen && activeSubtree && (
        <div className={styles.list}>
          {activeSubtree.children.map((child, i) => (
            <AgentNodeView
              key={child.id}
              node={child}
              ancestors={[]}
              isLast={i === activeSubtree.children.length - 1}
              selectedId={selectedId}
              expanded={expanded}
              onSelectAgent={handleSelectAgent}
              onToggle={toggleNode}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
