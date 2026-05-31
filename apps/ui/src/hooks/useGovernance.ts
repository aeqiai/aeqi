import { useEffect, useState } from "react";

import {
  fetchProposalsForModule,
  fetchCompanyModules,
  fetchVotingPower,
  findModuleByType,
  indexerEnabled,
  type IndexedProposal,
  type IndexedVotingPower,
} from "@/lib/indexer";

export interface GovernanceState {
  /** Null while loading, empty array when no module or no proposals. */
  proposals: IndexedProposal[] | null;
  /** Null while loading, undefined when not available. */
  votingPower: IndexedVotingPower | null | undefined;
  /** True if the governance module was found on-chain. */
  hasModule: boolean;
  /** Non-null when the fetch errored. */
  error: string | null;
}

/**
 * Fetch on-chain governance state for a given COMPANY address.
 *
 * Degrades gracefully in all failure modes:
 * - Indexer not configured → proposals=[], votingPower=undefined, hasModule=false
 * - No governance module on COMPANY → proposals=[], hasModule=false
 * - votingPower query absent from schema → votingPower=null
 * - Network error → error set, proposals stays null (caller shows error state)
 */
export function useGovernance(
  companyAddress: string | undefined,
  accountAddress?: string,
): GovernanceState {
  const [proposals, setProposals] = useState<IndexedProposal[] | null>(null);
  const [votingPower, setVotingPower] = useState<IndexedVotingPower | null | undefined>(undefined);
  const [hasModule, setHasModule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyAddress || !indexerEnabled()) {
      setProposals([]);
      setVotingPower(undefined);
      setHasModule(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setProposals(null);
    setVotingPower(undefined);
    setHasModule(false);
    setError(null);

    (async () => {
      try {
        const mods = await fetchCompanyModules(companyAddress);
        const govModule = findModuleByType(mods, "governance");

        if (!govModule) {
          if (!cancelled) {
            setProposals([]);
            setHasModule(false);
          }
          return;
        }

        if (!cancelled) setHasModule(true);

        // Fetch proposals and voting power in parallel.
        const [ps, vp] = await Promise.all([
          fetchProposalsForModule(govModule.moduleAddress),
          accountAddress
            ? fetchVotingPower(govModule.moduleAddress, accountAddress)
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setProposals(ps);
          setVotingPower(vp);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          // Keep proposals null so callers can distinguish "errored" from "empty".
          setProposals(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyAddress, accountAddress]);

  return { proposals, votingPower, hasModule, error };
}
