import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";

describe("session company scoping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.removeItem("aeqi_entity");
    window.history.replaceState({}, "", "/");
  });

  it("uses an explicit company scope even when the current route slug differs", async () => {
    localStorage.setItem("aeqi_entity", "wrong-company");
    window.history.replaceState({}, "", "/company/wrong-address/agents/agent-1");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session_id: "session-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createSession("agent-1", "correct-company");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "X-Company": "correct-company",
      "X-Entity": "correct-company",
    });
  });
});
