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
 *   3. Token-2022 metadata TLV decode — pulls the `symbol` exposed via
 *      the metadata extension if the mint authority registered one.
 *
 * Decimals always wins from chain (mint header) — symbol is best-effort.
 * Results cache for 5 minutes via React Query; decimals never change on
 * a mint, but a fresh `symbol` registration is the only thing that
 * could change so the staleness window is generous.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";

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
const TYPE_SIZE = 2;
const LENGTH_SIZE = 2;
const TOKEN_METADATA_EXTENSION_TYPE = 19;
const TOKEN_METADATA_HEADER_SIZE = 32 + 32; // updateAuthority + mint

function readU16Le(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return -1;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32Le(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return -1;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function findTokenMetadataExtension(tlvData: Uint8Array | null | undefined): Uint8Array | null {
  if (!tlvData) return null;
  let offset = 0;
  while (offset + TYPE_SIZE + LENGTH_SIZE <= tlvData.length) {
    const type = readU16Le(tlvData, offset);
    const length = readU16Le(tlvData, offset + TYPE_SIZE);
    const start = offset + TYPE_SIZE + LENGTH_SIZE;
    const end = start + length;
    if (type < 0 || length < 0 || end > tlvData.length) return null;
    if (type === TOKEN_METADATA_EXTENSION_TYPE) return tlvData.slice(start, end);
    offset = end;
  }
  return null;
}

function readMetadataString(
  bytes: Uint8Array,
  offset: number,
): { value: string; next: number } | null {
  const length = readU32Le(bytes, offset);
  if (length < 0) return null;
  const start = offset + 4;
  const end = start + length;
  if (end > bytes.length) return null;
  return { value: new TextDecoder("utf-8").decode(bytes.slice(start, end)), next: end };
}

function decodeToken2022MetadataSymbol(tlvData: Uint8Array | null | undefined): string | null {
  const metadata = findTokenMetadataExtension(tlvData);
  if (!metadata || metadata.length < TOKEN_METADATA_HEADER_SIZE) return null;

  const name = readMetadataString(metadata, TOKEN_METADATA_HEADER_SIZE);
  if (!name) return null;
  const symbol = readMetadataString(metadata, name.next);
  const trimmed = symbol?.value.trim();
  return trimmed ? trimmed : null;
}

async function resolveOne(mint: string): Promise<ResolvedTokenMeta> {
  const conn = getConnection();
  const key = new PublicKey(mint);

  // Try Token-2022 first — AEQI-issued mints live there; if not, fall
  // back to legacy SPL Token. `getMint` throws on wrong program owner,
  // so we catch and try the other.
  let decimals: number | null = null;
  let programId: PublicKey | null = null;
  let token2022TlvData: Uint8Array | null = null;
  try {
    const m = await getMint(conn, key, undefined, TOKEN_2022_PROGRAM_ID);
    decimals = m.decimals;
    programId = TOKEN_2022_PROGRAM_ID;
    token2022TlvData = m.tlvData ?? null;
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
    symbol = decodeToken2022MetadataSymbol(token2022TlvData);
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
