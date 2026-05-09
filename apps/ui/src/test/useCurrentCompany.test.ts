import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { createElement } from "react";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { useDaemonStore } from "@/store/daemon";
import type { Entity } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ENTITY_ID = "ent-abc-123";
const TRUST_ADDR = "6PHMM72UqfhgQuUvzDTU2KF9JZvBCCC4aJoKzVe2rKb2";

const ENTITY: Entity = {
  id: ENTITY_ID,
  name: "Acme Corp",
  type: "company",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  trust_address: TRUST_ADDR,
};

const PENDING_ENTITY: Entity = {
  id: "ent-pending-456",
  name: "Pending Corp",
  type: "company",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  // no trust_address
};

// ── Helpers ────────────────────────────────────────────────────────────────

function seedEntities(entities: Entity[]) {
  useDaemonStore.setState({ entities });
}

/** Render useCurrentCompany inside a MemoryRouter at a given path. */
function renderWithRoute(path: string, routePattern: string) {
  return renderHook(() => useCurrentCompany(), {
    wrapper: ({ children }) =>
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: routePattern, element: children }),
        ),
      ),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("useCurrentCompany", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    seedEntities([ENTITY, PENDING_ENTITY]);
  });

  it("resolves entity by trust_address on /trust/ route", () => {
    const { result } = renderWithRoute(
      `/trust/${TRUST_ADDR}/overview`,
      "/trust/:trustAddress/:tab",
    );
    expect(result.current.entity).toEqual(ENTITY);
    expect(result.current.entityId).toBe(ENTITY_ID);
  });

  it("resolves entity by id on /c/ route", () => {
    const { result } = renderWithRoute(`/c/${ENTITY_ID}/overview`, "/c/:entityId/:tab");
    expect(result.current.entity).toEqual(ENTITY);
    expect(result.current.entityId).toBe(ENTITY_ID);
  });

  it("resolves pending entity (no trust_address) by id on /c/ route", () => {
    const { result } = renderWithRoute(`/c/${PENDING_ENTITY.id}/overview`, "/c/:entityId/:tab");
    expect(result.current.entity).toEqual(PENDING_ENTITY);
    expect(result.current.entityId).toBe(PENDING_ENTITY.id);
  });

  it("returns null entity when trust_address does not match any entity", () => {
    const { result } = renderWithRoute(
      "/trust/0xunknownaddress/overview",
      "/trust/:trustAddress/:tab",
    );
    expect(result.current.entity).toBeNull();
    expect(result.current.entityId).toBe("");
  });

  it("returns null entity and empty id when no params are present", () => {
    const { result } = renderWithRoute("/", "/");
    expect(result.current.entity).toBeNull();
    expect(result.current.entityId).toBe("");
  });

  it("trust_address match is case-sensitive", () => {
    const lower = TRUST_ADDR.toLowerCase();
    const { result } = renderWithRoute(`/trust/${lower}/overview`, "/trust/:trustAddress/:tab");
    expect(result.current.entity).toBeNull();
    expect(result.current.entityId).toBe("");
  });
});
