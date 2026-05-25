import { describe, expect, it } from "vitest";
import type { Quest } from "@/lib/types";
import {
  rankQuestDiscovery,
  summarizeQuestDiscoveryReasons,
} from "@/components/quests/agentQuestsHelpers";

function quest(id: string, name: string, content = "", overrides: Partial<Quest> = {}): Quest {
  return {
    id,
    idea_id: `idea-${id}`,
    idea: { id: `idea-${id}`, name, content, tags: [] },
    status: "todo",
    priority: "normal",
    cost_usd: 0,
    created_at: "2026-05-25T00:00:00Z",
    updated_at: "2026-05-25T00:00:00Z",
    ...overrides,
  };
}

describe("quest discovery ranking", () => {
  it("boosts related quests when the parent, dependency, or sibling matches", () => {
    const root = quest("q-1", "Launch plan", "Ship the workspace release");
    const child = quest("q-1.1", "Board polish", "Fix search spacing and chips");
    const dependency = quest("q-2", "Spacing fix", "Tighten the card chrome", {
      sibling_quest_ids: ["q-4"],
    });
    const dependent = quest("q-3", "Release polish", "", { depends_on: ["q-2"] });
    const sibling = quest("q-4", "Shared spec cleanup", "", { sibling_quest_ids: ["q-1"] });

    const hits = rankQuestDiscovery([root, child, dependency, dependent, sibling], "spacing");

    expect(hits.some((hit) => hit.quest.id === "q-2")).toBe(true);
    expect(hits.find((hit) => hit.quest.id === "q-1")?.reasons).toContain("child");
    expect(hits.find((hit) => hit.quest.id === "q-3")?.reasons).toContain("dependency");
    expect(hits.find((hit) => hit.quest.id === "q-4")?.reasons).toContain("shared spec");
  });

  it("summarizes multiple discovery reasons compactly", () => {
    expect(summarizeQuestDiscoveryReasons(["title"])).toBe("title");
    expect(summarizeQuestDiscoveryReasons(["title", "tags", "child"])).toBe("title +2");
  });
});
