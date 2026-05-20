/**
 * `useTokenMetas(mints)` — batch-resolve SPL mint metadata for an
 * arbitrary list of mints.
 *
 * The static `TOKEN_REGISTRY` in `src/solana/assets.ts` covers the
 * stablecoin mints we care about for USD valuation. Every other mint
 * the TRUST holds (Token-2022 equity shares, externally-airdropped
 * SPLs, governance tokens) renders as "Unknown · raw base units"
 * without a live read against the chain. That's the iter-1 noted next:
 * surface symbol + decimals so non-stable holdings render legibly.
 *
 * Resolution chain per mint:
 *   1. Static registry hit — return immediately, no RPC.
 *   2. `getMint(...)` against the legacy and Token-2022 programs —
 *      gives us authoritative `decimals`. We try Token-2022 first
 *      because AEQI-issued mints live there; legacy USDC etc. fall
 *      through.
 *   3. `getTokenMetadata(...)` on Token-2022 mints — pulls the
 *      `symbol` exposed via the metadata extension if the mint
 *      authority registered one.
 *
 * Decimals always wins from chain (mint header) — symbol is best-effort.
 * Results cache for 5 minutes via React Query; decimals never change on
 * a mint, but a fresh `symbol` registration is the only thing that
 * could change so the staleness window is generous.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMint,
  getTokenMetadata,
} from "@solana/spl-token";

import { getConnection } from "@/solana/client";
import { TOKEN_REGISTRY } from "@/solana/assets";

export interface ResolvedTokenMeta {
  symbol: string | null;
  decimals: number | null;
  /** True iff the meta came from a live chain read (vs the static registry). */
  resolvedOnChain: boolean;
}

const EMPTY_META: ResolvedTokenMeta = { symbol: null, decimals: null, resolvedOnChain: false };
const STALE_TIME_MS = 5 * 60_000;

async function resolveOne(mint: string): Promise<ResolvedTokenMeta> {
  const conn = getConnection();
  const key = new PublicKey(mint);

  // Try Token-2022 first — AEQI-issued mints live there; if not, fall
  // back to legacy SPL Token. `getMint` throws on wrong program owner,
  // so we catch and try the other.
  let decimals: number | null = null;
  let programId: PublicKey | null = null;
  try {
    const m = await getMint(conn, key, undefined, TOKEN_2022_PROGRAM_ID);
    decimals = m.decimals;
    programId = TOKEN_2022_PROGRAM_ID;
  } catch {
    try {
      const m = await getMint(conn, key, undefined, TOKEN_PROGRAM_ID);
      decimals = m.decimals;
      programId = TOKEN_PROGRAM_ID;
    } catch {
      // Account does not exist or layout invalid — leave both null.
    }
  }

  let symbol: string | null = null;
  if (programId === TOKEN_2022_PROGRAM_ID) {
    try {
      const meta = await getTokenMetadata(conn, key, undefined, TOKEN_2022_PROGRAM_ID);
      if (meta?.symbol) symbol = meta.symbol;
    } catch {
      // Metadata extension absent — fine, leave symbol null.
    }
  }

  return { symbol, decimals, resolvedOnChain: true };
}

/**
 * Batch-resolve token meta for a stable list of mints. Each unique
 * mint becomes its own React Query so React Query's cache de-dupes
 * across components (Holdings + Vesting rendering the same mint).
 */
export function useTokenMetas(mints: string[]): Record<string, ResolvedTokenMeta> {
  const unique = useMemo(() => Array.from(new Set(mints)), [mints]);

  // Resolve each mint via a dedicated query. We collapse the array into
  // one query so the hook returns a single object — but cache keys are
  // per-mint so cross-component sharing still works.
  const query = useQuery({
    queryKey: ["tokenMetas", unique.slice().sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        unique.map(async (mint) => {
          const reg = TOKEN_REGISTRY[mint];
          if (reg) {
            return [
              mint,
              { symbol: reg.symbol, decimals: reg.decimals, resolvedOnChain: false },
            ] as const;
          }
          const meta = await resolveOne(mint);
          return [mint, meta] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: unique.length > 0,
    staleTime: STALE_TIME_MS,
  });

  return useMemo(() => {
    const out: Record<string, ResolvedTokenMeta> = {};
    for (const mint of unique) {
      const reg = TOKEN_REGISTRY[mint];
      if (reg) {
        out[mint] = { symbol: reg.symbol, decimals: reg.decimals, resolvedOnChain: false };
      } else {
        out[mint] = query.data?.[mint] ?? EMPTY_META;
      }
    }
    return out;
  }, [unique, query.data]);
}
