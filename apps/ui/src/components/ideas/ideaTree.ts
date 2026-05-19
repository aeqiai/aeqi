import type { Idea } from "@/lib/types";

export interface IdeaTreeNode {
  idea: Idea;
  children: IdeaTreeNode[];
}

export interface IdeaTreeRow {
  node: IdeaTreeNode;
  depth: number;
}

export function buildIdeaTree(ideas: Idea[]): IdeaTreeNode[] {
  const byParent = new Map<string | null, Idea[]>();
  const idSet = new Set(ideas.map((idea) => idea.id));
  const order = new Map(ideas.map((idea, index) => [idea.id, index]));

  for (const idea of ideas) {
    const parent =
      idea.parent_idea_id && idSet.has(idea.parent_idea_id) ? idea.parent_idea_id : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(idea);
    byParent.set(parent, siblings);
  }

  const sortByCurrentOrder = (a: Idea, b: Idea) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const build = (parentId: string | null): IdeaTreeNode[] =>
    (byParent.get(parentId) ?? []).sort(sortByCurrentOrder).map((idea) => ({
      idea,
      children: build(idea.id),
    }));

  return build(null);
}

export function flattenIdeaTree(
  nodes: IdeaTreeNode[],
  expanded: Record<string, boolean>,
  depth = 0,
): IdeaTreeRow[] {
  const rows: IdeaTreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    const defaultExpanded = depth === 0;
    const isExpanded = expanded[node.idea.id] ?? defaultExpanded;
    if (node.children.length > 0 && isExpanded) {
      rows.push(...flattenIdeaTree(node.children, expanded, depth + 1));
    }
  }
  return rows;
}
