/**
 * `useVaultActivity` — scan the chain for the COMPANY's vault authority
 * signature tail.
 *
 * `getSignaturesForAddress(vaultAuthority, { limit })` returns every
 * tx signature that touched the PDA, newest first, with `blockTime` and
 * `slot`. We use it for two surfaces on the Assets page:
 *
 *   1. A per-day "vault touches" sparkline across the trailing 30 days,
 *      surfacing whether the vault is busy or quiet.
 *   2. A truncated "recent activity" list showing the last N signatures
 *      with explorer deep-links — the entry point an operator wants when
 *      a deposit "should have landed".
 *
 * Honest scope: this is NOT a 30-day USD curve. The chain stores token
 * transfers, not USD values, and we have no oracle for non-stablecoin
 * mints in the dashboard today. Counting touches is the most useful
 * unit of signal we can extract without standing up an indexer rail.
 *
 * `enabled` flips false when there's no vault authority PDA to scan
 * (pre-bridge state). Errors are swallowed into `[]` so the section
 * degrades to "no activity yet" instead of breaking the page.
 */
import { useQuery } from "@tanstack/react-query";
import { PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";

import { getConnection, isDirectSolanaRpcEnabled } from "@/solana/client";

const STALE_TIME_MS = 30_000;
/** Tail length. The chain answers in milliseconds at this size; 1000 is
 *  large enough to cover the dashboard's 30-day window for any sane
 *  vault and still cheap on the RPC. */
const SIGNATURE_LIMIT = 1000;

export interface VaultSignature {
  signature: string;
  /** Unix-seconds — null when the RPC didn't backfill the block-time. */
  blockTime: number | null;
  slot: number;
  /** First confirmed-signature error code, if any. Surfaced so the
   *  "recent" list can mark failed transactions visually. */
  err: ConfirmedSignatureInfo["err"];
}

export interface VaultActivity {
  signatures: VaultSignature[];
  /** Per-day count of vault touches, length = windowDays, oldest first.
   *  Signatures without a `blockTime` are dropped. */
  sparkline: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket signatures by day, oldest first. Mirrors the sparkline shape
 * `CompanyActivityCard` consumes for the cockpit so the visual feels
 * consistent across surfaces.
 */
function bucketSignatures(signatures: VaultSignature[], windowDays: number): number[] {
  const buckets = new Array<number>(windowDays).fill(0);
  const todayStart = startOfDay(Date.now());
  for (const sig of signatures) {
    if (sig.blockTime === null) continue;
    const ts = sig.blockTime * 1000;
    const dayDelta = Math.floor((todayStart - startOfDay(ts)) / DAY_MS);
    if (dayDelta < 0 || dayDelta >= windowDays) continue;
    buckets[windowDays - 1 - dayDelta] += 1;
  }
  return buckets;
}

export interface UseVaultActivityOptions {
  windowDays?: number;
}

export interface UseVaultActivityResult {
  data: VaultActivity | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
}

export function useVaultActivity(
  vaultAuthorityPda: string | null | undefined,
  options: UseVaultActivityOptions = {},
): UseVaultActivityResult {
  const windowDays = options.windowDays ?? 30;
  const enabled = !!vaultAuthorityPda && isDirectSolanaRpcEnabled();

  const query = useQuery({
    queryKey: ["assets", "vault-activity", vaultAuthorityPda ?? null, windowDays],
    queryFn: async (): Promise<VaultActivity> => {
      const conn = getConnection();
      const pda = new PublicKey(vaultAuthorityPda as string);
      try {
        const raw = await conn.getSignaturesForAddress(pda, { limit: SIGNATURE_LIMIT });
        const signatures: VaultSignature[] = raw.map((s) => ({
          signature: s.signature,
          blockTime: s.blockTime ?? null,
          slot: s.slot,
          err: s.err,
        }));
        return { signatures, sparkline: bucketSignatures(signatures, windowDays) };
      } catch {
        return { signatures: [], sparkline: new Array(windowDays).fill(0) };
      }
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return {
    data: query.data,
    isLoading: enabled && query.isLoading,
    isFetching: enabled && query.isFetching,
    error: (query.error as Error | null) ?? null,
  };
}
