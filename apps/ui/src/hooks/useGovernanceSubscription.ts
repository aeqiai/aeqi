/**
 * `useGovernanceSubscription` — live updates for the Quorum surface.
 *
 * The iter-7 functional gap: the page currently only refetches on
 * explicit writes (via `useQuorumInvalidator`) or after the 30s
 * `staleTime` elapses on the React Query caches behind `useQuorum`.
 * When a sibling agent / RPC writer / async worker opens a proposal or
 * casts a vote against the same COMPANY, the operator sees nothing until
 * they refresh — that breaks the "watch the room" expectation a
 * governance surface implies.
 *
 * This hook closes the gap with a thin `onProgramAccountChange`
 * subscription on `aeqi_governance`, filtered with the same memcmp
 * pattern the read helpers use (company pubkey at offset 8). On every
 * change event we invalidate the proposal + vote-record + config caches
 * for this COMPANY. React Query handles the actual refetch + diff, so the
 * UI updates in one render cycle once the new account state lands.
 *
 * Cheap by construction:
 *   - ONE WS subscription per page mount (not per primitive). The
 *     governance program owns proposals, vote_records, and
 *     governance_configs; one filter scopes all three to this COMPANY.
 *   - The subscription IS the diff — we don't poll. The cluster pushes
 *     account-change notifications, we react.
 *   - On unmount we tear down the subscription so navigating away from
 *     the page doesn't leak the WS handle.
 *
 * Failure mode is conservative: if `onProgramAccountChange` throws
 * (cluster offline, no WS at the RPC URL), we log once and fall back to
 * the existing 30s staleTime. The page stays usable; it just isn't
 * live.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";

import { getConnection, isDirectSolanaRpcEnabled } from "@/solana/client";
import { AEQI_GOVERNANCE_PROGRAM_ID } from "@/solana/pdas";

/**
 * Subscribe to every governance-program account change scoped to one
 * COMPANY and invalidate the matching React Query caches. The hook is a
 * no-op when `companyAddress` is null/empty so the pre-bridge state stays
 * inert.
 *
 * The single memcmp filter (COMPANY pubkey @ offset 8) matches the layout
 * of `Proposal`, `VoteRecord`, and `GovernanceConfig` — every account
 * type the surface reads carries `company: pubkey` as its first non-
 * discriminator field. One subscription, three caches refreshed.
 */
export function useGovernanceSubscription(companyAddress: string | null | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!companyAddress || !isDirectSolanaRpcEnabled()) return;

    const conn = getConnection();
    let trustPda: PublicKey;
    try {
      trustPda = new PublicKey(companyAddress);
    } catch {
      // Hand-crafted bookmark with a garbage company address — silently
      // skip the subscription instead of throwing inside an effect.
      return;
    }

    const invalidate = () => {
      // Fire all three invalidations in one tick. React Query coalesces
      // back-to-back invalidations on the same key so this stays a
      // single refetch per cache when a single account change arrives.
      void qc.invalidateQueries({ queryKey: ["quorum", "proposals", companyAddress] });
      void qc.invalidateQueries({ queryKey: ["quorum", "configs", companyAddress] });
      void qc.invalidateQueries({ queryKey: ["quorum", "allVoteRecords", companyAddress] });
      // The single-proposal vote-record query is keyed by proposalId
      // hex which we don't know without decoding the account that just
      // changed. Invalidating the broader prefix triggers the right
      // refetch when the detail modal is open.
      void qc.invalidateQueries({ queryKey: ["quorum", "voteRecords", companyAddress] });
    };

    let subId: number | null = null;
    let cancelled = false;

    try {
      // memcmp on offset 8 (right after the 8-byte Anchor discriminator)
      // matches every Proposal / VoteRecord / GovernanceConfig that
      // carries this company as its first field. The filter shape mirrors
      // `readProposals` / `readVoteRecords` / `readGovernanceConfigs` so
      // we cover the same account set.
      subId = conn.onProgramAccountChange(
        AEQI_GOVERNANCE_PROGRAM_ID,
        () => {
          if (cancelled) return;
          invalidate();
        },
        {
          commitment: "confirmed",
          filters: [
            {
              memcmp: {
                offset: 8,
                bytes: trustPda.toBase58(),
              },
            },
          ],
        },
      );
    } catch (err) {
      // RPC may not expose websockets (some HTTP-only providers) — the
      // hook degrades to the existing staleTime cadence. Log once for
      // visibility instead of throwing inside the effect.
      console.warn("[quorum] live subscription unavailable, falling back to 30s polling", err);
      return;
    }

    return () => {
      cancelled = true;
      if (subId !== null) {
        // `removeProgramAccountChangeListener` returns a Promise; we
        // intentionally don't await because the cleanup function must
        // be sync. Fire-and-forget is fine here — the WS handle either
        // closes (clean) or the page navigates away and the connection
        // singleton survives.
        void conn.removeProgramAccountChangeListener(subId);
      }
    };
  }, [companyAddress, qc]);
}
