import { describe, expect, it } from "vitest";
import type { Quest } from "@/lib/types";
import {
  childCountsByParent,
  isDirectChildOf,
  isRootQuest,
  questAncestors,
  questParentId,
} from "@/components/quests/agentQuestsHelpers";

function quest(id: string, name = id): Quest {
  return {
    id,
    idea_id: `idea-${id}`,
    idea: { id: `idea-${id}`, name, content: "", tags: [] },
    status: "todo",
    priority: "normal",
    cost_usd: 0,
    created_at: "2026-05-19T00:00:00Z",
  };
}

describe("quest hierarchy helpers", () => {
  it("derives parent ids from hierarchical quest ids", () => {
    expect(questParentId("ja-018")).toBeNull();
    expect(questParentId("ja-018.2")).toBe("ja-018");
    expect(questParentId("ja-018.2.3")).toBe("ja-018.2");
  });

  it("classifies roots and direct children", () => {
    const root = quest("ja-018");
    const child = quest("ja-018.1");
    const grandchild = quest("ja-018.1.1");

    expect(isRootQuest(root)).toBe(true);
    expect(isRootQuest(child)).toBe(false);
    expect(isDirectChildOf(root, null)).toBe(true);
    expect(isDirectChildOf(child, root.id)).toBe(true);
    expect(isDirectChildOf(grandchild, root.id)).toBe(false);
  });

  it("counts direct children and builds visible breadcrumbs", () => {
    const quests = [
      quest("ja-018", "Quest page"),
      quest("ja-018.1", "Board scope"),
      quest("ja-018.2", "Card count"),
      quest("ja-018.1.1", "Breadcrumb"),
    ];

    const counts = childCountsByParent(quests);
    expect(counts.get("ja-018")).toBe(2);
    expect(counts.get("ja-018.1")).toBe(1);
    expect(questAncestors("ja-018.1.1", quests).map((q) => q.id)).toEqual(["ja-018", "ja-018.1"]);
  });
});
