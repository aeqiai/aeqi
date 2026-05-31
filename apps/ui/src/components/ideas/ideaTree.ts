import type { Idea } from "@/lib/types";

export interface IdeaTreeNode {
  idea: Idea;
  children: IdeaTreeNode[];
}

export interface IdeaTreeRow {
  node: IdeaTreeNode;
  depth: number;
}

export interface IdeaWikiCluster {
  tag: string;
  count: number;
}

export interface IdeaWikiStructure {
  totalIdeas: number;
  rootChildren: number;
  indexPages: number;
  leafPages: number;
  maxDepth: number;
  unfiled: number;
  label: "Empty wiki" | "Flat wiki" | "Emerging wiki" | "Layered wiki";
  tone: "neutral" | "warning" | "info" | "success";
  clusters: IdeaWikiCluster[];
}

export const COMPANY_ROOT_KIND = "company_root";
export const COMPANY_ROOT_PROPERTY = "aeqi_company_root";
export const COMPANY_ID_PROPERTY = "aeqi_company_id";

export function isCompanyRootIdea(idea: Pick<Idea, "properties">): boolean {
  const properties = idea.properties ?? {};
  return properties[COMPANY_ROOT_PROPERTY] === true || properties.kind === COMPANY_ROOT_KIND;
}

export function trustRootProperties(companyId: string): Record<string, unknown> {
  return {
    [COMPANY_ROOT_PROPERTY]: true,
    [COMPANY_ID_PROPERTY]: companyId,
    kind: COMPANY_ROOT_KIND,
  };
}

export function findCompanyRootIdea(ideas: Idea[], companyId?: string | null): Idea | null {
  const roots = ideas.filter(isCompanyRootIdea);
  if (roots.length === 0) return null;
  if (companyId) {
    const scoped = roots.find((idea) => idea.properties?.[COMPANY_ID_PROPERTY] === companyId);
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
  const visible = ideas.filter((idea) => idea.id !== root.id && !isCompanyRootIdea(idea));
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

export function buildIdeaWikiStructure(root: Idea, ideas: Idea[]): IdeaWikiStructure {
  const visible = ideas.filter((idea) => idea.id !== root.id && !isCompanyRootIdea(idea));
  const visibleIds = new Set(visible.map((idea) => idea.id));
  const tree = buildWorkspaceTree(root, ideas);
  let maxDepth = 0;
  let indexPages = 0;
  let leafPages = 0;

  const walk = (node: IdeaTreeNode, depth: number) => {
    if (node.idea.id !== root.id) {
      maxDepth = Math.max(maxDepth, depth);
      if (node.children.length > 0) indexPages += 1;
      else leafPages += 1;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(tree, 0);

  const unfiled = visible.filter((idea) => {
    const parentId = idea.parent_idea_id || null;
    return parentId == null || (parentId !== root.id && !visibleIds.has(parentId));
  }).length;

  const tagCounts = new Map<string, number>();
  for (const child of tree.children) {
    if (child.children.length > 0) continue;
    for (const tag of child.idea.tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized) continue;
      tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
    }
  }

  const clusters = [...tagCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([tag, count]) => ({ tag, count }));

  const totalIdeas = visible.length;
  const label =
    totalIdeas === 0
      ? "Empty wiki"
      : maxDepth <= 1
        ? "Flat wiki"
        : maxDepth <= 2 || indexPages < 3
          ? "Emerging wiki"
          : "Layered wiki";
  const tone =
    label === "Layered wiki"
      ? "success"
      : label === "Emerging wiki"
        ? "info"
        : label === "Flat wiki"
          ? "warning"
          : "neutral";

  return {
    totalIdeas,
    rootChildren: tree.children.length,
    indexPages,
    leafPages,
    maxDepth,
    unfiled,
    label,
    tone,
    clusters,
  };
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
