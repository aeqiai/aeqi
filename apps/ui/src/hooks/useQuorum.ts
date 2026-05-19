/**
 * `useQuorum` — React Query wrapper around the three on-chain reads the
 * Quorum surface needs: registered governance configs, all proposals,
 * and the TRUST's role types (used to label role-mode proposals).
 *
 * The TRUST PDA address (`trust_address`) is the cache key for all
 * three queries. A 30s staleTime matches the cadence at which these
 * accounts actually change (operator-driven `register_config`,
 * proposer-driven `propose`, voter-driven tally updates within a
 * proposal's lifetime) rather than the every-block churn of token
 * balances.
 */
import { useQuery } from "@tanstack/react-query";

import {
  readGovernanceConfigs,
  readProposals,
  readRoleTypes,
  type GovernanceConfigWithPda,
  type ProposalWithPda,
  type RoleTypeWithPda,
} from "@/solana";

const STALE_TIME_MS = 30_000;

export interface UseQuorumResult {
  configs: GovernanceConfigWithPda[] | undefined;
  proposals: ProposalWithPda[] | undefined;
  roleTypes: RoleTypeWithPda[] | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Resolve a TRUST's on-chain Quorum state.
 *
 * Pass the base58-encoded Trust PDA (matches `entity.trust_address` on
 * the platform-side Trust record). When `trustAddress` is null/empty
 * the queries stay disabled — useful for the pre-bridge state where
 * the entity has no on-chain mirror yet.
 *
 * The three queries run in parallel; loading is the OR of all three so
 * the page renders once everything has arrived. Errors from any of the
 * three surface through the same `error` slot — first one wins, which
 * is fine for the read-only v1 since each is an equally-fatal RPC
 * failure.
 */
export function useQuorum(trustAddress: string | null | undefined): UseQuorumResult {
  const enabled = !!trustAddress;

  const configsQuery = useQuery({
    queryKey: ["quorum", "configs", trustAddress ?? null],
    queryFn: () => readGovernanceConfigs(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const proposalsQuery = useQuery({
    queryKey: ["quorum", "proposals", trustAddress ?? null],
    queryFn: () => readProposals(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const roleTypesQuery = useQuery({
    queryKey: ["quorum", "roleTypes", trustAddress ?? null],
    queryFn: () => readRoleTypes(trustAddress as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return {
    configs: configsQuery.data,
    proposals: proposalsQuery.data,
    roleTypes: roleTypesQuery.data,
    isLoading:
      enabled && (configsQuery.isLoading || proposalsQuery.isLoading || roleTypesQuery.isLoading),
    error:
      (configsQuery.error as Error | null) ??
      (proposalsQuery.error as Error | null) ??
      (roleTypesQuery.error as Error | null) ??
      null,
  };
}
