import { afterEach, describe, expect, it, vi } from "vitest";
import { getIdeaGraph, listIdeas, setIdeaProperties, storeIdea } from "@/api/ideas";
import { invalidateIdeaQueriesForScope } from "@/queries/ideas";
import { ideaKeys } from "@/queries/keys";

describe("ideas company scoping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("uses the resolved company id when the route slug is different", async () => {
    window.history.replaceState({}, "", "/company/wrong-slug/ideas");
    localStorage.setItem("aeqi_entity", "wrong-slug");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ideas: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listIdeas({ agent_id: "agent-1" }, "correct-company");
    await storeIdea({ name: "Idea", content: "", agent_id: "agent-1" }, "correct-company");
    await getIdeaGraph({ limit: 10 }, "correct-company");
    await setIdeaProperties("idea-1", { status: "done" }, "correct-company");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(init.headers).toMatchObject({
        "X-Company": "correct-company",
        "X-Entity": "correct-company",
        "X-Trust": "correct-company",
      });
    }
  });

  it("partitions query keys by company scope", () => {
    expect(ideaKeys.visible("company-a")).not.toEqual(ideaKeys.visible("company-b"));
    expect(ideaKeys.byAgent("agent-1", "company-a")).not.toEqual(
      ideaKeys.byAgent("agent-1", "company-b"),
    );
  });

  it("only invalidates idea queries in the matching company scope", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as Parameters<
      typeof invalidateIdeaQueriesForScope
    >[0];

    await invalidateIdeaQueriesForScope(queryClient, "company-a");

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const call = invalidateQueries.mock.calls[0]?.[0] as
      | { predicate?: (query: { queryKey: readonly unknown[] }) => boolean }
      | undefined;
    expect(call?.predicate?.({ queryKey: ["ideas", "visible", "company-a"] })).toBe(true);
    expect(call?.predicate?.({ queryKey: ["ideas", "agent", "agent-1", "company-a"] })).toBe(true);
    expect(call?.predicate?.({ queryKey: ["ideas", "visible", "company-b"] })).toBe(false);
    expect(call?.predicate?.({ queryKey: ["other", "visible", "company-a"] })).toBe(false);
  });
});
