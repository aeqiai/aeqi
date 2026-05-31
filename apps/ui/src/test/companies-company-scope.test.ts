import { afterEach, describe, expect, it, vi } from "vitest";
import { getCompaniesRaw, listCompanyRoots } from "@/api/companies";
import { api } from "@/lib/api";

describe("companies API scoping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("does not scope the company list while resolving a company-address route", async () => {
    window.history.replaceState({}, "", "/company/company-address/agents");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ companies: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await listCompanyRoots();
    await getCompaniesRaw();
    await api.getCompanies();
    await api.getEntities();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(init.headers).not.toMatchObject({
        "X-Company": expect.any(String),
        "X-Entity": expect.any(String),
      });
    }
  });
});
