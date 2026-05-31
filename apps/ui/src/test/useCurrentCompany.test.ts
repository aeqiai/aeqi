import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { createElement } from "react";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { useDaemonStore } from "@/store/daemon";
import type { Company } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ENTITY_ID = "ent-abc-123";
const COMPANY_ADDR = "6PHMM72UqfhgQuUvzDTU2KF9JZvBCCC4aJoKzVe2rKb2";

const ENTITY: Company = {
  id: ENTITY_ID,
  name: "Acme Corp",
  type: "company",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  company_address: COMPANY_ADDR,
};

const PENDING_ENTITY: Company = {
  id: "ent-pending-456",
  name: "Pending Corp",
  type: "company",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  // no company_address
};

// ── Helpers ────────────────────────────────────────────────────────────────

function seedEntities(entities: Company[]) {
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

  it("resolves entity by company_address on /company/ route", () => {
    const { result } = renderWithRoute(
      `/company/${COMPANY_ADDR}/overview`,
      "/company/:companyAddress/:tab",
    );
    expect(result.current.entity).toEqual(ENTITY);
    expect(result.current.companyId).toBe(ENTITY_ID);
  });

  it("resolves entity by id when /company/:companyAddress slug is actually the entity id (unbridged placement)", () => {
    // Bug repro: switcher minted `/company/<entity.id>` for a placement
    // that had no on-chain `company_address`. Pre-fix, the company_address-only
    // lookup returned null and AppLayout bounced the user to "/" via the
    // `!entityKnown` redirect, making the click look broken.
    const { result } = renderWithRoute(
      `/company/${PENDING_ENTITY.id}/overview`,
      "/company/:companyAddress/:tab",
    );
    expect(result.current.entity).toEqual(PENDING_ENTITY);
    expect(result.current.companyId).toBe(PENDING_ENTITY.id);
  });

  it("returns null entity when company_address does not match any entity", () => {
    const { result } = renderWithRoute(
      "/company/0xunknownaddress/overview",
      "/company/:companyAddress/:tab",
    );
    expect(result.current.entity).toBeNull();
    expect(result.current.companyId).toBe("");
  });

  it("returns null entity and empty id when no params are present", () => {
    const { result } = renderWithRoute("/", "/");
    expect(result.current.entity).toBeNull();
    expect(result.current.companyId).toBe("");
  });

  it("company_address match is case-sensitive", () => {
    const lower = COMPANY_ADDR.toLowerCase();
    const { result } = renderWithRoute(
      `/company/${lower}/overview`,
      "/company/:companyAddress/:tab",
    );
    expect(result.current.entity).toBeNull();
    expect(result.current.companyId).toBe("");
  });
});
