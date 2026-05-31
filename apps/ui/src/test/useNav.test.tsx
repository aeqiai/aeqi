import { createElement } from "react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import type { Company } from "@/lib/types";

const COMPANY_ADDR = "6PHMM72UqfhgQuUvzDTU2KF9JZvBCCC4aJoKzVe2rKb2";
const ENTITY: Company = {
  id: "ent-1",
  name: "Acme",
  type: "company",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  company_address: COMPANY_ADDR,
};

function renderUseNav(path: string) {
  return renderHook(() => useNav(), {
    wrapper: ({ children }) =>
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/company/:companyAddress/:tab", element: children }),
        ),
      ),
  });
}

describe("useNav", () => {
  beforeEach(() => {
    useDaemonStore.setState({ entities: [] });
  });

  it("keeps current company-route detail links inside the company shell before entities hydrate", () => {
    const { result } = renderUseNav(`/company/${COMPANY_ADDR}/ideas`);

    expect(result.current.companyId).toBe("");
    expect(result.current.entityPath(result.current.companyId, "ideas", "idea-1")).toBe(
      `/company/${COMPANY_ADDR}/ideas/idea-1`,
    );
    expect(result.current.entityPath(result.current.companyId, "quests", "quest-1")).toBe(
      `/company/${COMPANY_ADDR}/quests/quest-1`,
    );
  });

  it("falls back to /company/<id> instead of /launch when targeting an unresolved entity id", () => {
    const { result } = renderUseNav(`/company/${COMPANY_ADDR}/ideas`);

    expect(result.current.entityPath("ent-pending", "ideas", "idea-1")).toBe(
      "/company/ent-pending/ideas/idea-1",
    );
  });

  it("uses canonical company_address when the entity is already hydrated", () => {
    useDaemonStore.setState({ entities: [ENTITY] });
    const { result } = renderUseNav(`/company/${COMPANY_ADDR}/ideas`);

    expect(result.current.companyId).toBe(ENTITY.id);
    expect(result.current.entityPath(ENTITY.id, "ideas", "idea-1")).toBe(
      `/company/${COMPANY_ADDR}/ideas/idea-1`,
    );
  });

  it("resolves companyId when the company route slug is the entity id", () => {
    useDaemonStore.setState({ entities: [ENTITY] });
    const { result } = renderUseNav(`/company/${ENTITY.id}/ideas`);

    expect(result.current.companyId).toBe(ENTITY.id);
    expect(result.current.entityPath(result.current.companyId, "ideas", "idea-1")).toBe(
      `/company/${COMPANY_ADDR}/ideas/idea-1`,
    );
  });
});
