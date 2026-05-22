import { describe, expect, it } from "vitest";
import type { Idea } from "@/lib/types";
import {
  buildWorkspaceTree,
  findTrustRootIdea,
  isTrustRootIdea,
  trustRootProperties,
} from "@/components/ideas/ideaTree";
import {
  childCountsByIdeaParent,
  ideaAncestors,
  ideaParentId,
  isDirectIdeaChildOf,
  isRootIdea,
} from "@/components/ideas/types";

function idea(id: string, name = id, parent_idea_id?: string | null): Idea {
  return {
    id,
    name,
    content: "",
    tags: [],
    parent_idea_id,
  };
}

describe("idea hierarchy helpers", () => {
  it("classifies roots and direct folder children", () => {
    const root = idea("root");
    const child = idea("child", "Child", "root");
    const grandchild = idea("grandchild", "Grandchild", "child");
    const knownIds = new Set([root.id, child.id, grandchild.id]);

    expect(ideaParentId(root)).toBeNull();
    expect(ideaParentId(child)).toBe("root");
    expect(isRootIdea(root, knownIds)).toBe(true);
    expect(isRootIdea(child, knownIds)).toBe(false);
    expect(isDirectIdeaChildOf(root, null, knownIds)).toBe(true);
    expect(isDirectIdeaChildOf(child, root.id, knownIds)).toBe(true);
    expect(isDirectIdeaChildOf(grandchild, root.id, knownIds)).toBe(false);
  });

  it("treats missing parents as roots in the visible slice", () => {
    const orphan = idea("orphan", "Orphan", "missing");
    const knownIds = new Set([orphan.id]);

    expect(isRootIdea(orphan, knownIds)).toBe(true);
    expect(isDirectIdeaChildOf(orphan, null, knownIds)).toBe(true);
  });

  it("counts direct children and builds breadcrumbs", () => {
    const ideas = [
      idea("root", "Company workspace"),
      idea("docs", "Docs", "root"),
      idea("decisions", "Decisions", "root"),
      idea("onboarding", "Onboarding", "docs"),
    ];

    const counts = childCountsByIdeaParent(ideas);
    expect(counts.get("root")).toBe(2);
    expect(counts.get("docs")).toBe(1);
    expect(ideaAncestors("onboarding", ideas).map((i) => i.id)).toEqual(["root", "docs"]);
  });

  it("finds the canonical TRUST root by properties", () => {
    const root = {
      ...idea("trust-root", "Acme"),
      properties: trustRootProperties("trust-1"),
    };
    const otherRoot = {
      ...idea("other-root", "Other"),
      properties: trustRootProperties("trust-2"),
    };

    expect(isTrustRootIdea(root)).toBe(true);
    expect(findTrustRootIdea([otherRoot, root], "trust-1")?.id).toBe("trust-root");
  });

  it("renders orphan visible ideas under the TRUST root without mutating the input", () => {
    const root = {
      ...idea("trust-root", "Acme"),
      properties: trustRootProperties("trust-1"),
    };
    const docs = idea("docs", "Docs", "trust-root");
    const orphan = idea("orphan", "Filtered match", "missing-parent");

    const tree = buildWorkspaceTree(root, [root, docs, orphan]);

    expect(tree.idea.id).toBe("trust-root");
    expect(tree.children.map((child) => child.idea.id)).toEqual(["docs", "orphan"]);
    expect(orphan.parent_idea_id).toBe("missing-parent");
  });
});
