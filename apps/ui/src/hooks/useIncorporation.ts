/**
 * `useIncorporation` — React Query wrapper around the two on-chain reads
 * the Incorporation surface needs: the Trust account and the list of
 * Module accounts hanging off it.
 *
 * The TRUST PDA address (`trust_address`) is the cache key for both
 * queries. A 30s staleTime matches the cadence at which these accounts
 * actually change (manual operator actions through aeqi-platform —
 * pause/unpause, adopt new module implementation, ACL edits) rather
 * than the every-block churn of token balances.
 */
import { useQuery } from "@tanstack/react-query";

import { readModules, readTrust } from "@/solana";
import type { ModuleAccountWithPda, TrustAccount } from "@/solana";

const STALE_TIME_MS = 30_000;

export interface UseIncorporationResult {
  trust: TrustAccount | null | undefined;
  modules: ModuleAccountWithPda[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Resolve a TRUST's on-chain Incorporation state.
 *
 * Pass the base58-encoded Trust PDA (matches `entity.trust_address` on
 * the platform-side Trust record). When `trustAddress` is null/empty
 * the queries stay disabled — useful for the pre-bridge state where
 * the entity has no on-chain mirror yet.
 */
export function useIncorporation(trustAddress: string | null | undefined): UseIncorporationResult {
  const enabled = !!trustAddress;

  const trustQuery = useQuery({
    queryKey: ["incorporation", "trust", trustAddress ?? null],
    queryFn: () => readTrust(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const modulesQuery = useQuery({
    queryKey: ["incorporation", "modules", trustAddress ?? null],
    queryFn: () => readModules(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return {
    trust: trustQuery.data,
    modules: modulesQuery.data,
    isLoading: enabled && (trustQuery.isLoading || modulesQuery.isLoading),
    error: (trustQuery.error as Error | null) ?? (modulesQuery.error as Error | null) ?? null,
  };
}
