import { createElement } from "react";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import type { Trust } from "@/lib/types";

const TRUST_ADDR = "6PHMM72UqfhgQuUvzDTU2KF9JZvBCCC4aJoKzVe2rKb2";
const ENTITY: Trust = {
  id: "ent-1",
  name: "Acme",
  type: "trust",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  trust_address: TRUST_ADDR,
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
          createElement(Route, { path: "/trust/:trustAddress/:tab", element: children }),
        ),
      ),
  });
}

describe("useNav", () => {
  beforeEach(() => {
    useDaemonStore.setState({ entities: [] });
  });

  it("keeps current trust-route detail links inside the trust shell before entities hydrate", () => {
    const { result } = renderUseNav(`/trust/${TRUST_ADDR}/ideas`);

    expect(result.current.trustId).toBe("");
    expect(result.current.entityPath(result.current.trustId, "ideas", "idea-1")).toBe(
      `/trust/${TRUST_ADDR}/ideas/idea-1`,
    );
    expect(result.current.entityPath(result.current.trustId, "quests", "quest-1")).toBe(
      `/trust/${TRUST_ADDR}/quests/quest-1`,
    );
  });

  it("falls back to /trust/<id> instead of /launch when targeting an unresolved entity id", () => {
    const { result } = renderUseNav(`/trust/${TRUST_ADDR}/ideas`);

    expect(result.current.entityPath("ent-pending", "ideas", "idea-1")).toBe(
      "/trust/ent-pending/ideas/idea-1",
    );
  });

  it("uses canonical trust_address when the entity is already hydrated", () => {
    useDaemonStore.setState({ entities: [ENTITY] });
    const { result } = renderUseNav(`/trust/${TRUST_ADDR}/ideas`);

    expect(result.current.trustId).toBe(ENTITY.id);
    expect(result.current.entityPath(ENTITY.id, "ideas", "idea-1")).toBe(
      `/trust/${TRUST_ADDR}/ideas/idea-1`,
    );
  });

  it("resolves trustId when the trust route slug is the entity id", () => {
    useDaemonStore.setState({ entities: [ENTITY] });
    const { result } = renderUseNav(`/trust/${ENTITY.id}/ideas`);

    expect(result.current.trustId).toBe(ENTITY.id);
    expect(result.current.entityPath(result.current.trustId, "ideas", "idea-1")).toBe(
      `/trust/${TRUST_ADDR}/ideas/idea-1`,
    );
  });
});
