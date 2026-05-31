import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGovernance } from "@/hooks/useGovernance";
import * as indexer from "@/lib/indexer";

// ── Fixtures ──────────────────────────────────────────────────────────────

const COMPANY = "0xtrustdeadbeef";

const GOV_MODULE = {
  companyAddress: COMPANY,
  moduleId: indexer.MODULE_ID.governance,
  moduleAddress: "0xgovmodule",
  moduleAcl: "0x",
  attachedBlock: 42,
};

const PROPOSAL = {
  moduleAddress: "0xgovmodule",
  proposalId: "0xprop1",
  governanceConfigId: "0xgov_config",
  proposerAddress: "0xproposer",
  voteStart: 1000,
  voteEnd: 2000,
  ipfsCid: "QmAbc",
  status: "active",
  createdBlock: 42,
  createdTx: "0xtx1",
  title: "Add new signer",
  forVotes: String(BigInt(100) * BigInt(1e18)),
  againstVotes: String(BigInt(50) * BigInt(1e18)),
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("useGovernance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: indexer is enabled (VITE_INDEXER_URL is undefined → defaults to /indexer/graphql).
    vi.spyOn(indexer, "indexerEnabled").mockReturnValue(true);
  });

  it("returns empty state immediately when companyAddress is undefined", async () => {
    const { result } = renderHook(() => useGovernance(undefined));
    await waitFor(() => {
      expect(result.current.proposals).toEqual([]);
      expect(result.current.hasModule).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  it("returns empty state when indexer is disabled", async () => {
    vi.spyOn(indexer, "indexerEnabled").mockReturnValue(false);
    const { result } = renderHook(() => useGovernance(COMPANY));
    await waitFor(() => {
      expect(result.current.proposals).toEqual([]);
      expect(result.current.hasModule).toBe(false);
    });
  });

  it("returns proposals when governance module exists", async () => {
    vi.spyOn(indexer, "fetchCompanyModules").mockResolvedValue([GOV_MODULE]);
    vi.spyOn(indexer, "fetchProposalsForModule").mockResolvedValue([PROPOSAL]);
    vi.spyOn(indexer, "fetchVotingPower").mockResolvedValue(null);

    const { result } = renderHook(() => useGovernance(COMPANY));

    // Initially loading
    expect(result.current.proposals).toBeNull();

    await waitFor(() => {
      expect(result.current.proposals).toHaveLength(1);
      expect(result.current.proposals![0].title).toBe("Add new signer");
      expect(result.current.hasModule).toBe(true);
    });
  });

  it("returns empty proposals and hasModule=false when no governance module", async () => {
    vi.spyOn(indexer, "fetchCompanyModules").mockResolvedValue([]); // no modules
    const { result } = renderHook(() => useGovernance(COMPANY));

    await waitFor(() => {
      expect(result.current.proposals).toEqual([]);
      expect(result.current.hasModule).toBe(false);
    });
  });

  it("surfaces voting power when accountAddress is provided", async () => {
    const VP = { moduleAddress: "0xgovmodule", accountAddress: "0xuser", votingPower: "1000" };
    vi.spyOn(indexer, "fetchCompanyModules").mockResolvedValue([GOV_MODULE]);
    vi.spyOn(indexer, "fetchProposalsForModule").mockResolvedValue([]);
    vi.spyOn(indexer, "fetchVotingPower").mockResolvedValue(VP);

    const { result } = renderHook(() => useGovernance(COMPANY, "0xuser"));

    await waitFor(() => {
      expect(result.current.votingPower).toEqual(VP);
    });
  });

  it("gracefully degrades to null votingPower when indexer throws", async () => {
    vi.spyOn(indexer, "fetchCompanyModules").mockResolvedValue([GOV_MODULE]);
    vi.spyOn(indexer, "fetchProposalsForModule").mockResolvedValue([]);
    // fetchVotingPower itself catches and returns null (schema-missing case).
    vi.spyOn(indexer, "fetchVotingPower").mockResolvedValue(null);

    const { result } = renderHook(() => useGovernance(COMPANY, "0xuser"));

    await waitFor(() => {
      expect(result.current.votingPower).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  it("sets error state on network failure", async () => {
    vi.spyOn(indexer, "fetchCompanyModules").mockRejectedValue(new Error("network failure"));

    const { result } = renderHook(() => useGovernance(COMPANY));

    await waitFor(() => {
      expect(result.current.error).toBe("network failure");
      // proposals stays null to distinguish errored from empty.
      expect(result.current.proposals).toBeNull();
    });
  });

  it("re-fetches when companyAddress changes", async () => {
    vi.spyOn(indexer, "fetchCompanyModules").mockResolvedValue([]);

    const { result, rerender } = renderHook(({ addr }) => useGovernance(addr), {
      initialProps: { addr: COMPANY as string | undefined },
    });

    await waitFor(() => expect(result.current.proposals).toEqual([]));

    // Change to undefined — should reset to empty immediately.
    act(() => {
      rerender({ addr: undefined });
    });

    await waitFor(() => {
      expect(result.current.proposals).toEqual([]);
      expect(result.current.hasModule).toBe(false);
    });
  });
});
