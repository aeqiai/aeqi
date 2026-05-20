import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { createElement } from "react";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { useDaemonStore } from "@/store/daemon";
import type { Trust } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ENTITY_ID = "ent-abc-123";
const TRUST_ADDR = "6PHMM72UqfhgQuUvzDTU2KF9JZvBCCC4aJoKzVe2rKb2";

const ENTITY: Trust = {
  id: ENTITY_ID,
  name: "Acme Corp",
  type: "trust",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  trust_address: TRUST_ADDR,
};

const PENDING_ENTITY: Trust = {
  id: "ent-pending-456",
  name: "Pending Corp",
  type: "trust",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  // no trust_address
};

// ── Helpers ────────────────────────────────────────────────────────────────

function seedEntities(entities: Trust[]) {
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
    expect(result.current.trustId).toBe(ENTITY_ID);
  });

  it("resolves entity by id when /trust/:trustAddress slug is actually the entity id (unbridged placement)", () => {
    // Bug repro: switcher minted `/trust/<entity.id>` for a placement
    // that had no on-chain `trust_address`. Pre-fix, the trust_address-only
    // lookup returned null and AppLayout bounced the user to "/" via the
    // `!entityKnown` redirect, making the click look broken.
    const { result } = renderWithRoute(
      `/trust/${PENDING_ENTITY.id}/overview`,
      "/trust/:trustAddress/:tab",
    );
    expect(result.current.entity).toEqual(PENDING_ENTITY);
    expect(result.current.trustId).toBe(PENDING_ENTITY.id);
  });

  it("returns null entity when trust_address does not match any entity", () => {
    const { result } = renderWithRoute(
      "/trust/0xunknownaddress/overview",
      "/trust/:trustAddress/:tab",
    );
    expect(result.current.entity).toBeNull();
    expect(result.current.trustId).toBe("");
  });

  it("returns null entity and empty id when no params are present", () => {
    const { result } = renderWithRoute("/", "/");
    expect(result.current.entity).toBeNull();
    expect(result.current.trustId).toBe("");
  });

  it("trust_address match is case-sensitive", () => {
    const lower = TRUST_ADDR.toLowerCase();
    const { result } = renderWithRoute(`/trust/${lower}/overview`, "/trust/:trustAddress/:tab");
    expect(result.current.entity).toBeNull();
    expect(result.current.trustId).toBe("");
  });
});
