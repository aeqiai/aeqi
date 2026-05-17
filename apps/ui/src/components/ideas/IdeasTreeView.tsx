import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import type { Idea } from "@/lib/types";

import "@/styles/ideas-tree.css";

/**
 * Tree view for Ideas — hierarchical two-pane explorer using
 * `parent_idea_id`. Phase 1.5 of ae-002.
 *
 * Notion-shape navigation: every Idea is a node. Nodes with children
 * are expandable. Selecting a node opens its content in the right pane.
 * No separate "folder" kind — the role is played by any Idea with
 * children (per design canon
 * `architecture/kind-taxonomy-and-the-structural-vs-categorical-rule`).
 *
 * Drag-drop reparenting is wired through HTML5 native drag — the
 * shipped infrastructure (memory `architecture_tables_ideas_database`)
 * — but the persistence call is plumbed by the parent via
 * `onReparent(childId, newParentId | null)` so the tree stays
 * presentation-only.
 *
 * Phase 1.5 ships read-only navigation + selection. Drag-drop wiring
 * lives behind the `onReparent` prop; AgentIdeasTab passes a no-op for
 * now and 1.5.1 wires the real PATCH.
 */
export interface IdeasTreeViewProps {
  ideas: Idea[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReparent?: (childId: string, newParentId: string | null) => void;
}

interface TreeNode {
  idea: Idea;
  children: TreeNode[];
}

function buildTree(ideas: Idea[]): TreeNode[] {
  // Group by parent_idea_id so we can walk in O(n).
  const byParent = new Map<string | null, Idea[]>();
  const idSet = new Set(ideas.map((i) => i.id));
  for (const idea of ideas) {
    const parent =
      idea.parent_idea_id && idSet.has(idea.parent_idea_id) ? idea.parent_idea_id : null;
    const arr = byParent.get(parent) ?? [];
    arr.push(idea);
    byParent.set(parent, arr);
  }

  // Sort siblings: kind=goal first (direction surfaces are top-of-tree),
  // then by name. Stable + cheap.
  const sortSiblings = (a: Idea, b: Idea) => {
    const ka = a.kind ?? "note";
    const kb = b.kind ?? "note";
    if (ka === "goal" && kb !== "goal") return -1;
    if (kb === "goal" && ka !== "goal") return 1;
    return (a.name || "").localeCompare(b.name || "");
  };

  const build = (parentId: string | null): TreeNode[] => {
    const siblings = byParent.get(parentId) ?? [];
    return siblings.sort(sortSiblings).map((idea) => ({
      idea,
      children: build(idea.id),
    }));
  };

  return build(null);
}

function kindGlyph(kind: string | undefined): string {
  switch (kind) {
    case "file":
      return "▤";
    case "goal":
      return "◎";
    default:
      return "·";
  }
}

export default function IdeasTreeView({
  ideas,
  selectedId,
  onSelect,
  onReparent,
}: IdeasTreeViewProps) {
  const tree = useMemo(() => buildTree(ideas), [ideas]);
  // Default-expanded set: top level always expanded; descendants collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const n of tree) initial.add(n.idea.id);
    return initial;
  });

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(ideas.map((i) => i.id)));
  }, [ideas]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  if (ideas.length === 0) {
    return (
      <div className="ideas-tree__empty">
        <p>No ideas match the current filter.</p>
      </div>
    );
  }

  return (
    <div className="ideas-tree">
      <div className="ideas-tree__toolbar" role="toolbar" aria-label="Tree controls">
        <Button size="sm" variant="ghost" onClick={expandAll}>
          Expand all
        </Button>
        <Button size="sm" variant="ghost" onClick={collapseAll}>
          Collapse all
        </Button>
      </div>
      <ul className="ideas-tree__root" role="tree">
        {tree.map((node) => (
          <TreeNodeView
            key={node.idea.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            selectedId={selectedId}
            onSelect={onSelect}
            onReparent={onReparent}
          />
        ))}
      </ul>
    </div>
  );
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReparent?: (childId: string, newParentId: string | null) => void;
}

function TreeNodeView({
  node,
  depth,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  onReparent,
}: TreeNodeViewProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.idea.id);
  const isSelected = selectedId === node.idea.id;
  const kind = node.idea.kind ?? "note";

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onReparent) return;
    e.dataTransfer.setData("application/x-aeqi-idea-id", node.idea.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onReparent) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onReparent) return;
    e.preventDefault();
    e.stopPropagation();
    const childId = e.dataTransfer.getData("application/x-aeqi-idea-id");
    if (!childId || childId === node.idea.id) return;
    onReparent(childId, node.idea.id);
  };

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isSelected}
      className={`ideas-tree__node ideas-tree__node--depth-${Math.min(depth, 6)}`}
    >
      <div
        className={`ideas-tree__row${isSelected ? " ideas-tree__row--selected" : ""}`}
        draggable={Boolean(onReparent)}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => onSelect(node.idea.id)}
      >
        <span
          className="ideas-tree__caret"
          aria-hidden
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            onToggle(node.idea.id);
          }}
          data-has-children={hasChildren ? "true" : "false"}
          data-expanded={isExpanded ? "true" : "false"}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span className={`ideas-tree__glyph ideas-tree__glyph--${kind}`} aria-hidden title={kind}>
          {kindGlyph(kind)}
        </span>
        <span className="ideas-tree__name">{node.idea.name || "(untitled)"}</span>
        {hasChildren && (
          <span className="ideas-tree__count" aria-label={`${node.children.length} children`}>
            {node.children.length}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul role="group" className="ideas-tree__children">
          {node.children.map((child) => (
            <TreeNodeView
              key={child.idea.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onReparent={onReparent}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
