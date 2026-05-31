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

  it("uses the route company scope while resolving a company-address route", async () => {
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
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe("/api/trusts");
      expect(init.headers).toMatchObject({
        "X-Company": "company-address",
        "X-Entity": "company-address",
        "X-Trust": "company-address",
      });
    }
  });

  it("bridges runtime status to the hosted trust query parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, has_runtime: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getRuntimeStatus("company-1");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/runtime/status?trust_id=company-1");
  });
});
