import type { Idea } from "@/lib/types";

export interface IdeaTreeNode {
  idea: Idea;
  children: IdeaTreeNode[];
}

export interface IdeaTreeRow {
  node: IdeaTreeNode;
  depth: number;
}

export const TRUST_ROOT_KIND = "trust_root";
export const TRUST_ROOT_PROPERTY = "aeqi_trust_root";
export const TRUST_ID_PROPERTY = "aeqi_trust_id";

export function isTrustRootIdea(idea: Pick<Idea, "properties">): boolean {
  const properties = idea.properties ?? {};
  return properties[TRUST_ROOT_PROPERTY] === true || properties.kind === TRUST_ROOT_KIND;
}

export function trustRootProperties(trustId: string): Record<string, unknown> {
  return {
    [TRUST_ROOT_PROPERTY]: true,
    [TRUST_ID_PROPERTY]: trustId,
    kind: TRUST_ROOT_KIND,
  };
}

export function findTrustRootIdea(ideas: Idea[], trustId?: string | null): Idea | null {
  const roots = ideas.filter(isTrustRootIdea);
  if (roots.length === 0) return null;
  if (trustId) {
    const scoped = roots.find((idea) => idea.properties?.[TRUST_ID_PROPERTY] === trustId);
    if (scoped) return scoped;
  }
  return roots[0];
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

export function buildWorkspaceTree(root: Idea, ideas: Idea[]): IdeaTreeNode {
  const visible = ideas.filter((idea) => idea.id !== root.id && !isTrustRootIdea(idea));
  const visibleIds = new Set(visible.map((idea) => idea.id));
  const workspaceIdeas = [
    root,
    ...visible.map((idea) => {
      const parentId = idea.parent_idea_id || null;
      const parentVisible = parentId === root.id || (parentId != null && visibleIds.has(parentId));
      if (parentVisible) return idea;
      return { ...idea, parent_idea_id: root.id };
    }),
  ];
  const [treeRoot] = buildIdeaTree(workspaceIdeas);
  return treeRoot ?? { idea: root, children: [] };
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
