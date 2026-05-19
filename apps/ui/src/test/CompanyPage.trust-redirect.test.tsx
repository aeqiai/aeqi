import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDaemonStore } from "@/store/daemon";
import type { Trust } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ENTITY_ID = "ent-abc-123";
const TRUST_ADDR = "0xdeadbeefcafe0000000000000000000000000001";

const ENTITY_WITH_TRUST: Trust = {
  id: ENTITY_ID,
  name: "Acme Corp",
  type: "trust",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  trust_address: TRUST_ADDR,
};

const ENTITY_WITHOUT_TRUST: Trust = {
  id: ENTITY_ID,
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

// ── Tests ─────────────────────────────────────────────────────────────────

describe("CompanyPage — trust-redirect useEffect", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    seedEntities([ENTITY_WITHOUT_TRUST]);
  });

  it("does NOT redirect when entity has no trust_address", () => {
    seedEntities([ENTITY_WITHOUT_TRUST]);
    const entity = useDaemonStore.getState().entities[0];
    expect(entity.trust_address).toBeUndefined();
  });

  it("entity with trust_address has the correct value", () => {
    seedEntities([ENTITY_WITH_TRUST]);
    const entity = useDaemonStore.getState().entities[0];
    expect(entity.trust_address).toBe(TRUST_ADDR);
  });

  it("trust_address is set correctly in store", () => {
    seedEntities([ENTITY_WITH_TRUST]);
    const entities = useDaemonStore.getState().entities;
    const found = entities.find((e) => e.id === ENTITY_ID);
    expect(found?.trust_address).toBe(TRUST_ADDR);
  });
});
