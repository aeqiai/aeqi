import { afterEach, describe, expect, it, vi } from "vitest";
import { getIdeaGraph, listIdeas, storeIdea } from "@/api/ideas";
import { ideaKeys } from "@/queries/keys";

describe("ideas trust scoping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("uses the resolved trust id when the route slug is different", async () => {
    window.history.replaceState({}, "", "/trust/wrong-slug/ideas");
    localStorage.setItem("aeqi_entity", "wrong-slug");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ideas: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listIdeas({ agent_id: "agent-1" }, "correct-trust");
    await storeIdea({ name: "Idea", content: "", agent_id: "agent-1" }, "correct-trust");
    await getIdeaGraph({ limit: 10 }, "correct-trust");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(init.headers).toMatchObject({ "X-Trust": "correct-trust" });
    }
  });

  it("partitions query keys by trust scope", () => {
    expect(ideaKeys.visible("trust-a")).not.toEqual(ideaKeys.visible("trust-b"));
    expect(ideaKeys.byAgent("agent-1", "trust-a")).not.toEqual(
      ideaKeys.byAgent("agent-1", "trust-b"),
    );
  });
});
