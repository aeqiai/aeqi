/**
 * useFundingPrimitive — iter-10 functional gap: reads the underlying
 * Unifutures primitive (CommitmentSale / BondingCurve / Exit) that backs
 * an activated FundingRequest, so the DeclaredRoundsList can surface
 * live commit count / proceeds sum / trade count next to the row.
 *
 * Why a separate hook (not folded into `useEquity`): the read is
 * row-scoped — the operator only cares about the ledger once they've
 * clicked into a specific declared round. Eager-fetching every
 * activated primitive on page-load would inflate the cold-load fan-out
 * for surfaces the operator never opens.
 *
 * RQ key: `["equity", "fundingPrimitive", company, kind, primitiveIdHex]`.
 * `enabled` only flips on when the FundingRequest is activated
 * (status === 1) and `primitive_id` is non-zero — both signals that the
 * platform-side activation has settled and the on-chain account exists.
 *
 * Returns `null` when the primitive isn't readable yet (typical for
 * stub clusters where activation is still mocked). The consumer renders
 * "ledger not visible yet" rather than crashing.
 */
import { useQuery } from "@tanstack/react-query";

import { readFundingPrimitive, type FundingPrimitive } from "@/solana";

export interface UseFundingPrimitiveResult {
  primitive: FundingPrimitive | null;
  isLoading: boolean;
  error: Error | null;
}

export function useFundingPrimitive(
  companyAddress: string | null | undefined,
  kind: number | null | undefined,
  primitiveIdHex: string | null | undefined,
  enabled = true,
): UseFundingPrimitiveResult {
  const idIsZero =
    !primitiveIdHex ||
    primitiveIdHex.replace(/^0x/, "").length === 0 ||
    /^0+$/.test(primitiveIdHex.replace(/^0x/, ""));

  const queryEnabled =
    enabled && !!companyAddress && (kind === 0 || kind === 1 || kind === 2) && !idIsZero;

  const query = useQuery({
    queryKey: [
      "equity",
      "fundingPrimitive",
      companyAddress ?? null,
      kind ?? null,
      primitiveIdHex ?? null,
    ],
    queryFn: () => {
      // queryEnabled gates execution; the type-narrowing below keeps TS happy.
      const idHex = (primitiveIdHex ?? "").replace(/^0x/, "");
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        const slice = idHex.slice(i * 2, i * 2 + 2);
        bytes[i] = slice.length === 2 ? parseInt(slice, 16) : 0;
      }
      return readFundingPrimitive(companyAddress as string, kind as number, bytes);
    },
    enabled: queryEnabled,
    // Keep the read warm but not noisy. Operator-scale "did the commit
    // count tick up since I last looked?" reads — 15s stale is fine.
    staleTime: 15_000,
  });

  return {
    primitive: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  };
}
