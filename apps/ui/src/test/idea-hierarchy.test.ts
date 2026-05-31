import { describe, expect, it } from "vitest";
import type { Idea } from "@/lib/types";
import {
  buildIdeaWikiStructure,
  buildWorkspaceTree,
  findCompanyRootIdea,
  isCompanyRootIdea,
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

  it("finds the canonical COMPANY root by properties", () => {
    const root = {
      ...idea("company-root", "Acme"),
      properties: trustRootProperties("company-1"),
    };
    const otherRoot = {
      ...idea("other-root", "Other"),
      properties: trustRootProperties("company-2"),
    };

    expect(isCompanyRootIdea(root)).toBe(true);
    expect(findCompanyRootIdea([otherRoot, root], "company-1")?.id).toBe("company-root");
  });

  it("renders orphan visible ideas under the COMPANY root without mutating the input", () => {
    const root = {
      ...idea("company-root", "Acme"),
      properties: trustRootProperties("company-1"),
    };
    const docs = idea("docs", "Docs", "company-root");
    const orphan = idea("orphan", "Filtered match", "missing-parent");

    const tree = buildWorkspaceTree(root, [root, docs, orphan]);

    expect(tree.idea.id).toBe("company-root");
    expect(tree.children.map((child) => child.idea.id)).toEqual(["docs", "orphan"]);
    expect(orphan.parent_idea_id).toBe("missing-parent");
  });

  it("summarizes wiki structure depth, indexes, and flat root rows", () => {
    const root = {
      ...idea("company-root", "Acme"),
      properties: trustRootProperties("company-1"),
    };
    const docs = idea("docs", "Docs", "company-root");
    const onboarding = idea("onboarding", "Onboarding", "docs");
    const faq = idea("faq", "FAQ", "docs");
    const quests = { ...idea("quests", "Quest notes"), tags: ["quests"] };
    const questLog = { ...idea("quest-log", "Quest log"), tags: ["quests"] };

    const structure = buildIdeaWikiStructure(root, [root, docs, onboarding, faq, quests, questLog]);

    expect(structure.totalIdeas).toBe(5);
    expect(structure.maxDepth).toBe(2);
    expect(structure.indexPages).toBe(1);
    expect(structure.leafPages).toBe(4);
    expect(structure.rootChildren).toBe(3);
    expect(structure.unfiled).toBe(2);
    expect(structure.label).toBe("Emerging wiki");
    expect(structure.clusters).toEqual([{ tag: "quests", count: 2 }]);
  });

  it("calls out a one-level idea pile as a flat wiki", () => {
    const root = {
      ...idea("company-root", "Acme"),
      properties: trustRootProperties("company-1"),
    };

    const structure = buildIdeaWikiStructure(root, [
      root,
      idea("one", "One", "company-root"),
      idea("two", "Two", "company-root"),
    ]);

    expect(structure.maxDepth).toBe(1);
    expect(structure.indexPages).toBe(0);
    expect(structure.label).toBe("Flat wiki");
    expect(structure.tone).toBe("warning");
  });
});
