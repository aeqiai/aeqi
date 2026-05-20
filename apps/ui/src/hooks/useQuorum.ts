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
  isGovernanceProgramDeployed,
  readAllVoteRecords,
  readGovernanceConfigs,
  readProposals,
  readRoleTypes,
  readRoles,
  type GovernanceConfigWithPda,
  type ProposalWithPda,
  type RoleAccountWithPda,
  type RoleTypeWithPda,
  type VoteRecordWithPda,
} from "@/solana";

const STALE_TIME_MS = 30_000;
// The program-deployed probe rarely changes — once deployed, a program
// stays at that address for the cluster's lifetime. Cache aggressively
// so the surface doesn't fire one `getAccountInfo` per render.
const PROGRAM_PRESENCE_STALE_MS = 5 * 60_000;

export interface UseQuorumResult {
  configs: GovernanceConfigWithPda[] | undefined;
  proposals: ProposalWithPda[] | undefined;
  roleTypes: RoleTypeWithPda[] | undefined;
  /**
   * Occupied role accounts on the TRUST. Used by the proposal action bar
   * to extend the cancel-eligibility check beyond just the TRUST creator
   * EOA — anyone holding an occupied role can also see the Cancel CTA
   * (the on-chain ix still enforces signer constraints, this is the UX
   * gate so non-empty boards aren't locked out of the affordance).
   */
  roles: RoleAccountWithPda[] | undefined;
  /**
   * Every VoteRecord ever cast against this TRUST. Used by the KPI strip
   * to compute "voter turnout" without N round-trips. Soft-failed to
   * `[]` so the KPI tile degrades gracefully on TRUSTs whose vote-record
   * scan times out.
   */
  voteRecords: VoteRecordWithPda[] | undefined;
  /**
   * `true` when the `aeqi_governance` program is deployed on the active
   * cluster. `false` when the cluster is reachable but the program has
   * not been deployed (drives the "program not provisioned" empty
   * state). `undefined` while the probe is in flight.
   */
  programDeployed: boolean | undefined;
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

  // Probe the program first. The other three reads have no point if the
  // program isn't deployed — `getProgramAccounts` against a missing
  // program ID would just return [] anyway, but the empty state is more
  // honest if the surface KNOWS the program is missing rather than
  // implying the TRUST has no configs.
  const programQuery = useQuery({
    queryKey: ["quorum", "programDeployed"],
    queryFn: () => isGovernanceProgramDeployed(),
    enabled,
    staleTime: PROGRAM_PRESENCE_STALE_MS,
  });

  // Once we know the program is missing, gate the heavier reads off so
  // we don't burn RPC churn on a no-op `getProgramAccounts`. When the
  // probe is still loading or returns true, run the reads.
  const programReady = programQuery.data !== false;

  const configsQuery = useQuery({
    queryKey: ["quorum", "configs", trustAddress ?? null],
    queryFn: () => readGovernanceConfigs(trustAddress as string),
    enabled: enabled && programReady,
    staleTime: STALE_TIME_MS,
  });

  const proposalsQuery = useQuery({
    queryKey: ["quorum", "proposals", trustAddress ?? null],
    queryFn: () => readProposals(trustAddress as string),
    enabled: enabled && programReady,
    staleTime: STALE_TIME_MS,
  });

  const roleTypesQuery = useQuery({
    queryKey: ["quorum", "roleTypes", trustAddress ?? null],
    queryFn: () => readRoleTypes(trustAddress as string),
    enabled: enabled && programReady,
    staleTime: STALE_TIME_MS,
  });

  // Roles + all vote-records are auxiliary reads. Both are soft-failed
  // because a TRUST that hasn't adopted `aeqi_role` or has never opened a
  // proposal would otherwise throw on a missing program / empty scan and
  // poison the whole `error` slot. They're not gating the page load —
  // missing data just means the KPI tile shows "—" and the cancel CTA
  // falls back to its prior (proposer-only) behaviour.
  const rolesQuery = useQuery({
    queryKey: ["quorum", "roles", trustAddress ?? null],
    queryFn: async () => {
      try {
        return await readRoles(trustAddress as string);
      } catch {
        return [];
      }
    },
    enabled: enabled && programReady,
    staleTime: STALE_TIME_MS,
  });

  const voteRecordsQuery = useQuery({
    queryKey: ["quorum", "allVoteRecords", trustAddress ?? null],
    queryFn: async () => {
      try {
        return await readAllVoteRecords(trustAddress as string);
      } catch {
        return [];
      }
    },
    enabled: enabled && programReady,
    staleTime: STALE_TIME_MS,
  });

  return {
    configs: configsQuery.data,
    proposals: proposalsQuery.data,
    roleTypes: roleTypesQuery.data,
    roles: rolesQuery.data,
    voteRecords: voteRecordsQuery.data,
    programDeployed: programQuery.data,
    isLoading:
      enabled &&
      (programQuery.isLoading ||
        (programReady &&
          (configsQuery.isLoading || proposalsQuery.isLoading || roleTypesQuery.isLoading))),
    error:
      (programQuery.error as Error | null) ??
      (configsQuery.error as Error | null) ??
      (proposalsQuery.error as Error | null) ??
      (roleTypesQuery.error as Error | null) ??
      null,
  };
}
