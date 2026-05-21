/**
 * `useProposalVoteRecords` — shared cache wrapper around the per-proposal
 * VoteRecord PDA scan.
 *
 * Two surfaces consume the same data inside the proposal detail modal:
 * the `VoteHistorySection` audit table AND the `TallyMomentumStrip`
 * sparkline. Both used to issue their own `useQuery` against
 * `readVoteRecords` — same key, same fetcher, but the duplication made
 * the invalidator's wire-write-to-read story fragile (a future caller
 * could pick a slightly different key and silently fork the cache).
 *
 * Lifting the query into a hook means there's exactly one source of
 * truth for the vote-record list per (trust, proposal) and the iter-3
 * `useQuorumInvalidator` keeps working unchanged — it already targets
 * the same key prefix.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { readVoteRecords, type VoteRecordWithPda } from "@/solana";

/** Match the iter-2 query staleness so the cache behavior stays
 *  identical to the inline `useQuery` this replaces. */
const STALE_TIME_MS = 30_000;

export interface UseProposalVoteRecordsResult {
  data: VoteRecordWithPda[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
}

function bytesToHexLocal(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

export function useProposalVoteRecords(
  trustAddress: string,
  proposalId: Uint8Array | number[],
  options?: { enabled?: boolean },
): UseProposalVoteRecordsResult {
  const idKey = useMemo(() => bytesToHexLocal(proposalId), [proposalId]);
  // Treat an all-zero proposalId as the "no proposal selected" sentinel
  // so callers in a modal-closed branch can call the hook unconditionally
  // without firing a real RPC round-trip against a meaningless key.
  const isZeroId = useMemo(() => {
    const arr = proposalId instanceof Uint8Array ? proposalId : Uint8Array.from(proposalId);
    for (const b of arr) {
      if (b !== 0) return false;
    }
    return arr.length === 0 ? true : true;
  }, [proposalId]);
  const enabled = (options?.enabled ?? true) && trustAddress.length > 0 && !isZeroId;
  const query = useQuery({
    queryKey: ["quorum", "voteRecords", trustAddress, idKey],
    queryFn: () => readVoteRecords(trustAddress, proposalId),
    staleTime: STALE_TIME_MS,
    enabled,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
  };
}
