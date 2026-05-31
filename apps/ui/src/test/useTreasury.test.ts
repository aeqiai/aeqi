import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// ── Module mock for indexer ───────────────────────────────────────────────────
// The new useTreasury hook calls the indexer directly via fetch (no indexer
// lib helpers). We only need indexerEnabled() to stay truthy in tests.

vi.mock("@/lib/indexer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/indexer")>("@/lib/indexer");
  return {
    ...actual,
    indexerEnabled: () => true,
  };
});

import { useTreasury } from "@/hooks/useTreasury";

const COMPANY_ID = "0x59bc9fd3956a4104aaf883253fde840c00000000000000000000000000000000";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stub fetch to return the given GraphQL response body. */
function stubFetch(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useTreasury", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: both queries return empty arrays — field present but no data.
    stubFetch({
      data: { treasuryBalances: [], treasuryTransfers: [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns loading=true initially", () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useTreasury(COMPANY_ID));
    expect(result.current.loading).toBe(true);
    expect(result.current.balances).toBeNull();
    expect(result.current.transfers).toBeNull();
    unmount();
  });

  it("resolves to empty arrays when indexer returns no data", async () => {
    // Each fetch call only returns one query result. Mock both calls.
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { treasuryBalances: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { treasuryTransfers: [] } }),
      });

    const { result } = renderHook(() => useTreasury(COMPANY_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.transfers).toEqual([]);
  });

  it("returns [] when companyId is undefined", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const { result } = renderHook(() => useTreasury(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.transfers).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps treasury balances into TokenBalance rows", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            treasuryBalances: [
              {
                tokenAddress: "0xc26adf1e8385689ca692c9a69e8d205877be339a",
                balance: "0xde0b6b3a7640000", // 1 ETH in wei
                lastUpdatedBlock: 100,
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { treasuryTransfers: [] } }),
      });

    const { result } = renderHook(() => useTreasury(COMPANY_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toHaveLength(1);
    expect(result.current.balances![0].tokenAddress).toBe(
      "0xc26adf1e8385689ca692c9a69e8d205877be339a",
    );
    // Unknown tokens fall back to a truncated address (registry miss).
    expect(result.current.balances![0].symbol).toBe("0xc26a…");
    expect(result.current.balances![0].amount).toMatch(/1\.0000/);
    expect(result.current.balances![0].lastUpdatedBlock).toBe(100);
  });

  it("degrades gracefully when treasuryBalances field is not found", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errors: [{ message: "Cannot query field 'treasuryBalances'" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { treasuryTransfers: [] } }),
      });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useTreasury(COMPANY_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    warnSpy.mockRestore();
  });

  it("degrades gracefully when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useTreasury(COMPANY_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.transfers).toEqual([]);
  });

  it("resets to loading when companyId changes", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { treasuryBalances: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { treasuryTransfers: [] } }) })
      .mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(({ id }: { id: string }) => useTreasury(id), {
      initialProps: { id: COMPANY_ID },
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Change the id — should reset immediately.
    act(() => {
      rerender({ id: "0xnewtrustid" });
    });
    expect(result.current.loading).toBe(true);
  });
});
