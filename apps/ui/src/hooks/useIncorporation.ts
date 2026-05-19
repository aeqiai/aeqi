/**
 * `useIncorporation` — React Query wrapper around the three on-chain
 * reads the Incorporation surface (and the Overview cockpit rollup) need:
 * the Trust account, the list of Module accounts hanging off it, and the
 * list of Role accounts on `aeqi_role`. Roles are folded in here (rather
 * than into their own hook) because the Overview cockpit's "signers /
 * modules / roles" identity strip wants all three together — the cost
 * is one extra parallel `getProgramAccounts`, and the staleness is the
 * same operator cadence.
 *
 * The TRUST PDA address (`trust_address`) is the cache key for all three
 * queries. A 30s staleTime matches the cadence at which these accounts
 * actually change (manual operator actions through aeqi-platform —
 * pause/unpause, adopt new module implementation, ACL edits, role
 * assign / resign) rather than the every-block churn of token balances.
 *
 * The role scan is soft-failed (try/catch → []) because Foundation-shaped
 * TRUSTs that haven't adopted `aeqi_role` should degrade to "0 roles"
 * instead of surfacing an error in the cockpit header.
 */
import { useQuery } from "@tanstack/react-query";

import { readModules, readRoles, readTrust } from "@/solana";
import type { ModuleAccountWithPda, RoleAccountWithPda, TrustAccount } from "@/solana";

const STALE_TIME_MS = 30_000;

export interface UseIncorporationResult {
  trust: TrustAccount | null | undefined;
  modules: ModuleAccountWithPda[] | undefined;
  roles: RoleAccountWithPda[] | undefined;
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

  const rolesQuery = useQuery({
    queryKey: ["incorporation", "roles", trustAddress ?? null],
    queryFn: async () => {
      try {
        return await readRoles(trustAddress as string);
      } catch {
        // Foundation-shaped TRUSTs without `aeqi_role` adopted should
        // degrade to "0 roles" in the cockpit instead of erroring.
        return [];
      }
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return {
    trust: trustQuery.data,
    modules: modulesQuery.data,
    roles: rolesQuery.data,
    isLoading: enabled && (trustQuery.isLoading || modulesQuery.isLoading || rolesQuery.isLoading),
    error:
      (trustQuery.error as Error | null) ??
      (modulesQuery.error as Error | null) ??
      (rolesQuery.error as Error | null) ??
      null,
  };
}
