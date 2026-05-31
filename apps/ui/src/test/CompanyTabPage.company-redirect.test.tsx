import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDaemonStore } from "@/store/daemon";
import type { Company } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ENTITY_ID = "ent-abc-123";
const COMPANY_ADDR = "0xdeadbeefcafe0000000000000000000000000001";

const ENTITY_WITH_COMPANY: Company = {
  id: ENTITY_ID,
  name: "Acme Corp",
  type: "company",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  company_address: COMPANY_ADDR,
};

const ENTITY_WITHOUT_COMPANY: Company = {
  id: ENTITY_ID,
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

// ── Tests ─────────────────────────────────────────────────────────────────

describe("CompanyTabPage — company-redirect useEffect", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    seedEntities([ENTITY_WITHOUT_COMPANY]);
  });

  it("does NOT redirect when entity has no company_address", () => {
    seedEntities([ENTITY_WITHOUT_COMPANY]);
    const entity = useDaemonStore.getState().entities[0];
    expect(entity.company_address).toBeUndefined();
  });

  it("entity with company_address has the correct value", () => {
    seedEntities([ENTITY_WITH_COMPANY]);
    const entity = useDaemonStore.getState().entities[0];
    expect(entity.company_address).toBe(COMPANY_ADDR);
  });

  it("company_address is set correctly in store", () => {
    seedEntities([ENTITY_WITH_COMPANY]);
    const entities = useDaemonStore.getState().entities;
    const found = entities.find((e) => e.id === ENTITY_ID);
    expect(found?.company_address).toBe(COMPANY_ADDR);
  });
});
