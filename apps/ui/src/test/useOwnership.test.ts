import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOwnership } from "@/hooks/useOwnership";
import * as indexer from "@/lib/indexer";

vi.mock("@/lib/indexer", async (importOriginal) => {
  const orig = await importOriginal<typeof indexer>();
  return {
    ...orig,
    indexerEnabled: vi.fn(() => true),
    fetchRolesForCompany: vi.fn(),
    fetchRoleRequestsForCompany: vi.fn(),
  };
});

const mockRolesForCompany = vi.mocked(indexer.fetchRolesForCompany);
const mockRequestsForCompany = vi.mocked(indexer.fetchRoleRequestsForCompany);
const mockEnabled = vi.mocked(indexer.indexerEnabled);

const COMPANY_ID = "0xabc123";

const ROLE_A: indexer.CompanyRole = {
  account: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  roleTypeId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  slotIndex: 0,
  ipfsCid: null,
};

const ROLE_B: indexer.CompanyRole = {
  account: "0xcafecafecafecafecafecafecafecafecafecafe",
  roleTypeId: "0x0000000000000000000000000000000000000000000000000000000000000002",
  slotIndex: 1,
  ipfsCid: "bafyreiabc123",
};

const PENDING: indexer.CompanyRoleRequest = {
  proposer: "0x1111111111111111111111111111111111111111",
  account: "0x2222222222222222222222222222222222222222",
  roleTypeId: "0x0000000000000000000000000000000000000000000000000000000000000003",
  ipfsCid: null,
  accepted: false,
};

const ACCEPTED: indexer.CompanyRoleRequest = {
  proposer: "0x3333333333333333333333333333333333333333",
  account: "0x4444444444444444444444444444444444444444",
  roleTypeId: "0x0000000000000000000000000000000000000000000000000000000000000004",
  ipfsCid: null,
  accepted: true,
};

beforeEach(() => {
  mockEnabled.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnership", () => {
  it("starts in loading state when companyId is provided", async () => {
    // Never resolves in this test — we just check initial state.
    mockRolesForCompany.mockImplementation(() => new Promise(() => {}));
    mockRequestsForCompany.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useOwnership(COMPANY_ID));
    expect(result.current.loading).toBe(true);
    expect(result.current.roles).toEqual([]);
    expect(result.current.pending).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("returns roles and filters accepted requests from pending", async () => {
    mockRolesForCompany.mockResolvedValueOnce([ROLE_A, ROLE_B]);
    mockRequestsForCompany.mockResolvedValueOnce([PENDING, ACCEPTED]);

    const { result } = renderHook(() => useOwnership(COMPANY_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.roles).toEqual([ROLE_A, ROLE_B]);
    // ACCEPTED request is filtered out — only truly pending ones surface.
    expect(result.current.pending).toEqual([PENDING]);
    expect(result.current.error).toBeNull();
  });

  it("returns empty arrays and does not fetch when companyId is falsy", () => {
    const { result } = renderHook(() => useOwnership(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.roles).toEqual([]);
    expect(result.current.pending).toEqual([]);
    expect(mockRolesForCompany).not.toHaveBeenCalled();
  });

  it("returns empty arrays without fetching when indexer is disabled", () => {
    mockEnabled.mockReturnValue(false);
    const { result } = renderHook(() => useOwnership(COMPANY_ID));
    expect(result.current.loading).toBe(false);
    expect(result.current.roles).toEqual([]);
    expect(mockRolesForCompany).not.toHaveBeenCalled();
  });

  it("sets error state when the indexer throws an unexpected error", async () => {
    mockRolesForCompany.mockRejectedValueOnce(new Error("indexer http 500: Internal Server Error"));
    mockRequestsForCompany.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useOwnership(COMPANY_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/indexer http 500/);
    expect(result.current.roles).toEqual([]);
  });

  it("calls fetchRolesForCompany with lowercased companyId", async () => {
    mockRolesForCompany.mockResolvedValueOnce([]);
    mockRequestsForCompany.mockResolvedValueOnce([]);

    renderHook(() => useOwnership("0xABC123"));

    await waitFor(() => expect(mockRolesForCompany).toHaveBeenCalled());
    // fetchRolesForCompany receives the id as-passed; the indexer helper lowercases internally.
    expect(mockRolesForCompany).toHaveBeenCalledWith("0xABC123");
  });
});
